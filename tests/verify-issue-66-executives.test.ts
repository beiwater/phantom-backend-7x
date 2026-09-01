import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `exec_${label}_${Date.now()}@domain.local`,
      password: 'Password123!',
      company: `Exec Corp ${label} ${Date.now()}`
    })
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(value => value.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'registration did not return a session cookie');

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = (await authResponse.json()) as any;
  const companyId = auth.authCompany.companyId;

  return { cookie, companyId };
}

async function runIssue66ExecutivesTest() {
  console.log('================================================================');
  console.log(' Starting Issue #66 Executive Domain Verification');
  console.log('================================================================');

  const user1 = await register('user1');
  const user2 = await register('user2');
  // Issue #71: executives unlock at level 15 — arrange both companies there.
  db.prepare('UPDATE companies SET level = 15 WHERE company_id = ?').run(user1.companyId);
  db.prepare('UPDATE companies SET level = 15 WHERE company_id = ?').run(user2.companyId);
  const headers1 = { 'Content-Type': 'application/json', Cookie: user1.cookie };
  const headers2 = { 'Content-Type': 'application/json', Cookie: user2.cookie };

  // Fetch initial executives
  const execsRes = await fetch(`${baseUrl}/api/v4/executives/`, { headers: headers1 });
  assert.equal(execsRes.status, 200);
  const execsData = (await execsRes.json()) as any;
  const execs = (execsData.executives || execsData) as Array<{ id: number; name: string; skills: Record<string, number> }>;
  assert.ok(execs.length > 0, 'Starter executives must be present');
  const validExec = execs[0];

  const authBefore = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: headers1 })).json()) as any;
  const moneyBefore = authBefore.authCompany.money;

  // 1. Train Invalid Executive ID -> must fail without deducting cash
  console.log('[1/6] Verifying training invalid executive is rejected with 0 cash deducted...');
  const invalidTrainRes = await fetch(`${baseUrl}/api/v4/executives/999999/train/`, {
    method: 'POST',
    headers: headers1
  });
  assert.equal(invalidTrainRes.status, 400);
  const authAfterInvalid = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: headers1 })).json()) as any;
  assert.equal(authAfterInvalid.authCompany.money, moneyBefore, 'Money must not be deducted on invalid training');
  console.log('  -> Rejected with 400, cash balance preserved');

  // 2. Train Other Company's Executive -> must fail with 400
  console.log('[2/6] Verifying cross-company training is rejected...');
  const crossTrainRes = await fetch(`${baseUrl}/api/v4/executives/${validExec.id}/train/`, {
    method: 'POST',
    headers: headers2
  });
  assert.equal(crossTrainRes.status, 400);
  console.log('  -> Cross-company training rejected with 400');

  // 3. Valid Executive Training -> atomic $30,000 deduction and +1 to all skills
  console.log('[3/6] Verifying valid training increments skills and deducts $30,000 atomically...');
  const validTrainRes = await fetch(`${baseUrl}/api/v4/executives/${validExec.id}/train/`, {
    method: 'POST',
    headers: headers1
  });
  assert.equal(validTrainRes.status, 200);
  const trainData = (await validTrainRes.json()) as any;
  assert.equal(trainData.cost, 30000);
  assert.equal(trainData.executive.skills.management, validExec.skills.management + 1);
  assert.equal(trainData.executive.skills.accounting, validExec.skills.accounting + 1);

  const authAfterTrain = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: headers1 })).json()) as any;
  assert.equal(authAfterTrain.authCompany.money, moneyBefore - 30000, 'Money accurately decremented by 30000');
  console.log('  -> Valid training succeeded atomically');

  // 4. Fire Non-Owned or Invalid Executive -> rejected with 400
  console.log('[4/6] Verifying firing non-owned executive returns 400 error...');
  const invalidFireRes = await fetch(`${baseUrl}/api/v4/executives/999999/fire/`, {
    method: 'POST',
    headers: headers1
  });
  assert.equal(invalidFireRes.status, 400);
  console.log('  -> Firing invalid executive rejected with 400');

  // 5. Executive Slot Limit Enforcement
  console.log('[5/6] Verifying executive capacity and slot limit enforcement on hire...');
  const candRes = await fetch(`${baseUrl}/api/v4/executives/candidates/`, { headers: headers1 });
  assert.equal(candRes.status, 200);
  const candData = (await candRes.json()) as any;
  const candidates = (candData.candidates || candData) as Array<{ id: number; name: string }>;
  assert.ok(candidates.length >= 2, 'Candidates available');

  // Currently employed count: 3 (Alexander, Elena, David)
  // Base max slots = 4
  // 4th hire should succeed
  const hire1Res = await fetch(`${baseUrl}/api/v4/executives/hire/`, {
    method: 'POST',
    headers: headers1,
    body: JSON.stringify({ candidateId: candidates[0].id, position: 'cmo' })
  });
  assert.equal(hire1Res.status, 200);
  console.log('  -> 4th executive hired successfully (reaches default capacity of 4)');

  // 5th hire should be REJECTED (exceeds default slot limit of 4)
  const hire2Res = await fetch(`${baseUrl}/api/v4/executives/hire/`, {
    method: 'POST',
    headers: headers1,
    body: JSON.stringify({ candidateId: candidates[1].id, position: 'unassigned' })
  });
  assert.equal(hire2Res.status, 400);
  const errData = (await hire2Res.json()) as any;
  assert.match(errData.error || '', /slot limit reached/i);
  console.log('  -> 5th hire rejected with slot limit error (400)');

  // 6. Unlock Executive Slot with SimBoosts -> now 5th hire succeeds
  console.log('[6/6] Unlocking extra executive slot with SimBoosts and hiring 5th executive...');
  const unlockRes = await fetch(`${baseUrl}/api/v2/companies/me/executive-slots/`, {
    method: 'POST',
    headers: headers1
  });
  assert.equal(unlockRes.status, 200);

  const hire2AfterUnlockRes = await fetch(`${baseUrl}/api/v4/executives/hire/`, {
    method: 'POST',
    headers: headers1,
    body: JSON.stringify({ candidateId: candidates[1].id, position: 'unassigned' })
  });
  assert.equal(hire2AfterUnlockRes.status, 200);
  console.log('  -> 5th executive hired successfully after SimBoost slot unlock');

  console.log('================================================================');
  console.log(' ✅ ISSUE #66 EXECUTIVES PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue66ExecutivesTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
