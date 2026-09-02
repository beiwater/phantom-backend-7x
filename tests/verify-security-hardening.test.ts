import assert from 'node:assert';
import { buildSessionCookie } from '../server/auth/session.ts';
import { handleDebugRoutes } from '../server/routes/debug-routes.ts';

console.log('=== Verifying Production Security Hardening (Issue #149) ===');

// [1/4] Test session cookie security attributes
console.log('[1/4] Testing session cookie attributes...');
const cookie1 = buildSessionCookie('sess_abcdef1234567890abcdef12');
assert.ok(cookie1.includes('HttpOnly'), 'Cookie must be HttpOnly');
assert.ok(cookie1.includes('SameSite=Lax'), 'Cookie must be SameSite=Lax');

// Test Secure flag when COOKIE_SECURE=1
const prevEnv = { ...process.env };
try {
  process.env.COOKIE_SECURE = '1';
  const secureCookie = buildSessionCookie('sess_abcdef1234567890abcdef12');
  assert.ok(secureCookie.includes('Secure'), 'Cookie must include Secure when COOKIE_SECURE=1');
  console.log('  -> Secure cookie attributes verified.');
} finally {
  process.env = { ...prevEnv };
}

// [2/4] Test debug routes blocked in production by default (403)
console.log('[2/4] Testing debug endpoints blocked by default in production...');
try {
  process.env.NODE_ENV = 'production';
  delete process.env.ENABLE_DEBUG_ENDPOINTS;
  process.env.ADMIN_PASSWORD = 'TestStrongAdminPassword123!';

  let responseStatus = 0;
  let responseData: any = null;

  const mockRes: any = {
    statusCode: 200,
    getHeader() { return '*'; },
    setHeader() {},
    writeHead(code: number) { this.statusCode = code; responseStatus = code; },
    end(data: string) { responseData = JSON.parse(data); }
  };

  const req: any = { headers: {} };
  handleDebugRoutes(req, mockRes, '/api/v2/debug/state/', 'GET', null, null);

  assert.strictEqual(responseStatus, 403, 'Debug route in production without flag must return 403');
  assert.strictEqual(responseData.error, 'Debug endpoints are disabled in production mode.');
  console.log('  -> Debug endpoint successfully blocked with 403 Forbidden.');
} finally {
  process.env = { ...prevEnv };
}

// [3/4] Test debug routes require admin authentication when flag is enabled
console.log('[3/4] Testing admin auth requirement on debug routes...');
try {
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_DEBUG_ENDPOINTS = 'true';
  process.env.ADMIN_PASSWORD = 'TestStrongAdminPassword123!';

  let unauthStatus = 0;
  let unauthData: any = null;

  const mockUnauthRes: any = {
    statusCode: 200,
    getHeader() { return '*'; },
    setHeader() {},
    writeHead(code: number) { this.statusCode = code; unauthStatus = code; },
    end(data: string) { unauthData = JSON.parse(data); }
  };

  // Request without password
  handleDebugRoutes({ headers: {} } as any, mockUnauthRes, '/api/v2/debug/state/', 'GET', null, null);
  assert.strictEqual(unauthStatus, 401, 'Debug route without password must return 401');

  // Request with invalid password
  let invalidStatus = 0;
  const mockInvalidRes: any = {
    statusCode: 200,
    getHeader() { return '*'; },
    setHeader() {},
    writeHead(code: number) { this.statusCode = code; invalidStatus = code; },
    end() {}
  };
  handleDebugRoutes({ headers: { 'x-admin-password': 'wrong-password' } } as any, mockInvalidRes, '/api/v2/debug/state/', 'GET', null, null);
  assert.strictEqual(invalidStatus, 401, 'Debug route with wrong password must return 401');

  console.log('  -> Unauthorized debug requests correctly rejected with 401.');
} finally {
  process.env = { ...prevEnv };
}

// [4/4] Test authorized debug access in production
console.log('[4/4] Testing authorized debug access with admin password in production...');
try {
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_DEBUG_ENDPOINTS = 'true';
  process.env.ADMIN_PASSWORD = 'TestStrongAdminPassword123!';

  let authStatus = 200;
  let authData: any = null;

  const mockAuthRes: any = {
    statusCode: 200,
    getHeader() { return '*'; },
    setHeader() {},
    writeHead(code: number) { this.statusCode = code; authStatus = code; },
    end(data: string) { authData = JSON.parse(data); }
  };

  handleDebugRoutes({ headers: { 'x-admin-password': 'TestStrongAdminPassword123!' } } as any, mockAuthRes, '/api/v2/debug/state/', 'GET', null, null);
  assert.strictEqual(authStatus, 200, 'Authorized debug request must succeed with 200');
  assert.ok(authData.virtualNow, 'Debug state payload must be returned');
  console.log('  -> Authorized debug request succeeded.');
} finally {
  process.env = { ...prevEnv };
}

console.log('================================================================');
console.log(' [OK] ISSUE #149 PRODUCTION SECURITY HARDENING PASSED ALL TESTS');
console.log('================================================================');
