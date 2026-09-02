import assert from 'node:assert';
import { validateEnvironment, ConfigValidationError } from '../server/core/env-validator.ts';

console.log('=== Verifying Process Management & Startup Validation (Issue #147) ===');

// [1/3] Test valid environment configuration
console.log('[1/3] Testing valid environment configuration...');
const prevEnv = { ...process.env };
try {
  process.env.NODE_ENV = 'development';
  process.env.PORT = '3500';
  process.env.HOST = '127.0.0.1';
  process.env.BASE_URL = 'http://localhost:3500';

  const config = validateEnvironment();
  assert.strictEqual(config.port, 3500);
  assert.strictEqual(config.host, '127.0.0.1');
  assert.strictEqual(config.isProduction, false);
  console.log('  -> Valid dev config passed.');
} finally {
  process.env = { ...prevEnv };
}

// [2/3] Test invalid PORT rejection
console.log('[2/3] Testing invalid port validation...');
try {
  process.env.PORT = '999999';
  let thrown = false;
  try {
    validateEnvironment();
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof ConfigValidationError);
    console.log(`  -> Caught expected port error: ${(err as Error).message}`);
  }
  assert.strictEqual(thrown, true, 'Must reject invalid port');
} finally {
  process.env = { ...prevEnv };
}

// [3/3] Test production mode requiring strong ADMIN_PASSWORD
console.log('[3/3] Testing production mode ADMIN_PASSWORD requirements...');
try {
  process.env.NODE_ENV = 'production';
  delete process.env.ADMIN_PASSWORD;

  let missingThrown = false;
  try {
    validateEnvironment();
  } catch (err) {
    missingThrown = true;
    assert.ok(err instanceof ConfigValidationError);
    console.log(`  -> Caught expected missing password error: ${(err as Error).message}`);
  }
  assert.strictEqual(missingThrown, true, 'Production must reject missing ADMIN_PASSWORD');

  // Test weak password (< 12 chars)
  process.env.ADMIN_PASSWORD = 'short';
  let weakThrown = false;
  try {
    validateEnvironment();
  } catch (err) {
    weakThrown = true;
    assert.ok(err instanceof ConfigValidationError);
    console.log(`  -> Caught expected weak password error: ${(err as Error).message}`);
  }
  assert.strictEqual(weakThrown, true, 'Production must reject short ADMIN_PASSWORD');

  // Test valid strong production password
  process.env.ADMIN_PASSWORD = 'SuperSecureProdPassword123!';
  const validProd = validateEnvironment();
  assert.strictEqual(validProd.isProduction, true);
  assert.strictEqual(validProd.adminPasswordProvided, true);
  console.log('  -> Strong production config validated successfully.');
} finally {
  process.env = { ...prevEnv };
}

console.log('================================================================');
console.log(' [OK] ISSUE #147 PROCESS MANAGEMENT CHECKS PASSED ALL TESTS');
console.log('================================================================');
