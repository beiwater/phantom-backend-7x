import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `idempotency_${label}_${Date.now()}@simcompanies.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', company: `Co-${label}-${Date.now()}` })
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(v => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Registration failed to return session cookie');

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = (await authResponse.json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

function getTableSnapshot() {
  const getCount = (table: string) => {
    try {
      const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      return row.count;
    } catch {
      return 0;
    }
  };

  return {
    executives: getCount('executives'),
    bonds: getCount('bonds'),
    restaurantProperties: getCount('restaurant_properties'),
    chatMessages: getCount('chat_messages'),
    buildings: getCount('buildings'),
    warehouse: getCount('warehouse')
  };
}

async function runIssue36ReadIdempotencyTest() {
  console.log('================================================================');
  console.log(' Starting Issue #36 Read Idempotency & No-Side-Effect Verification');
  console.log('================================================================');

  const user = await register('idemp');
  const headers = { Cookie: user.cookie };

  console.log('[1/5] Taking initial database table count snapshot...');
  const snapshotBefore = getTableSnapshot();
  console.log('  -> Initial snapshot:', snapshotBefore);

  console.log('[2/5] Performing multiple sequential GET calls to executives endpoints...');
  for (let i = 0; i < 3; i++) {
    const res1 = await fetch(`${baseUrl}/api/v4/executives/`, { headers });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`${baseUrl}/api/v4/executives/candidates/`, { headers });
    assert.equal(res2.status, 200);
  }

  console.log('[3/5] Performing multiple sequential GET calls to bond market & bonds endpoints...');
  for (let i = 0; i < 3; i++) {
    const res1 = await fetch(`${baseUrl}/api/v2/market/bonds/`, { headers });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`${baseUrl}/api/v2/companies/me/bonds/owned/`, { headers });
    assert.equal(res2.status, 200);
    const res3 = await fetch(`${baseUrl}/api/v2/companies/me/bonds/sold/`, { headers });
    assert.equal(res3.status, 200);
  }

  console.log('[4/5] Performing multiple sequential GET calls to chatrooms & resource endpoints...');
  for (let i = 0; i < 3; i++) {
    const res1 = await fetch(`${baseUrl}/api/v2/chatroom/N/`, { headers });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, { headers });
    assert.equal(res2.status, 200);
    const res3 = await fetch(`${baseUrl}/api/v2/constants/resources/`, { headers });
  }

  console.log('[5/5] Verifying database snapshot after all GET calls is strictly identical...');
  const snapshotAfter = getTableSnapshot();
  console.log('  -> Snapshot after GETs:', snapshotAfter);

  assert.deepEqual(snapshotAfter, snapshotBefore, 'GET requests must not mutate database state');

  console.log('================================================================');
  console.log(' [OK] ISSUE #36 READ IDEMPOTENCY PASSED ALL CHECKS');
  console.log('================================================================');
}

runIssue36ReadIdempotencyTest().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
