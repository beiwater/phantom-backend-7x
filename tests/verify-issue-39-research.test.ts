import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const time = Date.now();
  const email = `research_${label}_${time}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Research Co ${label}` })
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

async function runIssue39ResearchTest() {
  console.log('================================================================');
  console.log(' Starting Issue #39 Research Cumulative Patents Verification');
  console.log('================================================================');

  const userA = await register('split');
  const userB = await register('single');
  const headersA = { 'Content-Type': 'application/json', Cookie: userA.cookie };
  const headersB = { 'Content-Type': 'application/json', Cookie: userB.cookie };

  // Fund research inventory: Plant Research (kind: 29) for Plant discipline (1)
  const now = new Date().toISOString();
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 29, 0, 5000, 0, 0, 0, 0, 1.0, ?)')
    .run(userA.companyId, now);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 29, 0, 5000, 0, 0, 0, 0, 1.0, ?)')
    .run(userB.companyId, now);

  // 1. User A applies 49 points -> 0 patents (49 / 50 = 0)
  console.log('[1/4] User A applies 49 points in request 1...');
  const resA1 = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ discipline: 1, points: 49 })
  });
  assert.equal(resA1.status, 200);
  const dataA1 = (await resA1.json()) as { research: Record<string, { points: number; patents: number }> };
  assert.equal(dataA1.research['1'].points, 49);
  assert.equal(dataA1.research['1'].patents, 0);
  console.log('  -> 49 points applied: points=49, patents=0');

  // 2. User A applies another 49 points -> cumulative 98 points -> 1 patent!
  console.log('[2/4] User A applies another 49 points in request 2...');
  const resA2 = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ discipline: 1, points: 49 })
  });
  assert.equal(resA2.status, 200);
  const dataA2 = (await resA2.json()) as { research: Record<string, { points: number; patents: number }> };
  assert.equal(dataA2.research['1'].points, 98);
  assert.equal(dataA2.research['1'].patents, 1, 'Cumulative 98 points must award exactly 1 patent');
  console.log('  -> 49+49 points applied: points=98, patents=1 (cumulative threshold crossed)');

  // 3. User B applies 98 points in ONE single request
  console.log('[3/4] User B applies 98 points in a single request...');
  const resB = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST',
    headers: headersB,
    body: JSON.stringify({ discipline: 1, points: 98 })
  });
  assert.equal(resB.status, 200);
  const dataB = (await resB.json()) as { research: Record<string, { points: number; patents: number }> };
  assert.equal(dataB.research['1'].points, 98);
  assert.equal(dataB.research['1'].patents, 1);
  console.log('  -> 98 single request: points=98, patents=1 (strictly equal to split batches)');

  // 4. Invalid points and insufficient inventory rejection
  console.log('[4/4] Verifying invalid points (-5, 0, 1.5) and insufficient materials are rejected...');
  const negRes = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ discipline: 1, points: -5 })
  });
  assert.equal(negRes.status, 400);

  const zeroRes = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ discipline: 1, points: 0 })
  });
  assert.equal(zeroRes.status, 400);

  const floatRes = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ discipline: 1, points: 10.5 })
  });
  assert.equal(floatRes.status, 400);

  const overRes = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ discipline: 1, points: 9999999 })
  });
  assert.equal(overRes.status, 400, 'Exceeding inventory must return 400');
  console.log('  -> All invalid research attempts rejected with 400');

  console.log('================================================================');
  console.log(' ✅ ISSUE #39 RESEARCH CUMULATIVE PATENTS PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue39ResearchTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
