/**
 * Issue #17 regression test — session expiry enforcement & cookie lifecycle.
 * Requires a running server: PORT=3603 SPEED_MULTIPLIER=200 \
 *   /opt/magnate/.node22/bin/node --experimental-strip-types server/index.ts
 *
 * Covers:
 *  1. Manually inserted expired session -> authenticated API returns 401.
 *  2. Set-Cookie from createSession carries Max-Age=2592000 (30 days, matching DB TTL).
 *  3. cleanupExpiredSessions() deletes expired rows.
 *  4. logout immediately invalidates the old token.
 */
import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { buildSessionCookie, cleanupExpiredSessions } from '../server/auth/session.ts';

const PORT = process.env.PORT || '3603';
const baseUrl = `http://127.0.0.1:${PORT}`;

async function runIssue17RestTest() {
  console.log('================================================================');
  console.log(' Starting Issue #17 Session Expiry & Cookie Lifecycle Test');
  console.log('================================================================');

  // 1. Register a fresh player through the real signup route.
  console.log('[1/5] Registering player via /api/v2/auth/email/connect/...');
  const time = Date.now();
  const email = `issue17_${time}@domain.local`;
  const password = 'Password123!';
  const regRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, company: `Issue17 Co ${time}` })
  });
  assert.equal(regRes.status, 200, 'registration must succeed');
  const setCookies = regRes.headers.getSetCookie?.() || [regRes.headers.get('set-cookie') || ''];
  const sessionCookie = setCookies.find(c => c.startsWith('sessionid='));
  assert.ok(sessionCookie, 'Set-Cookie sessionid must be present');

  // 2. Cookie lifetime matches DB session TTL (30 days => Max-Age=2592000).
  console.log('[2/5] Verifying Set-Cookie Max-Age matches 30-day DB TTL...');
  assert.ok(/Max-Age=2592000/.test(sessionCookie!), `cookie must carry Max-Age=2592000, got: ${sessionCookie}`);
  assert.ok(/HttpOnly/.test(sessionCookie!), 'cookie must be HttpOnly');
  assert.ok(/SameSite=Lax/.test(sessionCookie!), 'cookie must be SameSite=Lax');
  assert.ok(!/;\s*Secure/.test(sessionCookie!), 'Secure must be absent unless COOKIE_SECURE=1 (plain HTTP deployment)');
  console.log(`  -> OK: ${sessionCookie}`);

  // 3. Manually insert an expired session row for the same player.
  console.log('[3/5] Inserting expired session and calling authenticated API...');
  const authData = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: sessionCookie! }
  })).json()) as { authUser: { id: number }; authCompany: { id: number } };
  const playerId = authData.authUser.id;
  const companyId = authData.authCompany.id;

  const expiredToken = 'sess_expired_' + time;
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  db.prepare(`
    INSERT INTO sessions (session_token, player_id, active_company_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(expiredToken, playerId, companyId, new Date(Date.now() - 61_000).toISOString(), expiredAt);
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE session_token = ?').get(expiredToken), 'expired row must be inserted');

  // Live token still works; expired token must be rejected with 401.
  // NOTE: /api/v3/companies/auth-data/ is guest-tolerant (200 with null user),
  // so use /api/v2/players/me/personal-data/ which requires authentication.
  const liveRes = await fetch(`${baseUrl}/api/v2/players/me/personal-data/`, {
    headers: { Cookie: sessionCookie! }
  });
  assert.equal(liveRes.status, 200, 'unexpired session must still authenticate');
  const expiredRes = await fetch(`${baseUrl}/api/v2/players/me/personal-data/`, {
    headers: { Cookie: `sessionid=${expiredToken}` }
  });
  assert.equal(expiredRes.status, 401, 'expired session must be rejected with 401');
  console.log('  -> Expired session rejected (401); live session accepted (200)');

  // 4. cleanupExpiredSessions() removes expired rows.
  console.log('[4/5] Verifying cleanupExpiredSessions deletes expired rows...');
  // getSession auto-deletes on access, so the first row may already be gone.
  // Insert a fresh expired row that no request has touched, then clean up.
  const untouchedExpired = 'sess_expired_clean_' + time;
  db.prepare(`
    INSERT INTO sessions (session_token, player_id, active_company_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(untouchedExpired, playerId, companyId, new Date(Date.now() - 61_000).toISOString(), expiredAt);
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE session_token = ?').get(untouchedExpired), 'expired row must exist before cleanup');
  const removed = cleanupExpiredSessions();
  assert.ok(removed >= 1, `cleanup must remove at least 1 expired row, removed=${removed}`);
  assert.ok(!db.prepare('SELECT 1 FROM sessions WHERE session_token = ?').get(untouchedExpired), 'expired row must be gone after cleanup');
  const liveStill = db.prepare('SELECT 1 FROM sessions WHERE session_token = ?')
    .get(sessionCookie!.split(';')[0].split('=')[1]);
  assert.ok(liveStill, 'cleanup must NOT delete unexpired sessions');
  console.log(`  -> cleanupExpiredSessions removed ${removed} row(s); live session preserved`);

  // 5. logout invalidates the old token immediately.
  console.log('[5/5] Verifying logout invalidates the old token...');
  const token = sessionCookie!.split(';')[0].split('=')[1];
  const logoutRes = await fetch(`${baseUrl}/logout/`, {
    headers: { Cookie: `sessionid=${token}` },
    redirect: 'manual'
  });
  assert.ok([302, 303].includes(logoutRes.status), 'logout must redirect');
  const logoutSetCookie = logoutRes.headers.getSetCookie?.().find(c => c.startsWith('sessionid=')) || '';
  assert.ok(/sessionid=;/.test(logoutSetCookie) && /Expires=Thu, 01 Jan 1970/.test(logoutSetCookie),
    `logout must clear the cookie, got: ${logoutSetCookie}`);
  assert.ok(!/Max-Age=2592000/.test(logoutSetCookie), 'clearing cookie must not carry Max-Age');
  const postLogout = await fetch(`${baseUrl}/api/v2/players/me/personal-data/`, {
    headers: { Cookie: `sessionid=${token}` }
  });
  assert.equal(postLogout.status, 401, 'old token must be invalid after logout');
  console.log('  -> Logout cleared cookie and revoked the session (401)');

  // Bonus: buildSessionCookie unit checks (COOKIE_SECURE behavior).
  assert.ok(buildSessionCookie('t').includes('Max-Age=2592000'));
  const prevSecure = process.env.COOKIE_SECURE;
  process.env.COOKIE_SECURE = '1';
  assert.ok(buildSessionCookie('t').endsWith('; Secure'), 'COOKIE_SECURE=1 must append Secure');
  process.env.COOKIE_SECURE = prevSecure;
  assert.ok(!buildSessionCookie('t').includes('Secure'), 'COOKIE_SECURE unset must not append Secure');

  console.log('================================================================');
  console.log(' ✅ ISSUE #17 SESSION EXPIRY & COOKIE LIFECYCLE PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue17RestTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
