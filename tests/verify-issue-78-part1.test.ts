/**
 * Verification & Regression tests for Issue #78 Part 1:
 * 1. Analytics Endpoints (/api/v2/analytics/... and /api/v3/analytics/...)
 * 2. Admin Route (/admin-xSwwtH67Cr)
 * 3. Moderator Notes Schema (/api/v2/moderator-notes/)
 * 4. Private Messages Audit (/api/v2/messages-cases/ and /api/v2/messages-cases/:id/)
 * 5. Company Audit Personal Endpoint (/api/v2/audit/:id/personal/)
 * 6. Newcomers Endpoint (/api/v2/newcomers/)
 * 7. Redeem Bonus Code Endpoint (/api/v2/redeem-code/:playerId/)
 *
 * Usage:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-78-part1.test.ts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '3610';
const baseUrl = `http://127.0.0.1:${PORT}`;
const dataDir = path.resolve('data', `test-run-i78-part1-${Date.now()}`);

interface ApiResult {
  status: number;
  headers: Headers;
  json: Record<string, unknown> | unknown[] | null;
  text: string;
}

interface TestOutcome {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestOutcome[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message, durationMs: Date.now() - start });
    console.error(`  ✗ ${name} (${Date.now() - start}ms)`);
    console.error(`    Error: ${message}`);
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
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json: Record<string, unknown> | unknown[] | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not json
  }
  return { status: response.status, headers: response.headers, json, text };
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
      process.stderr.write(`[server-3610] ${msg}`);
    }
  });

  try {
    await waitUntilReachable(`${baseUrl}/version/`, 30000);
    console.log('Server is reachable. Running test suite...\n');

    let cookie = '';
    let companyId = 0;
    let playerId = 0;

    await test('Setup: Register test company', async () => {
      const email = `test_i78_p1_${Date.now()}@example.com`;
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
      const authData = authRes.json as {
        authCompany: { companyId: number; simBoosts: number; simboosts?: number };
        authUser: { id: number };
      };
      companyId = authData.authCompany.companyId;
      playerId = authData.authUser.id;
      assert.ok(companyId > 0, 'Company ID not found');
      assert.ok(playerId > 0, 'Player ID not found');
    });

    // 1. Analytics Endpoints: All must return [] (not {})
    const analyticsEndpoints = [
      '/api/v2/analytics/lifetime-value/',
      '/api/v2/analytics/player-base/',
      '/api/v2/analytics/player-registrations/',
      '/api/v2/analytics/player-retention/',
      '/api/v2/analytics/purchases-by-size/',
      '/api/v2/analytics/recent-payments/',
      '/api/v2/analytics/revenue-by-country/',
      '/api/v2/analytics/revenue-by-provider/',
      '/api/v2/analytics/revenue-heartbeat/',
      '/api/v2/analytics/revenue-this-month/',
      '/api/v2/analytics/revenue-timeline/',
      '/api/v2/analytics/time-to-purchase/',
      '/api/v3/analytics/simboosts-spend/',
      '/api/v3/analytics/simboosts-spend/year-ago/'
    ];

    for (const ep of analyticsEndpoints) {
      await test(`Analytics: GET ${ep} returns array []`, async () => {
        const res = await api(cookie, 'GET', ep);
        assert.equal(res.status, 200, `Expected 200 from ${ep}`);
        assert.ok(
          Array.isArray(res.json),
          `Expected array response from ${ep}, got: ${JSON.stringify(res.json)}`
        );
      });
    }

    // 2. Admin Route (/admin-xSwwtH67Cr & /admin-xSwwtH67Cr/)
    await test('Admin: GET /admin-xSwwtH67Cr returns 200 text/html', async () => {
      const res = await api(cookie, 'GET', '/admin-xSwwtH67Cr');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      assert.ok(res.text.includes('Admin Control Panel') || res.text.includes('Admin Dashboard'));
    });

    await test('Admin: GET /admin-xSwwtH67Cr/ returns 200 text/html', async () => {
      const res = await api(cookie, 'GET', '/admin-xSwwtH67Cr/');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      assert.ok(res.text.includes('Admin Control Panel') || res.text.includes('Admin Dashboard'));
    });

    // 3. Moderator Notes Schema
    await test('Moderator Notes: GET /api/v2/moderator-notes/ schema matches expected fields', async () => {
      const res = await api(cookie, 'GET', '/api/v2/moderator-notes/');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json), 'Expected array of moderator notes');
      assert.ok((res.json as unknown[]).length > 0, 'Expected non-empty notes list');

      for (const item of res.json as Array<Record<string, unknown>>) {
        assert.ok(typeof item.id === 'number', 'Note id must be number');
        assert.ok(typeof item.note === 'string', 'Note text must be string');
        assert.ok(typeof item.datetime === 'string', 'Datetime must be string');

        // company object
        const comp = item.company as Record<string, unknown> | undefined;
        assert.ok(comp, 'Note must have company object');
        assert.ok(typeof comp?.id === 'number', 'Company id must be number');
        assert.ok(typeof comp?.company === 'string', 'Company name must be string');
        assert.ok(typeof comp?.logo === 'string', 'Company logo must be string');
        assert.ok(typeof comp?.realmId === 'number', 'Company realmId must be number');

        // moderator object
        const mod = item.moderator as Record<string, unknown> | undefined;
        assert.ok(mod, 'Note must have moderator object');
        assert.ok(typeof mod?.id === 'number', 'Moderator id must be number');
        assert.ok(typeof mod?.name === 'string', 'Moderator name must be string');
        assert.ok(typeof mod?.company === 'string', 'Moderator company must be string');
      }
    });

    // 4. Private Messages Audit (/api/v2/messages-cases/)
    await test('Messages Cases: GET /api/v2/messages-cases/ returns list with snitch & offender', async () => {
      const res = await api(cookie, 'GET', '/api/v2/messages-cases/');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json), 'Expected array of cases');
      assert.ok((res.json as unknown[]).length > 0, 'Expected non-empty cases list');

      for (const item of res.json as Array<Record<string, unknown>>) {
        assert.ok(typeof item.id === 'number', 'Case id must be number');
        assert.ok(typeof item.message === 'string', 'Message must be string');
        assert.ok(typeof item.datetime === 'string', 'Datetime must be string');

        const snitch = item.snitch as Record<string, unknown> | undefined;
        assert.ok(snitch, 'Case must have snitch object');
        assert.ok(typeof snitch?.id === 'number', 'Snitch id must be number');
        assert.ok(typeof snitch?.company === 'string', 'Snitch company must be string');
        assert.ok(typeof snitch?.logo === 'string', 'Snitch logo must be string');

        const offender = item.offender as Record<string, unknown> | undefined;
        assert.ok(offender, 'Case must have offender object');
        assert.ok(typeof offender?.id === 'number', 'Offender id must be number');
        assert.ok(typeof offender?.company === 'string', 'Offender company must be string');
        assert.ok(typeof offender?.logo === 'string', 'Offender logo must be string');
      }
    });

    await test('Messages Cases: GET /api/v2/messages-cases/:id/ returns detail with messages', async () => {
      const res = await api(cookie, 'GET', '/api/v2/messages-cases/301/');
      assert.equal(res.status, 200);
      const data = res.json as Record<string, unknown>;
      assert.equal(data.id, 301);
      assert.ok(data.snitch, 'Must have snitch');
      assert.ok(data.offender, 'Must have offender');
      assert.ok(Array.isArray(data.messages), 'Must have messages array');
      const messages = data.messages as Array<Record<string, unknown>>;
      assert.ok(messages.length > 0, 'Messages must not be empty');
      for (const msg of messages) {
        assert.ok(typeof msg.id === 'number');
        assert.ok(typeof (msg.sender as Record<string, unknown>)?.id === 'number');
        assert.ok(typeof (msg.sender as Record<string, unknown>)?.company === 'string');
        assert.ok(typeof (msg.text || msg.body) === 'string');
      }
    });

    await test('Messages Cases: PATCH /api/v2/messages-cases/:id/ updates resolution and bans', async () => {
      const res = await api(cookie, 'PATCH', '/api/v2/messages-cases/301/', {
        banOffender: true,
        banSnitch: false
      });
      assert.equal(res.status, 200);
      const data = res.json as Record<string, unknown>;
      assert.equal(data.offenderBanned, true);
      assert.equal(data.snitchBanned, false);
      assert.ok(data.resolvedBy, 'Expected resolvedBy to be populated');
    });

    // 5. Company Audit Personal Endpoint
    await test('Personal Audit: GET /api/v2/audit/:id/personal/ contains required array fields', async () => {
      const res = await api(cookie, 'GET', `/api/v2/audit/${companyId}/personal/`);
      assert.equal(res.status, 200);
      const data = res.json as Record<string, unknown>;

      assert.ok(Array.isArray(data.previousEmailAddresses), 'previousEmailAddresses must be array');
      assert.ok(Array.isArray(data.recentIpAddresses), 'recentIpAddresses must be array');
      assert.ok(Array.isArray(data.moderatorNotes), 'moderatorNotes must be array');
      assert.ok(Array.isArray(data.companiesRegisteredFromTheSameIP), 'companiesRegisteredFromTheSameIP must be array');
      assert.ok(Array.isArray(data.teachingCourses), 'teachingCourses must be array');
    });

    // 6. Newcomers Endpoint
    await test('Newcomers: GET /api/v2/newcomers/ returns recent companies', async () => {
      const res = await api(cookie, 'GET', '/api/v2/newcomers/');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json), 'Expected array of newcomers');
      const newcomers = res.json as Array<Record<string, unknown>>;
      assert.ok(newcomers.length > 0, 'Newcomers list should not be empty');

      const ourCompany = newcomers.find(c => c.id === companyId);
      assert.ok(ourCompany, `Expected newly registered company ${companyId} to be in newcomers list`);
      assert.ok(typeof ourCompany.company === 'string', 'Company name must be string');
      assert.ok(typeof ourCompany.realmId === 'number', 'Realm ID must be number');
      assert.ok(typeof ourCompany.dateJoined === 'string', 'Date joined must be string');
    });

    // 7. Redeem Bonus Code Endpoint
    await test('Redeem Code: POST with invalid/empty code returns 400 INVALID_CODE', async () => {
      const emptyRes = await api(cookie, 'POST', `/api/v2/redeem-code/${playerId}/`, { code: '' });
      assert.equal(emptyRes.status, 400);
      const emptyData = emptyRes.json as Record<string, unknown>;
      assert.equal(emptyData.code, 'INVALID_CODE');

      const invalidRes = await api(cookie, 'POST', `/api/v2/redeem-code/${playerId}/`, { code: 'INVALID_CODE_123' });
      assert.equal(invalidRes.status, 400);
      const invalidData = invalidRes.json as Record<string, unknown>;
      assert.equal(invalidData.code, 'INVALID_CODE');
    });

    await test('Redeem Code: POST with valid code "WELCOME2026" credits 50 SimBoosts', async () => {
      const beforeAuth = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
      const beforeAuthCompany = (beforeAuth.json as Record<string, unknown>).authCompany as Record<string, unknown>;
      const beforeSB = Number(beforeAuthCompany.simBoosts ?? beforeAuthCompany.simboosts ?? 0);

      const redeemRes = await api(cookie, 'POST', `/api/v2/redeem-code/${playerId}/`, { code: 'WELCOME2026' });
      assert.equal(redeemRes.status, 200);
      const redeemData = redeemRes.json as Record<string, unknown>;
      assert.equal(redeemData.success, true);
      assert.equal(redeemData.reward, '50 SimBoosts');

      const afterAuth = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
      const afterAuthCompany = (afterAuth.json as Record<string, unknown>).authCompany as Record<string, unknown>;
      const afterSB = Number(afterAuthCompany.simBoosts ?? afterAuthCompany.simboosts ?? 0);
      assert.equal(afterSB, beforeSB + 50, `Expected SimBoosts to increase by 50 (from ${beforeSB} to ${beforeSB + 50}), got ${afterSB}`);
    });

  } finally {
    console.log('\nTearing down test server...');
    child.kill('SIGTERM');
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 500);
    await promise;
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\nTest Summary: ${passed} passed, ${failed} failed (${results.length} total)`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
