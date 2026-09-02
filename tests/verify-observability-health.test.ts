import assert from 'node:assert';
import http from 'node:http';
import { handleHealthRoutes } from '../server/routes/health-routes.ts';
import { logger, sanitizeLogData } from '../server/core/logger.ts';

console.log('=== Verifying Observability, Health Probes & Structured Logging (Issue #146) ===');

// [1/4] Test Liveness Probe (GET /health/live)
console.log('[1/4] Testing liveness health check probe (/health/live)...');
let livePayload: any = null;
let liveStatus = 0;
const mockLiveRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { livePayload = JSON.parse(content); }
};

const liveHandled = handleHealthRoutes({} as any, mockLiveRes, '/health/live', 'GET');
assert.strictEqual(liveHandled, true, '/health/live must be handled');
assert.strictEqual(mockLiveRes.statusCode, 200, 'Liveness probe must return 200');
assert.strictEqual(livePayload.status, 'ok', 'Status must be "ok"');
assert.ok(typeof livePayload.uptimeSeconds === 'number', 'Uptime must be a number');
console.log(`  -> Liveness Response:`, livePayload);

// [2/4] Test Readiness Probe (GET /health/ready)
console.log('[2/4] Testing readiness health check probe (/health/ready)...');
let readyPayload: any = null;
const mockReadyRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { readyPayload = JSON.parse(content); }
};

const readyHandled = handleHealthRoutes({} as any, mockReadyRes, '/health/ready', 'GET');
assert.strictEqual(readyHandled, true, '/health/ready must be handled');
assert.strictEqual(mockReadyRes.statusCode, 200, 'Readiness probe must return 200');
assert.strictEqual(readyPayload.status, 'ready', 'Status must be "ready"');
assert.strictEqual(readyPayload.database, 'connected', 'Database must be connected');
assert.ok(readyPayload.schemaVersion >= 11, `Schema version must be >= 11 (was ${readyPayload.schemaVersion})`);
assert.ok(typeof readyPayload.scheduler?.running === 'boolean', 'Scheduler running status must be a boolean');
console.log(`  -> Readiness Response:`, readyPayload);

// [3/4] Test Sensitive Data Masking in Logger
console.log('[3/4] Testing sensitive data masking & redaction in logger...');
const rawContext = {
  email: 'player@example.com',
  password: 'superSecretPassword123!',
  sessionToken: 'sess_abc1234567890abcdef',
  userSession: 'sess_secret_cookie_token',
  authorization: 'Bearer secret_jwt_token',
  creditCardNumber: '1234-5678-9012-3456',
  nested: {
    adminPassword: 'rootAdminPassword!',
    normalField: 'hello world'
  }
};

const sanitized: any = sanitizeLogData(rawContext);
console.log('  -> Sanitized Context:', sanitized);

assert.strictEqual(sanitized.email, 'player@example.com', 'Non-sensitive field preserved');
assert.strictEqual(sanitized.password, '[REDACTED]', 'Password must be redacted');
assert.strictEqual(sanitized.sessionToken, '[REDACTED]', 'Session token must be redacted');
assert.strictEqual(sanitized.authorization, '[REDACTED]', 'Authorization must be redacted');
assert.strictEqual(sanitized.creditCardNumber, '[REDACTED]', 'Card info must be redacted');
assert.strictEqual(sanitized.nested.adminPassword, '[REDACTED]', 'Nested passwords must be redacted');
assert.strictEqual(sanitized.nested.normalField, 'hello world', 'Nested normal field preserved');

// Test string bearer redaction
const rawString = 'Incoming header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and sessionid=sess_41b9bbe16028';
const sanitizedStr = sanitizeLogData(rawString);
assert.strictEqual(sanitizedStr, 'Incoming header Authorization: Bearer [REDACTED] and sessionid=[REDACTED]');

// [4/4] Test Request ID generation
console.log('[4/4] Testing request ID generation & tracing...');
const reqId1 = logger.generateRequestId();
const reqId2 = logger.generateRequestId();
assert.ok(reqId1.startsWith('req_'), 'Request ID should have req_ prefix');
assert.notStrictEqual(reqId1, reqId2, 'Request IDs must be unique');

console.log('================================================================');
console.log(' [OK] ISSUE #146 OBSERVABILITY & HEALTH CHECKS PASSED ALL TESTS');
console.log('================================================================');
