import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { extractSessionToken, SESSION_TOKEN_REGEX } from '../server/auth/session.ts';

const TEST_PORT = Number(process.env.PORT || '3710');
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

async function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return;
      }
    } catch {
      // Real child process network polling
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 150);
    await promise;
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

  const dataDir = path.resolve('data', `test-run-security-84-90-${Date.now()}`);
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
        SPEED_MULTIPLIER: '100'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  child.stdout?.on('data', (chunk) => {
    const str = chunk.toString();
    process.stdout.write(`[server-${TEST_PORT}-out] ${str}`);
  });

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-${TEST_PORT}-err] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerAccount(label: string): Promise<{ cookie: string; companyId: number; playerId: number }> {
  const email = `sec_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Sec ${label} ${Date.now()}`
    })
  });
  assert.equal(res.status, 200, 'Registration should succeed');

  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.find((v) => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie must be present');

  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authRes.status, 200);
  const authData = (await authRes.json()) as {
    authUser: { id: number };
    authCompany: { companyId: number };
  };

  return {
    cookie,
    companyId: authData.authCompany.companyId,
    playerId: authData.authUser.id
  };
}

async function runSecurityVerification() {
  console.log('================================================================');
  console.log(' Starting Issue #84 & #90 Security & Privacy Verification Suite');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================\n');

  // ==========================================================================
  // PART 1: Unit & format validation for extractSessionToken & regex (Issue #90)
  // ==========================================================================
  console.log('--- [Part 1] Session Token Format Validation (Issue #90) ---');

  const validToken64 = 'sess_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const validToken24 = 'sess_0123456789abcdef01234567';

  assert.ok(SESSION_TOKEN_REGEX.test(validToken64), 'Valid 64-hex token must pass regex');
  assert.ok(SESSION_TOKEN_REGEX.test(validToken24), 'Valid 24-hex token must pass regex');

  // Invalid tokens
  assert.ok(!SESSION_TOKEN_REGEX.test('sess_123'), 'Too short token must fail regex');
  assert.ok(!SESSION_TOKEN_REGEX.test('sess_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0'), 'Too long token must fail regex');
  assert.ok(!SESSION_TOKEN_REGEX.test('sess_XYZ1234567890123456789012345'), 'Uppercase/non-hex chars must fail regex');
  assert.ok(!SESSION_TOKEN_REGEX.test('token_0123456789abcdef0123456789abcdef'), 'Missing sess_ prefix must fail regex');
  assert.ok(!SESSION_TOKEN_REGEX.test('sess_0123456789abcdef\r\nSet-Cookie: evil'), 'CRLF injection attempt must fail regex');
  assert.ok(!SESSION_TOKEN_REGEX.test('sess_0123456789abcdef<script>alert(1)</script>'), 'XSS injection payload must fail regex');

  // extractSessionToken tests
  const reqWithValidBearer = {
    headers: { authorization: `Bearer ${validToken64}` }
  } as unknown as IncomingMessage;
  assert.equal(extractSessionToken(reqWithValidBearer), validToken64, 'extractSessionToken must extract valid Bearer token');

  const reqWithInvalidBearer = {
    headers: { authorization: 'Bearer invalid_injected_token' }
  } as unknown as IncomingMessage;
  assert.equal(extractSessionToken(reqWithInvalidBearer), null, 'extractSessionToken must return null for invalid Bearer');

  const reqWithValidCookie = {
    headers: { cookie: `other=1; sessionid=${validToken64}; lang=en` }
  } as unknown as IncomingMessage;
  assert.equal(extractSessionToken(reqWithValidCookie), validToken64, 'extractSessionToken must extract valid sessionid cookie');

  const reqWithInvalidCookie = {
    headers: { cookie: 'sessionid=invalid_payload<script>' }
  } as unknown as IncomingMessage;
  assert.equal(extractSessionToken(reqWithInvalidCookie), null, 'extractSessionToken must return null for malformed cookie');

  console.log('  ✔ Unit token format validation tests passed.\n');

  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('✔ Test server started successfully on port', TEST_PORT);

    const testDb = new DatabaseSync(server.dbPath);

    // ==========================================================================
    // PART 2: Cookie Injection & Reflection Defense (Issue #90)
    // ==========================================================================
    console.log('\n--- [Part 2] Cookie Injection & Reflection Defense (Issue #90) ---');

    // 2.1 Unauthenticated request with forged sessionid (not in DB)
    const forgedToken = 'sess_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const forgedRes = await fetch(`${BASE_URL}/`, {
      headers: { Cookie: `sessionid=${forgedToken}` }
    });
    const forgedSetCookies = forgedRes.headers.getSetCookie?.() || [forgedRes.headers.get('set-cookie') || ''];
    const reflectedForged = forgedSetCookies.some((c) => c.includes(forgedToken));
    assert.equal(reflectedForged, false, 'Non-existent session token must NOT be reflected into Set-Cookie');

    // 2.2 Unauthenticated request with malformed / illegal sessionid
    const malformedRes = await fetch(`${BASE_URL}/`, {
      headers: { Cookie: 'sessionid=malicious_token<script>' }
    });
    const malformedSetCookies = malformedRes.headers.getSetCookie?.() || [malformedRes.headers.get('set-cookie') || ''];
    const reflectedMalformed = malformedSetCookies.some((c) => c.includes('malicious_token') || c.startsWith('sessionid='));
    assert.equal(reflectedMalformed, false, 'Malformed token must NOT be reflected into Set-Cookie');

    // 2.3 Bearer header with forged token
    const forgedBearerRes = await fetch(`${BASE_URL}/`, {
      headers: { Authorization: `Bearer ${forgedToken}` }
    });
    const forgedBearerSetCookies = forgedBearerRes.headers.getSetCookie?.() || [forgedBearerRes.headers.get('set-cookie') || ''];
    assert.equal(
      forgedBearerSetCookies.some((c) => c.startsWith('sessionid=')),
      false,
      'Forged Bearer token must NOT issue a sessionid Set-Cookie'
    );

    console.log('  ✔ Cookie injection & reflection defense tests passed.');

    // ==========================================================================
    // PART 3: Admin Authorization Gates on Audit Routes (Issue #84)
    // ==========================================================================
    console.log('\n--- [Part 3] Admin Authorization Gates on Audit Routes (Issue #84) ---');

    // Register a non-admin account
    const regularUser = await registerAccount('regular');
    // Register an admin account and update is_admin in DB
    const adminUser = await registerAccount('admin');
    testDb.prepare('UPDATE players SET is_admin = 1 WHERE player_id = ?').run(adminUser.playerId);

    const regularHeaders = { Cookie: regularUser.cookie };
    const adminHeaders = { Cookie: adminUser.cookie };

    const protectedAuditEndpoints = [
      '/api/v2/audit/recently-deleted/',
      '/api/v2/audit/suspended-companies/',
      '/api/v2/audits/',
      '/api/v2/moderator-notes/',
      `/api/v2/players/${adminUser.playerId}/moderator-notes/`,
      '/api/v2/messages-cases/',
      '/api/v2/messages-cases/301/',
      `/api/v2/audit-ip/${regularUser.playerId}/testhash/`,
      `/api/v2/audit/${regularUser.companyId}/personal/`,
      `/api/v2/audit/${regularUser.companyId}/audits/`,
      `/api/v2/audit/${regularUser.companyId}/auth/`,
      `/api/v2/audit/${regularUser.companyId}/payments/`,
      `/api/v2/audit/${regularUser.companyId}/contracts/`,
      `/api/v2/audit/${regularUser.companyId}/market-trades/`,
      `/api/v2/companies/${regularUser.companyId}/ban/`,
      '/api/v1/audit-requests/',
      '/api/v2/admin/purchase-detective/'
    ];

    console.log(`  -> Testing ${protectedAuditEndpoints.length} protected endpoints with non-admin & guest...`);

    for (const endpoint of protectedAuditEndpoints) {
      // 3.1 Unauthenticated guest must get 403 Forbidden
      const guestRes = await fetch(`${BASE_URL}${endpoint}`);
      assert.equal(
        guestRes.status,
        403,
        `Guest request to ${endpoint} must return 403 Forbidden (got ${guestRes.status})`
      );

      // 3.2 Authenticated non-admin must get 403 Forbidden
      const regularRes = await fetch(`${BASE_URL}${endpoint}`, { headers: regularHeaders });
      assert.equal(
        regularRes.status,
        403,
        `Non-admin request to ${endpoint} must return 403 Forbidden (got ${regularRes.status})`
      );

      // 3.3 Authenticated admin must get 200 OK
      const adminRes = await fetch(`${BASE_URL}${endpoint}`, { headers: adminHeaders });
      assert.equal(
        adminRes.status,
        200,
        `Admin request to ${endpoint} must return 200 OK (got ${adminRes.status})`
      );
    }

    // 3.4 Personal data endpoint check: non-admin requesting another player's personal data -> 403
    const foreignPersonalDataRes = await fetch(`${BASE_URL}/api/v2/players/${adminUser.playerId}/personal-data/`, {
      headers: regularHeaders
    });
    assert.equal(foreignPersonalDataRes.status, 403, 'Non-admin requesting other player personal data must get 403');

    // 3.5 Public audit router endpoints must remain accessible to everyone
    const newcomersGuest = await fetch(`${BASE_URL}/api/v2/newcomers/`);
    assert.equal(newcomersGuest.status, 200, 'Public newcomers route must return 200 for guest');

    const newcomersRegular = await fetch(`${BASE_URL}/api/v2/newcomers/`, { headers: regularHeaders });
    assert.equal(newcomersRegular.status, 200, 'Public newcomers route must return 200 for regular user');

    console.log('  ✔ All admin authorization gate assertions passed.');

    // ==========================================================================
    // PART 4: Public Company Profile Privacy (Issue #84)
    // ==========================================================================
    console.log('\n--- [Part 4] Company Profile Privacy & Sensitivity Controls (Issue #84) ---');

    // 4.1 Non-admin viewing another company via /api/v3/companies/:id/
    const profileResV3NonAdmin = await fetch(`${BASE_URL}/api/v3/companies/${adminUser.companyId}/`, {
      headers: regularHeaders
    });
    assert.equal(profileResV3NonAdmin.status, 200);
    const profileV3NonAdmin = (await profileResV3NonAdmin.json()) as Record<string, unknown>;

    assert.ok(profileV3NonAdmin.companyPublicInfo, 'companyPublicInfo must be present');
    assert.equal(profileV3NonAdmin.auditInfo, undefined, 'auditInfo must be omitted for non-admin');
    assert.equal(profileV3NonAdmin.moderatorInfo, undefined, 'moderatorInfo must be omitted for non-admin');

    // 4.2 Non-admin viewing another company via /api/v2/companies/:id/
    const profileResV2NonAdmin = await fetch(`${BASE_URL}/api/v2/companies/${adminUser.companyId}/`, {
      headers: regularHeaders
    });
    assert.equal(profileResV2NonAdmin.status, 200);
    const profileV2NonAdmin = (await profileResV2NonAdmin.json()) as Record<string, unknown>;

    assert.ok(profileV2NonAdmin.companyPublicInfo, 'companyPublicInfo must be present');
    assert.equal(profileV2NonAdmin.auditInfo, undefined, 'auditInfo must be omitted for non-admin');
    assert.equal(profileV2NonAdmin.moderatorInfo, undefined, 'moderatorInfo must be omitted for non-admin');

    // 4.3 Unauthenticated guest viewing company profile
    const profileResGuest = await fetch(`${BASE_URL}/api/v3/companies/${adminUser.companyId}/`);
    assert.equal(profileResGuest.status, 200);
    const profileGuest = (await profileResGuest.json()) as Record<string, unknown>;

    assert.ok(profileGuest.companyPublicInfo, 'companyPublicInfo must be present');
    assert.equal(profileGuest.auditInfo, undefined, 'auditInfo must be omitted for guest');
    assert.equal(profileGuest.moderatorInfo, undefined, 'moderatorInfo must be omitted for guest');

    // 4.4 Admin viewing company profile via /api/v3/companies/:id/
    const profileResV3Admin = await fetch(`${BASE_URL}/api/v3/companies/${regularUser.companyId}/`, {
      headers: adminHeaders
    });
    assert.equal(profileResV3Admin.status, 200);
    const profileV3Admin = (await profileResV3Admin.json()) as {
      companyPublicInfo?: Record<string, unknown>;
      auditInfo?: { company?: { id: number; money: number; simboosts: number } };
      moderatorInfo?: { player?: { id: number; ip: string } };
    };

    assert.ok(profileV3Admin.companyPublicInfo, 'companyPublicInfo must be present for admin');
    assert.ok(profileV3Admin.auditInfo?.company, 'auditInfo must be present for admin');
    assert.equal(profileV3Admin.auditInfo.company.id, regularUser.companyId);
    assert.ok(profileV3Admin.moderatorInfo?.player, 'moderatorInfo must be present for admin');
    assert.equal(profileV3Admin.moderatorInfo.player.id, regularUser.playerId);

    // 4.5 Admin viewing company profile via /api/v2/companies/:id/
    const profileResV2Admin = await fetch(`${BASE_URL}/api/v2/companies/${regularUser.companyId}/`, {
      headers: adminHeaders
    });
    assert.equal(profileResV2Admin.status, 200);
    const profileV2Admin = (await profileResV2Admin.json()) as {
      companyPublicInfo?: Record<string, unknown>;
      auditInfo?: { company?: { id: number; money: number; simboosts: number } };
      moderatorInfo?: { player?: { id: number; ip: string } };
    };

    assert.ok(profileV2Admin.companyPublicInfo, 'companyPublicInfo must be present for admin');
    assert.ok(profileV2Admin.auditInfo?.company, 'auditInfo must be present for admin');
    assert.ok(profileV2Admin.moderatorInfo?.player, 'moderatorInfo must be present for admin');

    console.log('  ✔ Company profile privacy assertions passed.');

    console.log('\n================================================================');
    console.log(' All Issue #84 & #90 Security & Privacy Assertions PASSED (0 ERRORS)');
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

runSecurityVerification().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
