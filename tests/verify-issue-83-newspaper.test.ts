/**
 * Issue #83 regression: Newspaper system — ad space bidding, reader reward
 * reactions, and the top-articles leaderboard (decompiled spec:
 * server/data/decompile/formulas_newspaper.md).
 *
 * Covered contracts (port 3910, dedicated DATA_DIR):
 *  - GET  /api/v2/newspaper/sponsor-params/          → per-tier SimBoost pricing
 *  - GET  /api/v2/newspaper/:locale/:realm/sponsor/  → booked slots of the current issue
 *  - POST /api/v2/newspaper/:locale/:realm/sponsor/:slot/ → books a slot (tier price,
 *    SimBoost deduction, conflict + idempotency + char-limit handling)
 *  - POST /api/v2/articles/:id/reactions/ {type}     → REWARD tips 5 SimBoosts,
 *    gated on reader level ≥ 20, author existence and non-own article
 *  - PATCH/DELETE /api/v1/article/:id/reaction/:type → spec reaction routes
 *  - GET  /api/v2/:locale/:realm/articles/top-by-reaction/:reaction/ → ranking by
 *    total upvotes + tips
 *
 * Run: /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-83-newspaper.test.ts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3910');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function isPortAvailable(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const tester = net.createServer()
    .once('error', () => resolve(false))
    .once('listening', () => {
      tester.once('close', () => resolve(true)).close();
    })
    .listen(port, '127.0.0.1');
  return promise;
}

// Polls a separately-spawned OS process over real HTTP; the server's readiness
// is genuinely wall-clock-bound (fake timers cannot advance another process),
// so a real retry delay is required here (ts-no-test-timers exception).
async function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return;
      }
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`);
}

interface ServerInstance {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
}

async function startTestServer(): Promise<ServerInstance> {
  const portAvailable = await isPortAvailable(TEST_PORT);
  assert.ok(portAvailable, `Port ${TEST_PORT} is not available for testing`);

  const dataDir = path.resolve('data', `test-run-issue-83-${Date.now()}`);
  const nodeBinary = existsSync('/opt/magnate/.node22/bin/node')
    ? '/opt/magnate/.node22/bin/node'
    : process.execPath;

  const child = spawn(
    nodeBinary,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATA_DIR: dataDir
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3910] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number; companyName: string }> {
  const email = `newspaper_${label}_${Date.now()}@domain.local`;
  const companyName = `Newspaper ${label} ${Date.now()}`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: companyName })
  });
  assert.equal(res.status, 200, 'Registration should return 200');

  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.find((v) => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie must be returned');

  const auth = await getAuthCompany(cookie);
  assert.ok(auth.companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId: auth.companyId, companyName };
}

async function getAuthCompany(cookie: string): Promise<{ companyId: number; simBoosts: number }> {
  const res = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200, 'auth-data must return 200');
  const body = await res.json() as { authCompany?: { companyId: number; simBoosts: number } };
  return { companyId: Number(body.authCompany?.companyId ?? 0), simBoosts: Number(body.authCompany?.simBoosts ?? 0) };
}

async function getSimBoosts(cookie: string): Promise<number> {
  return (await getAuthCompany(cookie)).simBoosts;
}

interface ApiResult<T = Record<string, unknown>> {
  status: number;
  body: T;
}

async function api<T = Record<string, unknown>>(
  method: string,
  urlPath: string,
  opts: { cookie?: string; body?: unknown } = {}
): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {})
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body: body as T };
}


async function runNewspaperVerification(): Promise<void> {
  console.log('================================================================');
  console.log(' Starting Issue #83: Newspaper Verification');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('✔ Test server started successfully on port', TEST_PORT);

    // Opening the sqlite file directly for state preparation (level bumps,
    // test-article inserts) is safe: /version/ only answers after the server
    // finished synchronous DB init + seed.
    const db = new DatabaseSync(server.dbPath);

    const author = await registerCompany('author');
    const reader = await registerCompany('reader');
    const rival = await registerCompany('rival');
    const poor = await registerCompany('poor');

    // ----------------------------------------------------------------
    // [1] Sponsor params expose per-tier SimBoost pricing for 11 slots.
    // ----------------------------------------------------------------
    console.log('[1/9] Sponsor params: per-tier pricing in SimBoosts...');
    const params = await api('GET', '/api/v2/newspaper/sponsor-params/');
    assert.equal(params.status, 200, 'sponsor-params must return 200');
    const paramsBody = params.body as {
      currency: string;
      pricing: { goldenPrice: number; silverPrice: number; bronzePrice: number };
      tiers: Record<string, { price: number; slots: number[]; charLimit: number; level: number }>;
      totalSlots: number;
      nextPublishAt: string;
    };
    assert.equal(paramsBody.currency, 'SIMBOOSTS', 'ad prices must be denominated in SimBoosts');
    assert.equal(paramsBody.totalSlots, 11, 'there must be 11 ad slots per issue');
    assert.deepEqual(paramsBody.pricing, { goldenPrice: 20, silverPrice: 10, bronzePrice: 5 }, 'tier pricing must be 20/10/5 SimBoosts');
    assert.deepEqual(paramsBody.tiers.GOLDEN.slots, [0], 'Golden tier owns slot 0');
    assert.deepEqual(paramsBody.tiers.SILVER.slots, [1, 2], 'Silver tier owns slots 1-2');
    assert.deepEqual(paramsBody.tiers.BRONZE.slots, [3, 4, 5, 6, 7, 8, 9, 10], 'Bronze tier owns slots 3-10');
    assert.equal(paramsBody.tiers.GOLDEN.charLimit, 280, 'Golden char limit is 280');
    assert.equal(paramsBody.tiers.SILVER.charLimit, 200, 'Silver char limit is 200');
    assert.equal(paramsBody.tiers.BRONZE.charLimit, 140, 'Bronze char limit is 140');
    assert.ok(!Number.isNaN(Date.parse(paramsBody.nextPublishAt)), 'nextPublishAt must be a valid date (Thursday 16:00 UTC schedule)');
    console.log('  ✔ tiers GOLDEN/SILVER/BRONZE priced 20/10/5 SimBoosts across slots 0 / 1-2 / 3-10');

    // Migration section: the unique sponsor-slot index must exist.
    const uqIndex = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='uq_newspaper_sponsors_issue_position'").get() as { name: string } | undefined;
    assert.ok(uqIndex, 'migration must install uq_newspaper_sponsors_issue_position');

    // ----------------------------------------------------------------
    // [2] Current-issue sponsor list starts empty for the bookable issue.
    // ----------------------------------------------------------------
    console.log('[2/9] Sponsor list: current unpublished issue starts with empty slots...');
    const emptyList = await api('GET', '/api/v2/newspaper/en/0/sponsor/');
    assert.equal(emptyList.status, 200, 'sponsor list must return 200');
    const listBody = emptyList.body as {
      newspaperId: number; issueId: number; realmId: number; published: string | null;
      sponsors: Record<string, unknown>; pricing: { goldenPrice: number }; totalSlots: number; filledSlots: number; allSlotsTaken: boolean;
    };
    assert.equal(listBody.realmId, 0, 'realm echoed');
    assert.equal(listBody.published, null, 'bookable issue must be unpublished');
    assert.equal(listBody.filledSlots, 0, 'fresh bookable issue has no ads');
    assert.equal(listBody.allSlotsTaken, false, 'allSlotsTaken false when empty');
    assert.deepEqual(listBody.pricing, { goldenPrice: 20, silverPrice: 10, bronzePrice: 5 }, 'list carries tier pricing');
    const bookableIssueId = listBody.newspaperId;
    assert.ok(bookableIssueId > 0, 'bookable issue id must resolve');
    console.log(`  ✔ issue ${listBody.issueId} (id ${bookableIssueId}) bookable, 0/11 filled`);

    // ----------------------------------------------------------------
    // [3] Golden slot booking: charges exactly 20 SimBoosts, lists with logo.
    // ----------------------------------------------------------------
    console.log('[3/9] Golden slot booking deducts 20 SimBoosts and lists the ad...');
    const authorBefore = await getSimBoosts(author.cookie);
    assert.equal(authorBefore, 250, 'fresh company starts with 250 SimBoosts');
    const goldenText = 'Golden ad from author: finest power contracts on the exchange!';
    const booked = await api('POST', `/api/v2/newspaper/en/0/sponsor/0/`, { cookie: author.cookie, body: { text: goldenText } });
    assert.equal(booked.status, 200, `golden booking must succeed: ${JSON.stringify(booked.body)}`);
    const bookedBody = booked.body as { price: number; tier: string; simBoostsRemaining: number; companyName: string; position: number };
    assert.equal(bookedBody.price, 20, 'golden slot costs 20 SimBoosts');
    assert.equal(bookedBody.tier, 'GOLDEN', 'slot 0 resolves to the GOLDEN tier');
    assert.equal(bookedBody.companyName, author.companyName, 'ad carries the booking company name');
    assert.equal(bookedBody.simBoostsRemaining, authorBefore - 20, 'booking deducts exactly the tier price');
    assert.equal(await getSimBoosts(author.cookie), authorBefore - 20, 'SimBoost balance persisted');

    const afterGolden = await api('GET', '/api/v2/newspaper/en/0/sponsor/');
    const afterGoldenBody = afterGolden.body as typeof listBody & { sponsors: Record<string, { companyName: string; companyId: number; text: string; logo: string }> };
    const goldenAd = afterGoldenBody.sponsors['0'];
    assert.ok(goldenAd, 'slot 0 must be listed');
    assert.equal(goldenAd.companyName, author.companyName, 'listed ad shows company name');
    assert.equal(goldenAd.companyId, author.companyId, 'listed ad shows company id');
    assert.equal(goldenAd.text, goldenText, 'listed ad shows the booked text');
    assert.equal(typeof goldenAd.logo, 'string', 'listed ad exposes a logo field');
    assert.equal(afterGoldenBody.filledSlots, 1, 'one slot filled');
    console.log('  ✔ slot 0 booked for 20 SimBoosts (250→230), ad listed with logo field');

    // ----------------------------------------------------------------
    // [4] Slot conflict: a rival cannot take an occupied slot (no charge).
    // ----------------------------------------------------------------
    console.log('[4/9] Slot conflict: booking an occupied slot fails without charging...');
    const rivalBefore = await getSimBoosts(rival.cookie);
    const conflict = await api('POST', `/api/v2/newspaper/en/0/sponsor/0/`, { cookie: rival.cookie, body: { text: 'sneaky rival ad' } });
    assert.equal(conflict.status, 409, 'occupied slot booking must conflict');
    assert.equal((conflict.body as { code: string }).code, 'SPONSOR_SLOT_TAKEN', 'conflict code must be SPONSOR_SLOT_TAKEN');
    assert.equal(await getSimBoosts(rival.cookie), rivalBefore, 'conflicted booking must not charge');
    console.log('  ✔ 409 SPONSOR_SLOT_TAKEN, rival balance untouched');

    // ----------------------------------------------------------------
    // [5] Tier pricing: silver slot costs 10, bronze slot costs 5.
    // ----------------------------------------------------------------
    console.log('[5/9] Tier pricing on lower slots: silver −10, bronze −5...');
    const rivalSb = await getSimBoosts(rival.cookie);
    const silver = await api('POST', `/api/v2/newspaper/en/0/sponsor/1/`, { cookie: rival.cookie, body: { text: 'Silver logistics ad' } });
    assert.equal(silver.status, 200, `silver booking must succeed: ${JSON.stringify(silver.body)}`);
    assert.equal((silver.body as { price: number; tier: string }).price, 10, 'slot 1 costs 10 SimBoosts');
    assert.equal((silver.body as { tier: string }).tier, 'SILVER', 'slot 1 resolves to SILVER');
    const bronze = await api('POST', `/api/v2/newspaper/en/0/sponsor/5/`, { cookie: rival.cookie, body: { text: 'Bronze retail ad' } });
    assert.equal(bronze.status, 200, 'bronze booking must succeed');
    assert.equal((bronze.body as { price: number; tier: string }).price, 5, 'slot 5 costs 5 SimBoosts');
    assert.equal((bronze.body as { tier: string }).tier, 'BRONZE', 'slot 5 resolves to BRONZE');
    assert.equal(await getSimBoosts(rival.cookie), rivalSb - 15, 'silver + bronze deduct 15 SimBoosts total');
    console.log('  ✔ slot 1 charged 10, slot 5 charged 5');

    // ----------------------------------------------------------------
    // [6] Idempotent re-book: refreshing your own ad never double-charges.
    // ----------------------------------------------------------------
    console.log('[6/9] Idempotent re-book refreshes the ad text without charging...');
    const authorSb = await getSimBoosts(author.cookie);
    const newText = 'Updated golden ad copy — even better rates!';
    const rebook = await api('POST', `/api/v2/newspaper/en/0/sponsor/0/`, { cookie: author.cookie, body: { text: newText } });
    assert.equal(rebook.status, 200, 'own-slot re-book must succeed');
    const rebookBody = rebook.body as { price: number; idempotent: boolean };
    assert.equal(rebookBody.price, 0, 're-book must not charge');
    assert.equal(rebookBody.idempotent, true, 're-book flagged idempotent');
    assert.equal(await getSimBoosts(author.cookie), authorSb, 're-book must not deduct SimBoosts');
    const rebookedList = await api('GET', '/api/v2/newspaper/en/0/sponsor/');
    assert.equal((rebookedList.body as { sponsors: Record<string, { text: string }> }).sponsors['0'].text, newText, 'ad text refreshed');
    console.log('  ✔ price 0, balance unchanged, ad text updated');

    // ----------------------------------------------------------------
    // [7] Guard rails: insufficient SimBoosts, char limits, invalid slot, auth.
    // ----------------------------------------------------------------
    console.log('[7/9] Guard rails: insufficient funds, too many characters, invalid slot, auth...');
    db.prepare('UPDATE companies SET simboosts = 3 WHERE company_id = ?').run(poor.companyId);
    const poorBefore = await getSimBoosts(poor.cookie);
    const poorBooking = await api('POST', `/api/v2/newspaper/en/0/sponsor/7/`, { cookie: poor.cookie, body: { text: 'cheap ad' } });
    assert.equal(poorBooking.status, 400, 'insufficient SimBoosts must fail with 400');
    assert.equal((poorBooking.body as { code: string }).code, 'INSUFFICIENT_SIMBOOSTS', 'insufficient funds code');
    assert.equal(await getSimBoosts(poor.cookie), poorBefore, 'failed booking must not charge');

    const tooLong = await api('POST', `/api/v2/newspaper/en/0/sponsor/3/`, { cookie: author.cookie, body: { text: 'x'.repeat(281) } });
    assert.equal(tooLong.status, 400, '281-char golden text must fail');
    assert.equal((tooLong.body as { code: string }).code, 'TOO_MANY_CHARACTERS', 'char limit code');
    assert.equal(await getSimBoosts(author.cookie), authorSb, 'rejected booking must not charge');

    const badSlot = await api('POST', `/api/v2/newspaper/en/0/sponsor/11/`, { cookie: author.cookie, body: { text: 'nope' } });
    assert.equal(badSlot.status, 400, 'slot 11 must be rejected');
    assert.equal((badSlot.body as { code: string }).code, 'SPONSOR_INVALID_SLOT', 'invalid slot code');

    const anon = await api('POST', `/api/v2/newspaper/en/0/sponsor/8/`, { body: { text: 'anonymous' } });
    assert.equal(anon.status, 401, 'unauthenticated booking must be rejected');
    console.log('  ✔ INSUFFICIENT_SIMBOOSTS, TOO_MANY_CHARACTERS, SPONSOR_INVALID_SLOT, 401');

    // ----------------------------------------------------------------
    // [8] Reactions: reward gate, transfer, idempotency, toggle-off.
    // ----------------------------------------------------------------
    console.log('[8/9] Reward reactions: level gate, 5-SimBoost transfer, idempotency...');
    // Test article authored by the author company, seeded with 43 total reactions.
    const insertArticle = db.prepare(`
      INSERT INTO newspaper_articles
      (newspaper_id, realm_id, title, type, copy1, copy2, copy3, author_company_id, author_company_name, position, reactions_json, reaction_count, charts_json, outdated, created_at)
      VALUES (?, ?, ?, 'CUSTOM', 'body one', 'body two', 'body three', ?, ?, 9, ?, ?, '[]', 0, ?)
    `);
    const seededCounts = { THUMBS_UP: 40, REWARD: 3 };
    const testArticleIns = insertArticle.run(
      bookableIssueId, 0, 'Test: tipping drives the leaderboard',
      author.companyId, author.companyName,
      JSON.stringify(seededCounts), seededCounts.THUMBS_UP + seededCounts.REWARD,
      new Date().toISOString()
    );
    const testArticleId = Number(testArticleIns.lastInsertRowid);
    assert.ok(testArticleId > 0, 'test article must be inserted');

    // Level gate: reader is level 0 (< 20).
    const readerBefore = await getSimBoosts(reader.cookie);
    const gate = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'REWARD' } });
    assert.equal(gate.status, 403, 'reader below level 20 must be rejected');
    assert.equal((gate.body as { code: string }).code, 'REWARD_LEVEL_TOO_LOW', 'level gate code');
    assert.equal(await getSimBoosts(reader.cookie), readerBefore, 'gated reward must not charge');

    // Promote reader to level 20 (the canonical hsr threshold).
    db.prepare('UPDATE companies SET level = 20 WHERE company_id = ?').run(reader.companyId);

    // Insufficient SimBoosts at the gate.
    db.prepare('UPDATE companies SET simboosts = 2 WHERE company_id = ?').run(reader.companyId);
    const poorReward = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'REWARD' } });
    assert.equal(poorReward.status, 400, 'reward without SimBoosts must fail');
    assert.equal((poorReward.body as { code: string }).code, 'INSUFFICIENT_SIMBOOSTS', 'insufficient boost code');
    db.prepare('UPDATE companies SET simboosts = 250 WHERE company_id = ?').run(reader.companyId);

    // Successful reward: −5 reader, +5 author, counters update.
    const authorPreReward = await getSimBoosts(author.cookie);
    const reward = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'REWARD' } });
    assert.equal(reward.status, 200, `reward must succeed: ${JSON.stringify(reward.body)}`);
    const rewardBody = reward.body as { count: number; reactions: Record<string, number> };
    assert.equal(rewardBody.count, seededCounts.REWARD + 1, 'REWARD count incremented');
    assert.equal(await getSimBoosts(reader.cookie), 250 - 5, 'reader pays exactly 5 SimBoosts');
    assert.equal(await getSimBoosts(author.cookie), authorPreReward + 5, 'author receives exactly 5 SimBoosts');

    // Idempotent repeat: no double charge, no double count.
    const repeat = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'REWARD' } });
    assert.equal(repeat.status, 200, 'repeated reward must not error');
    assert.equal((repeat.body as { idempotent: boolean }).idempotent, true, 'repeat reward flagged idempotent');
    assert.equal(await getSimBoosts(reader.cookie), 245, 'repeat must not charge again');
    assert.equal(await getSimBoosts(author.cookie), authorPreReward + 5, 'repeat must not credit again');

    // Own article: reader authors an article and cannot reward it.
    const ownIns = insertArticle.run(
      bookableIssueId, 0, 'Test: reader self-promotion attempt',
      reader.companyId, reader.companyName,
      JSON.stringify({ THUMBS_UP: 1 }), 1, new Date().toISOString()
    );
    const ownArticleId = Number(ownIns.lastInsertRowid);
    const ownReward = await api('POST', `/api/v2/articles/${ownArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'REWARD' } });
    assert.equal(ownReward.status, 403, 'rewarding your own article must be forbidden');
    assert.equal((ownReward.body as { code: string }).code, 'REWARD_OWN_ARTICLE', 'own article code');
    assert.equal(await getSimBoosts(reader.cookie), 245, 'own-article rejection must not charge');

    // Authorless article (seeded editorial, author 999901 does not exist).
    const authorless = await api('POST', `/api/v2/articles/1/reactions/`, { cookie: reader.cookie, body: { type: 'REWARD' } });
    assert.equal(authorless.status, 400, 'reward without an existing author must fail');
    assert.equal((authorless.body as { code: string }).code, 'REWARD_AUTHOR_MISSING', 'authorless code');
    assert.equal(await getSimBoosts(reader.cookie), 245, 'authorless rejection must not charge');

    // Free thumbs-up: no charge, idempotent.
    const thumbs = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'THUMBS_UP' } });
    assert.equal(thumbs.status, 200, 'thumbs-up must succeed');
    assert.equal(await getSimBoosts(reader.cookie), 245, 'thumbs-up is free');
    const thumbsRepeat = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'THUMBS_UP' } });
    assert.equal((thumbsRepeat.body as { idempotent: boolean }).idempotent, true, 'repeat thumbs-up idempotent');
    assert.equal((thumbsRepeat.body as { count: number }).count, seededCounts.THUMBS_UP + 1, 'thumbs-up counted once');

    // v1 spec route: PATCH adds (idempotent here), DELETE toggles off.
    const v1Patch = await api('PATCH', `/api/v1/article/${testArticleId}/reaction/THUMBS_UP/`, { cookie: reader.cookie });
    assert.equal(v1Patch.status, 200, 'v1 PATCH must succeed');
    assert.equal((v1Patch.body as { idempotent: boolean }).idempotent, true, 'v1 PATCH must not double-count');

    // Unknown type, unauthenticated, unknown article.
    const unknownType = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'HEARTS' } });
    assert.equal(unknownType.status, 400, 'unknown reaction type rejected');
    assert.equal((unknownType.body as { code: string }).code, 'UNKNOWN_REACTION', 'unknown type code');
    const anonReact = await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { body: { type: 'THUMBS_UP' } });
    assert.equal(anonReact.status, 401, 'unauthenticated reaction rejected');
    const missingArticle = await api('POST', `/api/v2/articles/9999999/reactions/`, { cookie: reader.cookie, body: { type: 'THUMBS_UP' } });
    assert.equal(missingArticle.status, 404, 'unknown article is 404');

    // Toggle-off the reward: counters decrement, NO refund (tips are final).
    const v1Delete = await api('DELETE', `/api/v1/article/${testArticleId}/reaction/REWARD/`, { cookie: reader.cookie });
    assert.equal(v1Delete.status, 200, 'v1 DELETE must succeed');
    assert.equal((v1Delete.body as { count: number }).count, seededCounts.REWARD, 'REWARD count back to seeded value');
    assert.equal(await getSimBoosts(reader.cookie), 245, 'toggle-off must NOT refund the tip');
    assert.equal(await getSimBoosts(author.cookie), authorPreReward + 5, 'author keeps the tip');
    const v1DeleteAgain = await api('DELETE', `/api/v1/article/${testArticleId}/reaction/REWARD/`, { cookie: reader.cookie });
    assert.equal((v1DeleteAgain.body as { idempotent: boolean }).idempotent, true, 'repeat toggle-off idempotent');

    // Re-add the reward via v2 DELETE-able route for the own-reactions check.
    await api('POST', `/api/v2/articles/${testArticleId}/reactions/`, { cookie: reader.cookie, body: { type: 'REWARD' } });
    const ownReactions = await api('GET', `/api/v1/newspaper/${bookableIssueId}/reaction/`, { cookie: reader.cookie });
    assert.equal(ownReactions.status, 200, 'own-reactions list must return 200');
    const ownList = ownReactions.body as Array<{ articleId: number; reaction: string }>;
    assert.ok(
      ownList.some((r) => r.articleId === testArticleId && r.reaction === 'REWARD') &&
      ownList.some((r) => r.articleId === testArticleId && r.reaction === 'THUMBS_UP'),
      'own reactions must list both REWARD and THUMBS_UP on the test article'
    );
    const guestReactions = await api('GET', `/api/v1/newspaper/${bookableIssueId}/reaction/`);
    assert.deepEqual(guestReactions.body, [], 'guest own-reactions is an empty list');
    console.log('  ✔ gate 403, transfer −5/+5, idempotent repeat, own/authorless guards, no refund on toggle-off');

    // ----------------------------------------------------------------
    // [9] Leaderboard: ranking by total upvotes + tips, seed data present.
    // ----------------------------------------------------------------
    console.log('[9/9] Top-articles leaderboard: ranked by upvotes + tips...');
    const top = await api('GET', '/api/v2/en/0/articles/top-by-reaction/THUMBS_UP/');
    assert.equal(top.status, 200, 'leaderboard must return 200');
    const topBody = top.body as { topArticles: Array<{ id: number; title: string; reactionCount: number; author: { company?: string }; newspaper: { issueId: number }; reactions: Record<string, number> }> };
    assert.ok(Array.isArray(topBody.topArticles) && topBody.topArticles.length >= 4, 'seeded demo articles must populate the leaderboard');
    const counts = topBody.topArticles.map((a) => a.reactionCount);
    const sortedDesc = [...counts].sort((a, b) => b - a);
    assert.deepEqual(counts, sortedDesc, 'leaderboard must be ordered by reaction count DESC');
    assert.equal(topBody.topArticles[0].id, testArticleId, 'boosted test article must rank first');
    assert.ok(topBody.topArticles[0].reactionCount >= 44, `boosted article count must reflect upvotes+tips, got ${topBody.topArticles[0].reactionCount}`);
    assert.ok(topBody.topArticles[0].author?.company, 'entries carry the author company');
    assert.ok(topBody.topArticles.every((a) => a.newspaper && typeof a.newspaper.issueId === 'number'), 'entries link to their newspaper issue');
    assert.ok(topBody.topArticles.length <= 15, 'leaderboard is capped at 15 entries (gsr)');

    // Numeric reaction variant must hit the real endpoint (not the legacy stub).
    const topNumeric = await api('GET', '/api/v2/en/0/articles/top-by-reaction/1/');
    assert.equal(topNumeric.status, 200, 'numeric reaction variant must return 200');
    assert.equal((topNumeric.body as { topArticles: Array<{ id: number }> }).topArticles[0].id, testArticleId, 'numeric variant returns the real ranking');

    // Issue payload shows the booked sponsor slots and the test article.
    const issue = await api('GET', `/api/v3/en/0/newspaper/${listBody.issueId}/`);
    assert.equal(issue.status, 200, 'issue fetch must return 200');
    const issueBody = issue.body as { articles: Array<{ id: number }>; sponsor0?: { companyName: string; logo: string } };
    assert.ok(issueBody.articles.some((a) => a.id === testArticleId), 'issue payload includes the test article');
    assert.equal(issueBody.sponsor0?.companyName, author.companyName, 'issue payload exposes the booked golden slot');

    // v3 per-issue sponsors endpoint (spec §3) with pricing + logos.
    const v3Sponsors = await api('GET', `/api/v3/newspaper/${bookableIssueId}/sponsor/`);
    assert.equal(v3Sponsors.status, 200, 'v3 sponsor list must return 200');
    const v3Body = v3Sponsors.body as { sponsors: Array<{ companyName: string; logo: string } | null>; pricing: { goldenPrice: number }; filledSlots: number; allSlotsTaken: boolean };
    assert.ok(Array.isArray(v3Body.sponsors), 'v3 sponsors use the positional array consumed by the frontend');
    assert.equal(v3Body.sponsors[0]?.companyName, author.companyName, 'v3 sponsors include the golden slot');
    assert.equal(typeof v3Body.sponsors[0]?.logo, 'string', 'v3 sponsors carry logos');
    assert.equal(v3Body.pricing.goldenPrice, 20, 'v3 sponsors carry pricing');
    assert.equal(v3Body.filledSlots, 3, 'golden + silver + bronze booked so far');
    console.log('  ✔ ranking DESC, boosted article #1, cap 15, numeric variant, issue payload + v3 sponsors');
    console.log('\n================================================================');
    console.log(' All Issue #83 Newspaper Assertions PASSED with 0 ERRORS!');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      if (existsSync(server.dataDir)) {
        try {
          rmSync(server.dataDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup error
        }
      }
    }
  }
}

runNewspaperVerification().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
