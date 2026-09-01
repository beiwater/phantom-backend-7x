/**
 * Regression tests for Issue #78 Part 2:
 * 1. Warehouse Contracts Summary (/api/v2/warehouse-contracts-summary/:companyId/:type/)
 * 2. Resource Transactions History & Summary (/api/v2/resources-transactions/ & summary)
 * 3. Incoming & Outgoing Contracts Endpoints (v2 & v3 compatibility)
 * 4. Building Auctions Compatibility (active-unlocks, buildingAuctions, similarBuildingAuctions, bids)
 *
 * Usage:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-78-part2.test.ts
 */
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '3620';
const baseUrl = `http://127.0.0.1:${PORT}`;
const dataDir = path.resolve('data', `test-run-i78-part2-${Date.now()}`);

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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: ApiResult['json'] = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON bodies ignored
  }
  return { status: response.status, headers: response.headers, json };
}

function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const interval = setInterval(async () => {
    try {
      const res = await fetch(url);
      if (res.status < 500) {
        clearInterval(interval);
        resolve();
      }
    } catch {
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Server unreachable at ${url} within ${timeoutMs}ms`));
      }
    }
  }, 100);
  return promise;
}

async function run(): Promise<void> {
  console.log(`Launching test server on port ${PORT} with data dir ${dataDir}...`);
  const nodeBinary = process.execPath.includes('.node22')
    ? process.execPath
    : '/opt/magnate/.node22/bin/node';

  const child: ChildProcess = spawn(
    nodeBinary,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        SPEED_MULTIPLIER: '200'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', chunk => {
    const msg = chunk.toString();
    if (!msg.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3620] ${msg}`);
    }
  });

  try {
    await waitUntilReachable(`${baseUrl}/version/`, 30000);
    console.log('Server is reachable. Running test suite...\n');

    // Setup: Register a user
    let cookie = '';
    let companyId = 0;

    await test('Auth: Register new company', async () => {
      const email = `test_i78_${Date.now()}@example.com`;
      const res = await api(null, 'POST', '/api/v2/auth/email/connect/', {
        email,
        password: 'Password123!'
      });
      assert.equal(res.status, 200, `Register failed with status ${res.status}`);
      const rawCookie = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
      cookie = rawCookie.find(c => c.startsWith('sessionid='))?.split(';')[0] || '';
      assert.ok(cookie, 'Missing sessionid cookie');

      const authRes = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
      assert.equal(authRes.status, 200);
      const authData = authRes.json as { authCompany: { companyId: number } };
      companyId = authData.authCompany.companyId;
      assert.ok(companyId > 0, 'Company ID not found');
    });

    // 1. Warehouse contracts summary
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

    await test('Warehouse: GET /api/v2/warehouse-contracts-summary/0/1/ (numeric kind)', async () => {
      const res = await api(cookie, 'GET', '/api/v2/warehouse-contracts-summary/0/1/');
      assert.equal(res.status, 200);
      const data = res.json as { summary: unknown[] };
      assert.ok(Array.isArray(data.summary), 'Expected summary to be an array');
      assert.ok(res.headers.get('x-timestamp'), 'Expected x-timestamp header');
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
      const data = res.json as { totalBought: number; totalSold: number; totalProduced: number; avgPrice: number };
      assert.equal(typeof data.totalBought, 'number');
      assert.equal(typeof data.totalSold, 'number');
      assert.equal(typeof data.totalProduced, 'number');
      assert.equal(typeof data.avgPrice, 'number');
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

    await test('Building Auctions: GET /api/v2/building-auctions/research-by-auction/:id/', async () => {
      const res = await api(cookie, 'GET', '/api/v2/building-auctions/research-by-auction/1/');
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
      const res = await api(cookie, 'GET', '/api/v2/building-auctions/bids/1/');
      assert.equal(res.status, 200);
      const data = res.json as { bids: unknown[] };
      assert.ok(Array.isArray(data.bids), 'Expected bids array');
    });

  } finally {
    console.log('\nTearing down test server...');
    child.kill('SIGTERM');
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  }

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
