import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const time = Date.now();
  const email = `slot_${label}_${time}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Slot Co ${label}` })
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie);

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = (await authResponse.json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function runIssue63SlotLimitsTest() {
  console.log('================================================================');
  console.log(' Starting Issue #63 Building Slot Limit Verification');
  console.log('================================================================');

  const { cookie, companyId } = await register('test');
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  // Fund company and stock warehouse materials
  db.prepare('UPDATE companies SET money = 1000000, simboosts = 5000, level = 1 WHERE company_id = ?').run(companyId);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 101, 0, 5000, 0, 0, 0, 0, 1.0, ?)')
    .run(companyId, now);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 102, 0, 5000, 0, 0, 0, 0, 1.0, ?)')
    .run(companyId, now);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 111, 0, 5000, 0, 0, 0, 0, 1.0, ?)')
    .run(companyId, now);

  // Initial buildings: 2 (positions 0 and 1). At level 1, maxSlots = 4.
  console.log('[1/5] Constructing 3rd building at position 2 (unlocked)...');
  const b3Res = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'P', position: '2' })
  });
  assert.equal(b3Res.status, 200, 'Position 2 should be unlocked');

  console.log('[2/5] Constructing 4th building at position 3 (unlocked)...');
  const b4Res = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'P', position: '3' })
  });
  assert.equal(b4Res.status, 200, 'Position 3 should be unlocked (reaches max capacity 4/4)');

  console.log('[3/5] Verifying 5th building at position 4 is REJECTED by backend...');
  const b5Res = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'P', position: '4' })
  });
  assert.equal(b5Res.status, 400, 'Position 4 must be rejected because it is locked');
  const errBody1 = (await b5Res.json()) as { error: string };
  assert.match(errBody1.error, /locked|limit reached/i);
  console.log('  -> Position 4 correctly rejected (400)');

  console.log('[4/5] Verifying arbitrary high position (position 99) is REJECTED...');
  const b99Res = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'P', position: '99' })
  });
  assert.equal(b99Res.status, 400, 'Position 99 must be rejected');
  console.log('  -> High position 99 correctly rejected (400)');

  console.log('[5/5] Unlocking extra building slot with SimBoosts and constructing at position 4...');
  const unlockRes = await fetch(`${baseUrl}/api/v2/companies/me/building-slots/`, {
    method: 'POST',
    headers
  });
  assert.equal(unlockRes.status, 200, 'Building slot unlock should succeed');

  const b5AfterUnlockRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'P', position: '4' })
  });
  assert.equal(b5AfterUnlockRes.status, 200, 'Position 4 must now succeed after SimBoost slot unlock');
  console.log('  -> Construction at position 4 succeeded cleanly after slot unlock');

  console.log('================================================================');
  console.log(' ✅ ISSUE #63 BUILDING SLOT LIMITS PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue63SlotLimitsTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
