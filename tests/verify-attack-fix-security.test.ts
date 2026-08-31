/**
 * Regression tests for attack-confirmed findings C-1, C-7, C-9, C-18.
 *
 * Run against a live private server:
 *   PORT=3401 SPEED_MULTIPLIER=200 DATA_DIR=data/test-run-<port> \
 *     /opt/magnate/.node22/bin/node --experimental-strip-types server/index.ts
 *   BASE_URL=http://127.0.0.1:3401 /opt/magnate/.node22/bin/node \
 *     --experimental-strip-types tests/verify-attack-fix-security.test.ts
 *
 * C-1  (P0): POST /api/v2/companies/:id/free-text/ requires a session and
 *            ownership (targetCompanyId === currentCompanyId); foreign or
 *            anonymous writes get 401 and never touch companies.note.
 * C-7  (P1): readJsonBody rejects null / scalar JSON bodies with 4xx, so
 *            POST /api/v2/message/ and /api/v2/players/language/ return 400,
 *            never 500.
 * C-9  (P1): boosts->cash exchange shares the per-UTC-day exchangedToday
 *            bucket with the "fair" exchange (simboostsExchangeLimit,
 *            capped at EXCHANGE_DAILY_LIMIT cash/day).
 * C-18 (P3): non-finite money is rejected at write paths and sanitized to a
 *            numeric value in authCompany payload (never JSON null).
 */
import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { resetPurchaseLedger, exchangeSimBoosts } from '../server/game/simboosts.ts';
import { getCompanyBoostSettings } from '../server/game/simboost-settings.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { getAuthData } from '../server/game/company.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3401'}`;

async function fetchWithRateRetry(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  let retries = 0;
  while (response.status === 429 && retries < 70) {
    const retryAfter = Number(response.headers.get('Retry-After') || '2');
    await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 5) * 1000));
    response = await fetch(url, init);
    retries++;
  }
  return response;
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `sec_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetchWithRateRetry(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test12345!' })
  });
  assert.equal(response.status, 200, `registration for ${label} must succeed`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'session cookie must be set');
  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = (await authResponse.json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function getFreeText(id: number | 'me', cookie?: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}/api/v2/companies/${id}/free-text/`, {
    method: 'GET',
    headers: cookie ? { Cookie: cookie } : {}
  });
  return { status: res.status, body: await res.text() };
}

async function postFreeText(id: number | 'me', body: unknown, cookie?: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}/api/v2/companies/${id}/free-text/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { status: res.status, body: await res.text() };
}

const noteInDb = (companyId: number): string | null =>
  (db.prepare('SELECT note FROM companies WHERE company_id = ?').get(companyId) as { note: string | null } | undefined)?.note ?? null;

let passed = 0;
function step(name: string, fn: () => Promise<void> | void): Promise<void> {
  return (async () => {
    await fn();
    passed += 1;
    console.log(`  PASS [${passed}] ${name}`);
  })();
}

async function runTests(): Promise<void> {
  console.log('================================================================');
  console.log(' Attack-Fix Security Verification (C-1, C-7, C-9, C-18)');
  console.log(` Base URL: ${baseUrl}`);
  console.log('================================================================');

  resetPurchaseLedger();

  // ------------------------------------------------------------------
  // C-1 (P0): free-text write requires session + ownership
  // ------------------------------------------------------------------
  const { cookie, companyId } = await register('c1owner');
  const { companyId: foreignId } = await register('c1foreign');
  assert.notEqual(companyId, foreignId, 'fixtures must be distinct companies');

  await step('C-1: anonymous POST free-text -> 401, note untouched', async () => {
    const res = await postFreeText(companyId, { freeText: 'HACKED-BY-AUDIT' });
    assert.equal(res.status, 401, `expected 401, got ${res.status}: ${res.body}`);
    assert.notEqual(noteInDb(companyId), 'HACKED-BY-AUDIT');
  });

  await step('C-1: session POST to foreign company id -> 401, foreign note untouched', async () => {
    const res = await postFreeText(foreignId, { freeText: 'HACKED-BY-AUDIT' }, cookie);
    assert.equal(res.status, 401, `expected 401, got ${res.status}: ${res.body}`);
    assert.notEqual(noteInDb(foreignId), 'HACKED-BY-AUDIT');
  });

  await step('C-1: owner POST to own company -> 200 and persisted', async () => {
    const res = await postFreeText(companyId, { freeText: 'my legit bio' }, cookie);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body}`);
    assert.equal(JSON.parse(res.body), 'my legit bio');
    assert.equal(noteInDb(companyId), 'my legit bio');
    const readBack = await getFreeText(companyId);
    assert.equal(readBack.status, 200);
    assert.equal(JSON.parse(readBack.body), 'my legit bio');
  });

  await step('C-1: owner POST via "me" alias writes own note', async () => {
    const res = await postFreeText('me', { freeText: 'me alias bio' }, cookie);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body}`);
    assert.equal(noteInDb(companyId), 'me alias bio');
  });

  await step('C-1: GET free-text stays public (no cookie required)', async () => {
    const res = await getFreeText(companyId);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body), 'me alias bio');
  });

  // ------------------------------------------------------------------
  // C-7 (P1): null / scalar JSON body -> 4xx, never 500
  // ------------------------------------------------------------------
  const nullBodyCases: Array<{ path: string; body: string; name: string }> = [
    { path: '/api/v2/message/', body: 'null', name: 'message null body' },
    { path: '/api/v2/message/', body: '42', name: 'message scalar body' },
    { path: '/api/v2/message/', body: '"str"', name: 'message string body' },
    { path: '/api/v2/players/language/', body: 'null', name: 'language null body' },
    { path: '/api/v2/players/language/', body: 'true', name: 'language scalar body' }
  ];

  await step('C-7: null/scalar JSON bodies return 4xx on message/language', async () => {
    const { cookie: c7 } = await register('c7');
    for (const c of nullBodyCases) {
      const res = await fetch(`${baseUrl}${c.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c7 },
        body: c.body
      });
      assert.ok(res.status >= 400 && res.status < 500,
        `${c.name}: expected 4xx, got ${res.status}`);
      assert.notEqual(res.status, 500, `${c.name} must never 500`);
    }
  });

  await step('C-7: valid JSON object bodies still accepted (no regression)', async () => {
    const { cookie: c7 } = await register('c7ok');
    const lang = await fetch(`${baseUrl}/api/v2/players/language/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: c7 },
      body: JSON.stringify({ code: 'en' })
    });
    assert.equal(lang.status, 200, `valid language body must be 200, got ${lang.status}`);
  });

  // ------------------------------------------------------------------
  // C-9 (P1): boosts->cash exchange daily cap
  // ------------------------------------------------------------------
  await step('C-9: exchange below cap succeeds and records usage', async () => {
    const { companyId: cid } = await register('c9a');
    const result = await exchangeSimBoosts(cid, 10);
    assert.equal(result.success, true);
    assert.equal(result.moneyAdded, 1000);
    const settings = getCompanyBoostSettings(cid);
    assert.equal(settings.exchangedToday, 1000, 'counter must record exchanged cash');
    assert.ok(settings.exchangeDate !== '', 'exchange bucket date must be set');
  });

  await step('C-9: exchange past EXCHANGE_DAILY_LIMIT rejected, balances intact', async () => {
    const { companyId: cid } = await register('c9b');
    // Seed enough boost balance for an oversized exchange attempt.
    db.prepare('UPDATE companies SET simboosts = 100000 WHERE company_id = ?').run(cid);

    // Fill the daily bucket near the cap via smaller exchanges.
    await exchangeSimBoosts(cid, 50); // 5000 cash
    const cap = 10000;
    const before = getCompanyBoostSettings(cid).exchangedToday;
    assert.equal(before, 5000);

    await assert.rejects(
      () => exchangeSimBoosts(cid, 60), // 6000 cash -> 11000 > 10000
      (err: Error) => /cannot exchange that many simboosts today/i.test(err.message),
      'exchange beyond the daily cap must be rejected'
    );
    const after = getCompanyBoostSettings(cid).exchangedToday;
    assert.equal(after, 5000, 'counter unchanged by rejected attempt');
    // Balances untouched by the rejected transaction.
    const row = db.prepare('SELECT money, simboosts FROM companies WHERE company_id = ?').get(cid) as { money: number; simboosts: number };
    assert.equal(row.simboosts, 100000 - 50, 'boosts unchanged by rejected attempt');
  });

  await step('C-9: exchange that exactly reaches the cap succeeds', async () => {
    const { companyId: cid } = await register('c9c');
    db.prepare('UPDATE companies SET simboosts = 100000 WHERE company_id = ?').run(cid);
    // 100 boosts = 10000 cash = exactly the daily cap.
    const result = await exchangeSimBoosts(cid, 100);
    assert.equal(result.moneyAdded, 10000);
    assert.equal(getCompanyBoostSettings(cid).exchangedToday, 10000);
    await assert.rejects(
      () => exchangeSimBoosts(cid, 1),
      (err: Error) => /cannot exchange that many simboosts today/i.test(err.message),
      'any further exchange the same UTC day must fail'
    );
  });

  // ------------------------------------------------------------------
  // C-18 (P3): non-finite money rejected on write, sanitized on read
  // ------------------------------------------------------------------
  await step('C-18: repository credit/debit reject non-finite amounts', async () => {
    for (const amount of [Infinity, -Infinity, NaN]) {
      assert.throws(() => companyRepository.creditMoney(999999999, amount), /finite/i, `creditMoney(${amount})`);
      assert.throws(() => companyRepository.debitMoney(999999999, amount), /finite/i, `debitMoney(${amount})`);
      assert.throws(() => companyRepository.creditSimboosts(999999999, amount), /finite/i, `creditSimboosts(${amount})`);
      assert.throws(() => companyRepository.debitSimboosts(999999999, amount), /finite/i, `debitSimboosts(${amount})`);
    }
  });

  await step('C-18: non-finite DB money cannot be written via updateCompanyMoney', async () => {
    const { companyId: cid } = await register('c18');
    await assert.rejects(
      // dynamic import to avoid top-level coupling; updateCompanyMoney throws on non-finite delta
      () => import('../server/game/company.ts').then(m => m.updateCompanyMoney(cid, Infinity)),
      (err: Error) => /finite/i.test(err.message)
    );
    const row = db.prepare('SELECT money FROM companies WHERE company_id = ?').get(cid) as { money: number };
    assert.ok(Number.isFinite(Number(row.money)), 'money must remain finite after rejected write');
  });

  await step('C-18: authCompany.money is numeric even with non-finite legacy row', async () => {
    const { companyId: cid } = await register('c18legacy');
    const { playerId } = db.prepare('SELECT player_id AS playerId FROM companies WHERE company_id = ?').get(cid) as { playerId: number };
    // Simulate a legacy corrupted row written before the guards existed.
    db.prepare('UPDATE companies SET money = ? WHERE company_id = ?').run(Infinity, cid);
    const auth = getAuthData(playerId, cid);
    assert.ok(auth, 'auth data must resolve');
    assert.equal(typeof auth!.authCompany.money, 'number', 'money must be numeric, not null');
    assert.ok(Number.isFinite(auth!.authCompany.money), 'money must be finite in payload');
  });

  console.log('================================================================');
  console.log(` All ${passed} checks passed.`);
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
