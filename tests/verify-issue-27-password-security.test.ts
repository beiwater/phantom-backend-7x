import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, hashPassword, verifyPassword } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function runIssue27PasswordSecurityTest() {
  console.log('================================================================');
  console.log(' Starting Issue #27 Password Security & KDF Upgrade Verification');
  console.log('================================================================');

  const password = 'StrongPassword2026!';

  console.log('[1/5] Testing scrypt hashing generates random salt on each invocation...');
  const hash1 = hashPassword(password);
  const hash2 = hashPassword(password);
  assert.ok(hash1.startsWith('scrypt$'), 'Hash must start with scrypt$');
  assert.ok(hash2.startsWith('scrypt$'), 'Hash must start with scrypt$');
  assert.notEqual(hash1, hash2, 'Identical passwords must generate distinct salted hashes');
  assert.ok(verifyPassword(password, hash1), 'verifyPassword must accept hash1');
  assert.ok(verifyPassword(password, hash2), 'verifyPassword must accept hash2');
  assert.ok(!verifyPassword('WrongPassword', hash1), 'verifyPassword must reject wrong password');

  console.log('[2/5] Testing registration creates scrypt hash in database...');
  const email = `scrypt_user_${Date.now()}@simcompanies.local`;
  const registerRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, company: 'Scrypt Corp' })
  });
  assert.equal(registerRes.status, 200);

  const playerRow = db.prepare('SELECT * FROM players WHERE email = ?').get(email) as { password_hash: string; password?: string };
  assert.ok(playerRow, 'Player row must exist');
  assert.ok(playerRow.password_hash.startsWith('scrypt$'), 'Stored password hash must be scrypt');
  assert.equal(playerRow.password || null, null, 'Plaintext password column must not store passwords');

  console.log('[3/5] Testing legacy SHA-256 hash login and progressive migration to scrypt...');
  const legacyEmail = `legacy_user_${Date.now()}@simcompanies.local`;
  const legacyPass = 'LegacyPass123!';
  const legacyHash = crypto.createHash('sha256').update(legacyPass).digest('hex');
  const legacyPlayerId = Math.floor(2000000 + Math.random() * 8000000);
  const legacyCompanyId = Math.floor(4000000 + Math.random() * 6000000);

  db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(legacyPlayerId, legacyEmail, legacyHash, new Date().toISOString());

  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, 'Legacy Co', 100000, 250, 1, 'BBB', 0, 0, '', 'old', 'Legacy', ?)
  `).run(legacyCompanyId, legacyPlayerId, new Date().toISOString());

  // Attempt login with legacy password
  const legacyLoginRes = await fetch(`${baseUrl}/api/v2/auth/email/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: legacyEmail, password: legacyPass })
  });
  assert.equal(legacyLoginRes.status, 200, 'Legacy SHA-256 password login must succeed');

  const upgradedRow = db.prepare('SELECT * FROM players WHERE email = ?').get(legacyEmail) as { password_hash: string };
  assert.ok(upgradedRow.password_hash.startsWith('scrypt$'), 'Legacy hash must be upgraded to scrypt upon successful login');
  assert.ok(verifyPassword(legacyPass, upgradedRow.password_hash), 'Upgraded scrypt hash must verify legacy password');

  console.log('[4/5] Testing invalid password rejection on upgraded account...');
  const badLoginRes = await fetch(`${baseUrl}/api/v2/auth/email/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: legacyEmail, password: 'WrongPassword123' })
  });
  assert.equal(badLoginRes.status, 400, 'Bad password must be rejected');

  console.log('[5/5] Testing non-existent user login rejection...');
  const nonExistentRes = await fetch(`${baseUrl}/api/v2/auth/email/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `nonexistent_${Date.now()}@domain.local`, password: 'SomePassword' })
  });
  assert.equal(nonExistentRes.status, 400, 'Nonexistent email login must be rejected with 400');

  console.log('================================================================');
  console.log(' [OK] ISSUE #27 PASSWORD SECURITY PASSED ALL CHECKS');
  console.log('================================================================');
}

runIssue27PasswordSecurityTest().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
