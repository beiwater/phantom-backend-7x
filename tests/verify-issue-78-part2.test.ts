/**
 * Regression tests for Issue #78 Part 2:
 * 1. Warehouse Contracts Summary (/api/v2/warehouse-contracts-summary/:companyId/:type/)
 * 2. Resource Transactions History & Summary (/api/v2/resources-transactions/ & summary)
 * 3. Incoming & Outgoing Contracts Endpoints (v2 & v3 compatibility)
 * 4. Building Auctions Compatibility (active-unlocks, buildingAuctions, similarBuildingAuctions, bids)
 *
 * Usage:
 *   node --experimental-strip-types tests/verify-issue-78-part2.test.ts
 */
import assert from 'node:assert/strict';
import { withTestServer, type TestServer } from './support/test-server.ts';

let server: TestServer;

interface ApiResult {
  status: number;
  headers: Headers;
  json: Record<string, unknown> | unknown[] | null;
}

interface TestOutcome {
  name: string;
  ok: boolean;
  error?: unknown;
}

const results: TestOutcome[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS ${name}`);
  } catch (err: unknown) {
    results.push({ name, ok: false, error: err });
    console.error(`  FAIL ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

async function api(
  cookie: string | null,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<ApiResult> {
  return server.request(method, urlPath, { cookie: cookie || undefined, body });
}

async function run(): Promise<void> {
  await withTestServer(async instance => {
    server = instance;
    // Setup: Register a user
    let cookie = '';
    let companyId = 0;

    await test('Auth: Register new company', async () => {
      const account = await server.registerCompany('issue78part2');
      cookie = account.cookie;
      companyId = account.companyId;

    });

    // 1. Warehouse contracts summary
    // Official bundle callsite: frontend-original/static/bundle/assets/index-cgzgptQ8.js
    // around byte 1,364,695 calls this API with authCompany.companyId and the
    // incoming/outgoing direction. Do not reinterpret the first parameter as a realm.
    await test('Warehouse: GET /api/v2/warehouse-contracts-summary/:companyId/incoming/', async () => {
      const res = await api(cookie, 'GET', `/api/v2/warehouse-contracts-summary/${companyId}/incoming/`);
      assert.equal(res.status, 200);
      const data = res.json as { summary: unknown[] };
      assert.ok(Array.isArray(data.summary), 'Expected summary to be an array');
      assert.ok(res.headers.get('x-timestamp'), 'Expected x-timestamp header');
    });

    await test('Warehouse: GET /api/v2/warehouse-contracts-summary/:companyId/outgoing/', async () => {
      const res = await api(cookie, 'GET', `/api/v2/warehouse-contracts-summary/${companyId}/outgoing/`);
      assert.equal(res.status, 200);
      const data = res.json as { summary: unknown[] };
      assert.ok(Array.isArray(data.summary), 'Expected summary to be an array');
      assert.ok(res.headers.get('x-timestamp'), 'Expected x-timestamp header');
    });

    await test('Warehouse: contracts summary rejects missing and foreign company ids', async () => {
      const missingCompany = await api(cookie, 'GET', '/api/v2/warehouse-contracts-summary/0/1/');
      assert.equal(missingCompany.status, 401, 'Company id 0 is not the authenticated company');

      const foreignCompany = await server.registerCompany('issue78part2foreign');
      const foreign = await api(cookie, 'GET', '/api/v2/warehouse-contracts-summary/' + foreignCompany.companyId + '/incoming/');
      assert.equal(foreign.status, 401, 'A company cannot read another company’s contract summary');
    });

    // 2. Resource Transactions History & Summary
    await test('Warehouse: GET /api/v2/resources-transactions/:companyId/:kind/', async () => {
      const res = await api(cookie, 'GET', `/api/v2/resources-transactions/${companyId}/1/`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json), 'Expected resource transactions to be an array');
    });

    await test('Warehouse: GET /api/v2/resources-transactions-summary/:companyId/:kind/', async () => {
      const res = await api(cookie, 'GET', `/api/v2/resources-transactions-summary/${companyId}/1/`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, [], 'fresh company has no persisted market trades');
      const tradedAt = new Date().toISOString();
      server.db.prepare('INSERT INTO market_trades (kind, quality, amount, price, fee, buyer_id, seller_id, trade_date, traded_at) VALUES (1, 0, 4, 50, 0, ?, NULL, ?, ?)')
        .run(companyId, tradedAt.slice(0, 10), tradedAt);
      const traded = await api(cookie, 'GET', `/api/v2/resources-transactions-summary/${companyId}/1/`);
      assert.equal(traded.status, 200);
      assert.deepEqual(traded.json, [{ category: 'bought', amount: 4, avgPrice: 50, price: 50 }]);
    });

    // 3. Incoming & Outgoing Contracts Endpoints
    await test('Contracts: GET /api/v2/contracts-incoming/ (authorized)', async () => {
      const res = await api(cookie, 'GET', '/api/v2/contracts-incoming/');
      assert.equal(res.status, 200);
      const data = res.json as { incomingContracts: unknown[] };
      assert.ok(Array.isArray(data.incomingContracts), 'Expected incomingContracts array');
      assert.ok(res.headers.get('x-timestamp'), 'Expected x-timestamp header');
    });

    await test('Contracts: GET /api/v2/contracts-incoming/ (unauthorized -> 401)', async () => {
      const res = await api(null, 'GET', '/api/v2/contracts-incoming/');
      assert.equal(res.status, 401);
    });

    await test('Contracts: GET /api/v3/contracts-incoming/0/me/', async () => {
      const res = await api(cookie, 'GET', '/api/v3/contracts-incoming/0/me/');
      assert.equal(res.status, 200);
      const data = res.json as { incomingContracts: unknown[] };
      assert.ok(Array.isArray(data.incomingContracts), 'Expected incomingContracts array');
      assert.ok(res.headers.get('x-timestamp'), 'Expected x-timestamp header');
    });

    await test('Contracts: GET /api/v3/contracts-incoming/1/3/', async () => {
      const res = await api(cookie, 'GET', `/api/v3/contracts-incoming/${companyId}/3/`);
      assert.equal(res.status, 200);
      const data = res.json as { incomingContracts: unknown[] };
      assert.ok(Array.isArray(data.incomingContracts), 'Expected incomingContracts array');
    });

    await test('Contracts: GET /api/v2/contracts-outgoing/ (authorized)', async () => {
      const res = await api(cookie, 'GET', '/api/v2/contracts-outgoing/');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json), 'Expected outgoing contracts array');
      assert.ok(res.headers.get('x-timestamp'), 'Expected x-timestamp header');
    });

    await test('Contracts: GET /api/v2/contracts-outgoing/ (unauthorized -> 401)', async () => {
      const res = await api(null, 'GET', '/api/v2/contracts-outgoing/');
      assert.equal(res.status, 401);
    });

    await test('Contracts: GET /api/v3/contracts-outgoing/me/', async () => {
      const res = await api(cookie, 'GET', '/api/v3/contracts-outgoing/me/');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json), 'Expected outgoing contracts array');
      assert.ok(res.headers.get('x-timestamp'), 'Expected x-timestamp header');
    });

    await test('Contracts: GET /api/v3/contracts-outgoing/:companyId/', async () => {
      const res = await api(cookie, 'GET', `/api/v3/contracts-outgoing/${companyId}/`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json), 'Expected outgoing contracts array');
    });

    await test('Contracts: GET /api/v2/contracts-history-incoming/ and /outgoing/', async () => {
      const resIn = await api(cookie, 'GET', '/api/v2/contracts-history-incoming/');
      assert.equal(resIn.status, 200);
      assert.ok(Array.isArray(resIn.json));

      const resOut = await api(cookie, 'GET', '/api/v2/contracts-history-outgoing/');
      assert.equal(resOut.status, 200);
      assert.ok(Array.isArray(resOut.json));
    });

    // 4. Building Auctions Compatibility
    await test('Building Auctions: GET /api/v2/building-auctions/active-unlocks/', async () => {
      const res = await api(cookie, 'GET', '/api/v2/building-auctions/active-unlocks/');
      assert.equal(res.status, 200);
      const data = res.json as { activeUnlocks: unknown[] };
      assert.ok(Array.isArray(data.activeUnlocks), 'Expected e.data.activeUnlocks array');
    });

    await test('Building Auctions: GET /api/v2/building-auctions/:id/', async () => {
      const res = await api(cookie, 'GET', '/api/v2/building-auctions/1/');
      assert.equal(res.status, 200);
      const data = res.json as { buildingAuctions: unknown[] };
      assert.ok(Array.isArray(data.buildingAuctions), 'Expected t.data.buildingAuctions array');
    });

    await test('Building Auctions: GET /api/v2/companies/:id/building-auctions/', async () => {
      const res = await api(cookie, 'GET', `/api/v2/companies/${companyId}/building-auctions/`);
      assert.equal(res.status, 200);
      const data = res.json as { buildingAuctions: unknown[] };
      assert.ok(Array.isArray(data.buildingAuctions), 'Expected t.data.buildingAuctions array');
    });

    await test('Building Auctions: POST /api/v2/building-auctions/research-by-auction/:id/', async () => {
      const wrongMethod = await api(cookie, 'GET', '/api/v2/building-auctions/research-by-auction/1/');
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.headers.get('allow'), 'POST');
      const res = await api(cookie, 'POST', '/api/v2/building-auctions/research-by-auction/1/', {});
      assert.equal(res.status, 200);
      const data = res.json as { similarBuildingAuctions: unknown[] };
      assert.ok(Array.isArray(data.similarBuildingAuctions), 'Expected similarBuildingAuctions array');
    });

    await test('Building Auctions: GET /api/v2/building-auctions/research-by-building/:id/', async () => {
      const res = await api(cookie, 'GET', '/api/v2/building-auctions/research-by-building/1/');
      assert.equal(res.status, 200);
      const data = res.json as { similarBuildingAuctions: unknown[] };
      assert.ok(Array.isArray(data.similarBuildingAuctions), 'Expected similarBuildingAuctions array');
    });

    await test('Building Auctions: GET /api/v2/building-auctions/bids/:id/', async () => {
      const foreign = await api(cookie, 'GET', '/api/v2/building-auctions/bids/1/');
      assert.equal(foreign.status, 403, 'sealed bids for another company are private');
      const res = await api(cookie, 'GET', `/api/v2/building-auctions/bids/${companyId}/`);
      assert.equal(res.status, 200);
      const data = res.json as { bids: unknown[] };
      assert.ok(Array.isArray(data.bids), 'Expected bids array');
    });

  }, { env: { SPEED_MULTIPLIER: '200' } });

  const failures = results.filter(r => !r.ok);
  console.log(`\n========================================`);
  console.log(`Results: ${results.length - failures.length} passed, ${failures.length} failed`);
  console.log(`========================================\n`);

  if (failures.length > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
