/**
 * Issue #88 regression — achievements criteria gating + display case.
 *
 * Contract under test (decompiled achievements-guide spec):
 *   1. Claim criteria validation — claimAchievement evaluates REAL gameplay
 *      statistics (exchange fills, resolved production batches, upgraded
 *      buildings, executive training payments) before granting. Unmet
 *      criteria → 400 { error: 'Achievement criteria not met',
 *      code: 'CRITERIA_NOT_MET' }. A fresh account can claim nothing.
 *   2. Available is computed from progress vs criteria (progress-based), and
 *      achievement DTOs expose `progress` / `target`.
 *   3. Display case slots are bounded to 1..12 (negative / 0 / > 12 / partial
 *      slots → 400), and placing an item requires OWNING the certificate /
 *      achievement / collectible being placed (400 { code: 'ITEM_NOT_OWNED' }).
 *
 * Runs against a real server on port 3900 with a dedicated DATA_DIR.
 * Every claim-success path is reached through real gameplay driven over HTTP:
 *   - market-tycoon:   buying from the NPC exchange (POST /market-order/take/)
 *   - first-steps:     queueing + collecting an apple production batch
 *   - builder:         upgrading a building (+1 size)
 *   - employer:        paying for executive training (level 15 capability)
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3900');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Issue #88 achievement ids under test:
const ALL_IDS = ['market-tycoon', 'first-steps', 'builder', 'employer-of-the-year'] as const;

const APPLES = 3; // kind 3: produced at Farm 'P', NPC-sold on the exchange

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

  const dataDir = path.resolve('data', `test-run-issue-88-${Date.now()}`);
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
        DATA_DIR: dataDir,
        // 100x production speed so the real production batch finishes in ~4s
        // instead of ~15 minutes. The claim gating itself is wall-clock free.
        SPEED_MULTIPLIER: '100'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3900] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `ach88_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Achiever ${label} ${Date.now()}`
    })
  });
  assert.equal(res.status, 200, `Registration should return 200 for ${label}`);

  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.find((v) => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie must be returned');

  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authRes.status, 200, 'Auth data should return 200');
  const authData = (await authRes.json()) as {
    companyPublicInfo?: { id: number };
    authCompany?: { companyId?: number; id?: number };
  };
  const companyId = authData.companyPublicInfo?.id || authData.authCompany?.companyId || authData.authCompany?.id || 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId };
}

function headers(cookie: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Cookie: cookie };
}

interface AuthCompany {
  companyId: number;
  money?: number;
  simBoosts?: number;
}

async function authCompany(cookie: string): Promise<AuthCompany> {
  const res = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { authCompany: AuthCompany }).authCompany;
}

interface IndividualAchievementDTO {
  id: string;
  done: number;
  available: number;
  progress: number;
  target: number;
}

async function getIndividualAchievements(cookie: string): Promise<IndividualAchievementDTO[]> {
  const res = await fetch(`${BASE_URL}/api/v2/no-cache/companies/me/achievements/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(res.status, 200);
  return (await res.json()) as IndividualAchievementDTO[];
}

async function claimAchievement(
  cookie: string,
  achievementId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/api/v2/no-cache/companies/achievements/${achievementId}/`, {
    method: 'DELETE',
    headers: { Cookie: cookie }
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

interface OverviewEntry {
  id: string;
  progress: { percent: number; label: string };
}

async function getOverview(cookie: string): Promise<OverviewEntry[]> {
  const res = await fetch(`${BASE_URL}/api/v2/companies/me/achievements/`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return (await res.json()) as OverviewEntry[];
}

interface DisplayItem {
  slot: number;
  itemKind?: string;
  resource?: { kind: number; quality: number; title: string };
  achievement?: { id: string; name: string };
  certificate?: { id: number; name: string };
  collectible?: { id: number; name: string };
}

async function getDisplayCase(cookie: string): Promise<DisplayItem[]> {
  const res = await fetch(`${BASE_URL}/api/v2/companies/me/display-case/`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { displayCase: DisplayItem[] }).displayCase;
}

async function postDisplayCase(
  cookie: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/api/v2/companies/me/display-case/`, {
    method: 'POST',
    headers: headers(cookie),
    body: JSON.stringify(body)
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getBuildings(cookie: string): Promise<Array<{ id: number; kind: string; size: number; level: number }>> {
  const res = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return (await res.json()) as Array<{ id: number; kind: string; size: number; level: number }>;
}

/** Retries `fn` until it resolves or the deadline passes. */
// The collect step's precondition (production finishes_at) is bound to the
// wall clock of the separately-spawned server process, so no deterministic
// timer can advance it — a real retry delay is required (ts-no-test-timers
// exception).
async function pollUntil<T>(fn: () => Promise<T>, deadlineMs = 30000, stepMs = 400): Promise<T> {
  const start = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() - start > deadlineMs) throw err;
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }
}

async function runIssue88AchievementsTest(): Promise<void> {
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    const db = new DatabaseSync(server.dbPath);


    // -------------------------------------------------------------------------
    console.log('\n[1/8] Fresh account can claim NOTHING (criteria-gated claims)');
    // -------------------------------------------------------------------------
    const A = await registerCompany('A');
    const B = await registerCompany('B');

    const freshList = await getIndividualAchievements(A.cookie);
    assert.deepEqual(freshList.map(a => a.id), [], 'fresh account must have an EMPTY pending achievements list');


    for (const id of ALL_IDS) {
      const claim = await claimAchievement(A.cookie, id);
      assert.equal(claim.status, 400, `fresh claim of ${id} must be rejected with 400`);
      assert.equal(claim.body.error, 'Achievement criteria not met', `${id}: exact error message required`);
      assert.equal(claim.body.code, 'CRITERIA_NOT_MET', `${id}: CRITERIA_NOT_MET code required`);
    }

    const unknownClaim = await claimAchievement(A.cookie, 'not-real');
    assert.equal(unknownClaim.status, 400, 'unknown achievement claim must be rejected with 400');
    assert.equal(unknownClaim.body.code, 'ACHIEVEMENT_NOT_FOUND');

    const freshOverview = await getOverview(A.cookie);
    assert.equal(freshOverview.length, 4, 'overview still lists all four categories');
    for (const entry of freshOverview) {
      assert.equal(entry.progress.percent, 0, `${entry.id}: fresh progress percent must be 0 (progress-based)`);
      assert.equal(entry.progress.label, '0 / 1', `${entry.id}: fresh progress label must be "0 / 1"`);
    }

    // Company B isolation is checked again after A's gameplay below.

    // -------------------------------------------------------------------------
    console.log('\n[2/8] market-tycoon: real exchange purchase unlocks the claim');
    // -------------------------------------------------------------------------
    const beforeMarket = await authCompany(A.cookie);
    const takeRes = await fetch(`${BASE_URL}/api/v2/market-order/take/`, {
      method: 'POST',
      headers: headers(A.cookie),
      body: JSON.stringify({ resource: APPLES, quantity: 5, maxPrice: 2 })
    });
    assert.equal(takeRes.status, 200, 'market purchase from NPC exchange must succeed');
    const takeBody = (await takeRes.json()) as { amountBought: number };
    assert.equal(takeBody.amountBought, 5, 'purchase must fill 5 units');

    const afterPurchase = await getIndividualAchievements(A.cookie);
    const pending = afterPurchase.find(a => a.id === 'market-tycoon');
    assert.ok(pending, 'market-tycoon must become pending after a real market trade');
    assert.equal(pending!.available, 1, 'market-tycoon available must be criteria-derived (1)');
    assert.equal(pending!.progress, 1, 'market-tycoon progress must reflect the real trade count');
    assert.equal(pending!.target, 1, 'market-tycoon target must be exposed');
    assert.ok(!afterPurchase.some(a => a.id === 'builder'), 'builder must still be absent (criteria unmet)');

    const beforeClaim = await authCompany(A.cookie);
    const claim = await claimAchievement(A.cookie, 'market-tycoon');
    assert.equal(claim.status, 200, 'criteria-met claim must succeed');
    assert.equal(claim.body.success, true);
    assert.equal(claim.body.sim_boosts, 5);
    assert.equal(claim.body.moneyDelta, 5000);
    const afterClaim = await authCompany(A.cookie);
    assert.equal(afterClaim.money, (beforeClaim.money ?? 0) + 5000, 'claim must credit the cash reward');
    assert.equal(afterClaim.simBoosts, (beforeClaim.simBoosts ?? 0) + 5, 'claim must credit SimBoosts');

    const duplicate = await claimAchievement(A.cookie, 'market-tycoon');
    assert.equal(duplicate.status, 400, 'duplicate claim must be rejected');
    assert.equal(duplicate.body.code, 'ACHIEVEMENT_ALREADY_CLAIMED');

    // Company B did no gameplay — must STILL be rejected (cross-account isolation).
    const bClaim = await claimAchievement(B.cookie, 'market-tycoon');
    assert.equal(bClaim.status, 400);
    assert.equal(bClaim.body.code, 'CRITERIA_NOT_MET', 'another fresh company must not benefit from A’s trade');

    const midOverview = await getOverview(A.cookie);
    const marketOverview = midOverview.find(e => e.id === 'market-tycoon');
    assert.ok(marketOverview);
    assert.equal(marketOverview!.progress.percent, 100);
    assert.equal(marketOverview!.progress.label, '已达成');
    const builderOverview = midOverview.find(e => e.id === 'builder');
    assert.ok(builderOverview);
    assert.equal(builderOverview!.progress.percent, 0, 'uncollected builder overview stays progress-based at 0');
    assert.equal(builderOverview!.progress.label, '0 / 1');

    // -------------------------------------------------------------------------
    console.log('\n[3/8] first-steps: real production batch + collect unlocks the claim');
    // -------------------------------------------------------------------------
    const buildings = await getBuildings(A.cookie);
    const farm = buildings.find(b => b.kind === 'P');
    assert.ok(farm, 'starter farm must exist');

    const queueRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${farm!.id}/queue/`, {
      method: 'POST',
      headers: headers(A.cookie),
      body: JSON.stringify({ kind: APPLES, amount: 25 })
    });
    assert.equal(queueRes.status, 200, 'queueing real apple production must succeed');

    // Wait for the batch to finish, then collect it (markResolved => stat source).
    const collectRes = await pollUntil(async () => {
      const res = await fetch(`${BASE_URL}/api/v2/order/take/${farm!.id}/`, {
        method: 'POST',
        headers: headers(A.cookie)
      });
      if (!res.ok) throw new Error(`collect not ready (${res.status})`);
      return res;
    });
    const collectBody = (await collectRes.json()) as {
      success?: boolean;
      resource?: { kind: number; amount: number };
    };
    assert.equal(collectBody.success, true, 'collect must resolve the finished batch');
    assert.equal(collectBody.resource?.kind, APPLES);
    assert.equal(collectBody.resource?.amount, 25, 'collect must deliver the queued 25 apples');

    const productionPending = (await getIndividualAchievements(A.cookie)).find(a => a.id === 'first-steps');
    assert.ok(productionPending, 'first-steps must become pending after the collected production batch');
    assert.equal(productionPending!.progress, 1);

    const firstClaim = await claimAchievement(A.cookie, 'first-steps');
    assert.equal(firstClaim.status, 200, 'first-steps claim must succeed after real production');

    // -------------------------------------------------------------------------
    console.log('\n[4/8] Display case bounds: slots outside 1..12 rejected');
    // -------------------------------------------------------------------------
    for (const slot of [0, -1, 13, 1.5]) {
      const bad = await postDisplayCase(A.cookie, { slot, resourceKind: APPLES });
      assert.equal(bad.status, 400, `slot ${slot} must be rejected with 400`);
      assert.equal(bad.json.code, 'INVALID_SLOT', `slot ${slot} must answer INVALID_SLOT`);
    }
    const caseAfterBounds = await getDisplayCase(A.cookie);
    assert.deepEqual(
      caseAfterBounds.map(i => i.slot).sort((a, b) => a - b),
      [1, 2],
      'rejected placements must not leave rows behind (seeded defaults only)'
    );

    // -------------------------------------------------------------------------
    console.log('\n[5/8] Display case ownership: unowned achievement rejected');
    // -------------------------------------------------------------------------
    const unownedAch = await postDisplayCase(A.cookie, { slot: 5, achievement_id: 'builder' });
    assert.equal(unownedAch.status, 400, 'placing an unclaimed achievement must be rejected');
    assert.equal(unownedAch.json.code, 'ITEM_NOT_OWNED', 'ITEM_NOT_OWNED code required');

    // -------------------------------------------------------------------------
    console.log('\n[6/8] builder: real building upgrade unlocks the claim + display');
    // -------------------------------------------------------------------------
    const grocery = buildings.find(b => b.kind === 'G');
    assert.ok(grocery, 'starter grocery must exist');
    const upgradeRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${grocery!.id}/`, {
      method: 'PATCH',
      headers: headers(A.cookie),
      body: JSON.stringify({ size: 1 })
    });
    assert.equal(upgradeRes.status, 200, 'grocery +1 upgrade must succeed (starter materials + cash)');

    const afterUpgrade = await getBuildings(A.cookie);
    const upgradedGrocery = afterUpgrade.find(b => b.kind === 'G');
    assert.ok((upgradedGrocery!.size ?? upgradedGrocery!.level) >= 2, 'grocery size must be >= 2 after upgrade');

    const builderPending = (await getIndividualAchievements(A.cookie)).find(a => a.id === 'builder');
    assert.ok(builderPending, 'builder must become pending after a real upgrade');
    assert.equal(builderPending!.progress, 1);

    const builderClaim = await claimAchievement(A.cookie, 'builder');
    assert.equal(builderClaim.status, 200, 'builder claim must succeed after real upgrade');

    // NOW placing the (owned) builder achievement must succeed.
    const ownedAch = await postDisplayCase(A.cookie, { slot: 5, achievement_id: 'builder' });
    assert.equal(ownedAch.status, 200, 'placing a CLAIMED achievement must succeed');
    const achItem = (ownedAch.json.displayCase as DisplayItem[]).find(i => i.slot === 5);
    assert.equal(achItem?.itemKind, 'achievement');
    assert.equal(achItem?.achievement?.id, 'builder');

    // -------------------------------------------------------------------------
    console.log('\n[7/8] employer-of-the-year: real executive training unlocks the claim');
    // -------------------------------------------------------------------------
    db.prepare('UPDATE companies SET level = 15 WHERE company_id = ?').run(A.companyId);
    const execsRes = await fetch(`${BASE_URL}/api/v4/executives/`, { headers: { Cookie: A.cookie } });
    assert.equal(execsRes.status, 200);
    const execs = (await execsRes.json()) as { executives: Array<{ id: number }> };
    assert.ok(execs.executives.length > 0, 'seeded employed executives must be listed');
    const trainRes = await fetch(`${BASE_URL}/api/v4/executives/${execs.executives[0]!.id}/train/`, {
      method: 'POST',
      headers: headers(A.cookie),
      body: JSON.stringify({})
    });
    assert.equal(trainRes.status, 200, 'executive training must succeed at level 15 with cash');

    const employerPending = (await getIndividualAchievements(A.cookie)).find(a => a.id === 'employer-of-the-year');
    assert.ok(employerPending, 'employer-of-the-year must become pending after real training');
    assert.equal(employerPending!.progress, 1);

    const employerClaim = await claimAchievement(A.cookie, 'employer-of-the-year');
    assert.equal(employerClaim.status, 200, 'employer-of-the-year claim must succeed after real training');

    const drainedList = await getIndividualAchievements(A.cookie);
    assert.deepEqual(drainedList.map(a => a.id), [], 'all collected — pending list must be empty again');

    // -------------------------------------------------------------------------
    console.log('\n[8/8] Display case: certificate / collectible / resource ownership');
    // -------------------------------------------------------------------------
    // Certificate: unknown certificate id → not owned.
    const badCert = await postDisplayCase(A.cookie, { slot: 6, certificate_id: 987654 });
    assert.equal(badCert.status, 400);
    assert.equal(badCert.json.code, 'ITEM_NOT_OWNED');

    // Collectible: unknown NFT asset → not owned (fail closed).
    const badNft = await postDisplayCase(A.cookie, { slot: 7, nft_id: 987654 });
    assert.equal(badNft.status, 400);
    assert.equal(badNft.json.code, 'ITEM_NOT_OWNED');

    // Body-shape rule: exactly ONE item type id must be provided.
    const zeroItems = await postDisplayCase(A.cookie, { slot: 9 });
    assert.equal(zeroItems.status, 400);
    assert.equal(zeroItems.json.code, 'INVALID_ITEM');
    const multiItems = await postDisplayCase(A.cookie, { slot: 9, resource_id: APPLES, achievement_id: 'builder' });
    assert.equal(multiItems.status, 400);
    assert.equal(multiItems.json.code, 'INVALID_ITEM');

    // Certificate owned: award one to company A directly, then place it.
    const certId = Number(db.prepare(`
      INSERT INTO certificates (realm_id, kind, place, name, company_id, company_name, value, rarity, year_started, resource_kind, datetime)
      VALUES (0, 29, 1, 'Test Award', ?, 'Achiever A', 1000, 0.05, 2026, NULL, ?)
    `).run(A.companyId, new Date().toISOString()).lastInsertRowid);
    const goodCert = await postDisplayCase(A.cookie, { slot: 6, certificate_id: certId });
    assert.equal(goodCert.status, 200, 'placing an owned certificate must succeed');
    const certItem = (goodCert.json.displayCase as DisplayItem[]).find(i => i.slot === 6);
    assert.equal(certItem?.itemKind, 'certificate');
    assert.equal(certItem?.certificate?.id, certId);

    // Collectible owned: mint an NFT asset owned by A (issue #100 table), place it.
    const nftTables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='nft_assets'"
    ).get();
    assert.ok(nftTables, 'nft_assets table must exist (issue #100 migration tail)');
    const nftId = Number(db.prepare(`
      INSERT INTO nft_assets (definition_id, name, image, realm, rarity, description, current_owner_id, minted_at)
      VALUES (?, 'Test Trophy', 'images/collectibles/trophy_01.png', 0, 0.05, 'issue 88 fixture', ?, ?)
    `).run(`ach88-${A.companyId}`, A.companyId, new Date().toISOString()).lastInsertRowid);
    const goodNft = await postDisplayCase(A.cookie, { slot: 7, nft_id: nftId });
    assert.equal(goodNft.status, 200, 'placing an owned collectible must succeed');
    const nftItem = (goodNft.json.displayCase as DisplayItem[]).find(i => i.slot === 7);
    assert.equal(nftItem?.itemKind, 'collectible');
    assert.equal(nftItem?.collectible?.id, nftId);

    // Resource placement still works (legacy shape + spec shape).
    const goodResource = await postDisplayCase(A.cookie, { slot: 8, resource_id: APPLES, quality: 0, title: 'Apples' });
    assert.equal(goodResource.status, 200, 'placing an owned resource must succeed');
    const resourceItem = (goodResource.json.displayCase as DisplayItem[]).find(i => i.slot === 8);
    assert.equal(resourceItem?.resource?.kind, APPLES);

    // Final display case: seeded slots 1-2, achievement 5, certificate 6, collectible 7, resource 8.
    const finalCase = await getDisplayCase(A.cookie);
    assert.deepEqual(
      finalCase.map(i => i.slot).sort((a, b) => a - b),
      [1, 2, 5, 6, 7, 8],
      'display case must contain exactly the seeded + placed items'
    );

    // Final overview: everything collected → progress 100 for all categories.
    const finalOverview = await getOverview(A.cookie);
    for (const entry of finalOverview) {
      assert.equal(entry.progress.percent, 100, `${entry.id}: final progress must be 100`);
      assert.equal(entry.progress.label, '已达成', `${entry.id}: final label must be 已达成`);
    }

    db.close();
    console.log('\n================================================================');
    console.log(' All Issue #88 Achievements Assertions PASSED with 0 ERRORS!');
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

runIssue88AchievementsTest().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
