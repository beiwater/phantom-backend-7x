import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function runIssue64AuthTest() {
  console.log('================================================================');
  console.log(' Starting Issue #64 Auth Security & Personal-Data Verification');
  console.log('================================================================');

  // 1. Guest personal-data request returns 401
  console.log('[1/6] Verifying guest requests to /personal-data/ return 401...');
  const guestMeRes = await fetch(`${baseUrl}/api/v2/players/me/personal-data/`);
  assert.equal(guestMeRes.status, 401, 'Unauthenticated /me/personal-data/ must return 401');

  const guestAdminRes = await fetch(`${baseUrl}/api/v2/players/2920233/personal-data/`);
  assert.equal(guestAdminRes.status, 401, 'Unauthenticated /2920233/personal-data/ must return 401');
  console.log('  -> Guest requests correctly returned 401');

  // 2. Register Player 1 and Player 2
  console.log('[2/6] Registering test accounts Player 1 and Player 2...');
  const time = Date.now();
  const p1Email = `auth_p1_${time}@domain.local`;
  const p2Email = `auth_p2_${time}@domain.local`;
  const password = 'Password123!';

  const reg1Res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: p1Email, password, company: `Auth Co 1 ${time}` })
  });
  assert.equal(reg1Res.status, 200);
  const cookie1 = (reg1Res.headers.getSetCookie?.() || [reg1Res.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie1);

  const reg2Res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: p2Email, password, company: `Auth Co 2 ${time}` })
  });
  assert.equal(reg2Res.status, 200);
  const cookie2 = (reg2Res.headers.getSetCookie?.() || [reg2Res.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie2);

  // Get Player 1 and Player 2 auth data
  const auth1Data = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie1 }
  })).json()) as { authUser: { id: number; email: string } };
  const p1Id = auth1Data.authUser.id;

  const auth2Data = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie2 }
  })).json()) as { authUser: { id: number; email: string } };
  const p2Id = auth2Data.authUser.id;

  // 3. Player 1 requesting their own personal-data
  console.log('[3/6] Verifying authenticated owner can fetch own personal data...');
  const p1SelfRes = await fetch(`${baseUrl}/api/v2/players/me/personal-data/`, {
    headers: { Cookie: cookie1 }
  });
  assert.equal(p1SelfRes.status, 200);
  const p1SelfData = (await p1SelfRes.json()) as { player: { id: number; email: string }; companies: Array<unknown> };
  assert.equal(p1SelfData.player.id, p1Id);
  assert.equal(p1SelfData.player.email, p1Email);
  assert.ok(p1SelfData.companies.length >= 1);
  console.log('  -> Player 1 fetched own personal data successfully');

  // 4. Cross-player data disclosure check (Player 1 attempts to read Player 2's data)
  console.log('[4/6] Verifying cross-player personal-data disclosure is blocked with 403...');
  const crossRes = await fetch(`${baseUrl}/api/v2/players/${p2Id}/personal-data/`, {
    headers: { Cookie: cookie1 }
  });
  assert.equal(crossRes.status, 403, 'Cross-player personal-data must return 403 Forbidden');
  console.log('  -> Cross-player access correctly rejected with 403');

  // 5. Unknown email login does NOT create account
  console.log('[5/6] Verifying unknown-email login fails without creating accounts...');
  const unknownEmail = `nonexistent_${time}@domain.local`;
  const playersBeforeCount = (db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number }).count;
  const companiesBeforeCount = (db.prepare('SELECT COUNT(*) as count FROM companies').get() as { count: number }).count;

  const failedLoginRes = await fetch(`${baseUrl}/api/v2/auth/email/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: unknownEmail, password: 'AnyPassword123!' })
  });
  assert.equal(failedLoginRes.status, 400, 'Login with unknown email must fail');

  const playersAfterCount = (db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number }).count;
  const companiesAfterCount = (db.prepare('SELECT COUNT(*) as count FROM companies').get() as { count: number }).count;
  assert.equal(playersAfterCount, playersBeforeCount, 'No new player row should be created on failed login');
  assert.equal(companiesAfterCount, companiesBeforeCount, 'No new company row should be created on failed login');
  console.log('  -> Unknown-email login rejected and created 0 phantom accounts');

  // 6. Valid login to existing account
  console.log('[6/6] Verifying valid login to existing account succeeds...');
  const validLoginRes = await fetch(`${baseUrl}/api/v2/auth/email/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: p1Email, password })
  });
  assert.equal(validLoginRes.status, 200);
  const loginCookie = (validLoginRes.headers.getSetCookie?.() || [validLoginRes.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(loginCookie);

  const authAfterLogin = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: loginCookie }
  })).json()) as { authUser: { id: number; email: string } };
  assert.equal(authAfterLogin.authUser.id, p1Id);
  console.log('  -> Valid email login succeeded cleanly');

  console.log('================================================================');
  console.log(' ✅ ISSUE #64 AUTH SECURITY PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue64AuthTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
