/**
 * P1-06 regression: /zh-cn/account-settings/settings/0/ backend coverage.
 *
 * Bug: the account-settings page was not covered by automated tests at all,
 * and its backend had multiple contract failures:
 *   - PATCH /api/v3/companies/:id/ ignored showOnlineIndicator/moderatorSign
 *     and returned a shape the frontend feeds into updateAuthUser, which
 *     needs the full auth-data payload ({ authUser, authCompany, ... })
 *   - POST /api/v2/players/language/ (language selector save) did not exist
 *   - GET /api/v2/players/notifications/:id did not persist, so notification
 *     changes silently reverted on reload
 *   - GET /api/v2/players/push-devices/ returned { status:'ok' } instead of
 *     an array, crashing the page on `.length`
 *
 * Covers the bug-doc minimum scope (backend leg):
 *   load, read, modify+save, save-failure ends with a clean error response,
 *   refresh persistence, not-logged-in handling, null/missing-field tolerance.
 * (DOM leg of the same scope is exercised separately with a real browser.)
 *
 * Run: PORT=3205 node --experimental-strip-types tests/verify-p1-06-account-settings.test.ts
 */
import assert from 'node:assert/strict';
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3205'}`;

interface AuthData {
  authUser: { playerId: number; language?: string } | null;
  authCompany: { companyId: number; showOnlineIndicator: boolean; moderatorSign: boolean } | null;
}

async function register(label: string): Promise<{ cookie: string; playerId: number; companyId: number }> {
  const email = `p106_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Settings Co ${label} ${Date.now()}` })
  });
  assert.equal(res.status, 200, 'signup must succeed');
  const cookie = (res.headers.getSetCookie?.() || [])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'signup must set sessionid cookie');
  const auth = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } })).json()) as AuthData;
  return { cookie: cookie!, playerId: auth.authUser!.playerId, companyId: auth.authCompany!.companyId };
}

const get = (path: string, cookie?: string) =>
  fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const send = (method: string, path: string, body: unknown, cookie?: string) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

async function runP1_06Test(): Promise<void> {
  console.log('================================================================');
  console.log(' P1-06: account-settings settings page backend coverage');
  console.log(` Target: ${baseUrl}/zh-cn/account-settings/settings/0/`);
  console.log('================================================================');

  // 0. The settings page itself must load (HTML shell for the SPA route)
  const page = await get('/zh-cn/account-settings/settings/0/');
  assert.equal(page.status, 200, 'settings page route must load');
  assert.ok((await page.text()).includes('<html'), 'settings page must serve the app shell');
  console.log('\n[0] /zh-cn/account-settings/settings/0/ loads (200 HTML shell)');

  const user = await register('main');
  const authPath = '/api/v3/companies/auth-data/';
  const companyPath = `/api/v3/companies/${user.companyId}/`;

  // 1. Load: auth-data read returns the settings-relevant fields
  const auth1 = await (await get(authPath, user.cookie)).json() as AuthData;
  assert.equal(auth1.authCompany!.companyId, user.companyId);
  assert.equal(typeof auth1.authCompany!.showOnlineIndicator, 'boolean');
  assert.equal(typeof auth1.authCompany!.moderatorSign, 'boolean');
  console.log('[1] Current account settings readable: showOnlineIndicator=%s moderatorSign=%s',
    auth1.authCompany!.showOnlineIndicator, auth1.authCompany!.moderatorSign);

  // 2. Modify + save: toggle display flags via the settings page PATCH
  const patch = await send('PATCH', companyPath, { showOnlineIndicator: false, moderatorSign: false }, user.cookie);
  assert.equal(patch.status, 200, 'PATCH display flags must succeed');
  const patchBody = await patch.json() as Record<string, unknown>;
  // The frontend pipes this response into updateAuthUser -> needs auth-data shape
  assert.ok(patchBody.authUser && patchBody.authCompany, 'PATCH response must be a full auth-data payload');
  const patched = patchBody as unknown as AuthData;
  assert.equal(patched.authCompany!.showOnlineIndicator, false);
  assert.equal(patched.authCompany!.moderatorSign, false);
  console.log('[2] Modify+save via PATCH: flags accepted, response is auth-data shaped');

  // 3. Refresh persistence: fresh auth-data GET reflects the saved values
  const auth2 = await (await get(authPath, user.cookie)).json() as AuthData;
  assert.equal(auth2.authCompany!.showOnlineIndicator, false, 'showOnlineIndicator must persist after reload');
  assert.equal(auth2.authCompany!.moderatorSign, false, 'moderatorSign must persist after reload');
  console.log('[3] Refresh persistence: fresh GET keeps showOnlineIndicator=false, moderatorSign=false');

  // 4. Language selector save (settings page section) persists
  const langRes = await send('POST', '/api/v2/players/language/', { code: 'zh-cn' }, user.cookie);
  assert.equal(langRes.status, 200, 'language save must succeed');
  const auth3 = await (await get(authPath, user.cookie)).json() as AuthData;
  assert.equal(auth3.authUser!.language, 'zh-cn', 'language must persist');
  // toggle back to en and confirm flip persists (modify -> read cycle)
  await send('POST', '/api/v2/players/language/', { code: 'en' }, user.cookie);
  const auth4 = await (await get(authPath, user.cookie)).json() as AuthData;
  assert.equal(auth4.authUser!.language, 'en');
  console.log('[4] Language save: zh-cn -> en cycles persist');

  // 5. Notification settings: PUT must persist (was echo-only, reverted on reload)
  const notifPath = `/api/v2/players/notifications/${user.companyId}`;
  const put1 = await send('PUT', notifPath, { category: 'emailNotifications', emailNotifications: { game_status: false, bonds_sold: false } }, user.cookie);
  assert.equal(put1.status, 200);
  const notif1 = await (await get(notifPath, user.cookie)).json() as Record<string, Record<string, boolean>>;
  assert.equal(notif1.emailNotifications.game_status, false, 'saved email notification must persist');
  const put2 = await send('PUT', notifPath, { category: 'emailNotifications', emailNotifications: { game_status: true } }, user.cookie);
  assert.equal(put2.status, 200);
  const notif2 = await (await get(notifPath, user.cookie)).json() as Record<string, Record<string, boolean>>;
  assert.equal(notif2.emailNotifications.game_status, true, 're-saved value must overwrite');
  console.log('[5] Notification settings save+reload keeps values');

  // 6. Push devices list must be an array (page does .length on it)
  const devices = await (await get('/api/v2/players/push-devices/', user.cookie)).json() as unknown;
  assert.ok(Array.isArray(devices), 'push-devices GET must return an array');
  console.log('[6] push-devices returns an array (no .length crash)');

  // 7. Save-failure branch: invalid input -> clean structured error (no 500/hang)
  const badNotif = await send('PUT', notifPath, { category: 'bogusCategory', bogusCategory: {} }, user.cookie);
  assert.equal(badNotif.status, 400, 'unknown notification category must be a 400');
  const badBody = await badNotif.json() as { error?: string };
  assert.ok(badBody.error, 'error body must carry a message (frontend shows it and ends loading)');
  const badLang = await send('POST', '/api/v2/players/language/', { /* missing code */ }, user.cookie);
  assert.equal(badLang.status, 400, 'missing language code must be a 400');
  console.log('[7] Save failures return structured 4xx errors (loading ends, error shown)');

  // 8. Not logged in: explicit 401 / login-required, never a crash
  assert.equal((await get(notifPath)).status, 401, 'notifications GET without session must be 401');
  assert.equal((await send('PUT', notifPath, { category: 'emailNotifications', emailNotifications: {} })).status, 401);
  assert.equal((await send('POST', '/api/v2/players/language/', { code: 'en' })).status, 401);
  assert.equal((await send('PATCH', companyPath, { showOnlineIndicator: true })).status, 401);
  const anonAuth = await (await get(authPath)).json() as AuthData;
  assert.equal(anonAuth.authUser, null, 'unauthenticated auth-data must carry authUser:null (frontend shows login state)');
  console.log('[8] Not-logged-in: 401 on all settings writes, authUser:null on read');

  // 9. Null / missing fields must not crash the backend
  const nullPatch = await send('PATCH', companyPath, { showOnlineIndicator: null, moderatorSign: null }, user.cookie);
  assert.ok(nullPatch.status === 200 || nullPatch.status === 400, 'null flags must not 500');
  const emptyPatch = await send('PATCH', companyPath, {}, user.cookie);
  assert.equal(emptyPatch.status, 200, 'empty PATCH body must be a no-op success');
  const emptyNotif = await send('PUT', notifPath, { category: 'emailNotifications' }, user.cookie);
  assert.ok(emptyNotif.status === 200 || emptyNotif.status === 400, 'missing flags object must not 500');
  const strBody = await send('PUT', notifPath, 'not-an-object', user.cookie);
  assert.ok(strBody.status >= 400 && strBody.status < 500, 'garbage body must be a 4xx, never a 500');
  console.log('[9] null / empty / missing / garbage bodies: no 500s, structured responses');

  // 10. Second player cannot touch first player's settings (ownership)
  const other = await register('other');
  const foreign = await send('PATCH', companyPath, { showOnlineIndicator: true }, other.cookie);
  assert.equal(foreign.status, 401, 'cross-account PATCH must be rejected');
  const still = await (await get(authPath, user.cookie)).json() as AuthData;
  assert.equal(still.authCompany!.showOnlineIndicator, false, 'cross-account attempt must not change settings');
  console.log('[10] Ownership enforced: another account gets 401, settings unchanged');

  console.log('\n================================================================');
  console.log(' P1-06 PASS: load/read/modify/save/failure/refresh/not-logged-in/');
  console.log(' null-tolerance/ownership all verified on the settings backend.');
  console.log('================================================================');
}

runP1_06Test()
  .then(() => process.exit(0))
  .catch(err => { console.error('P1-06 FAIL:', err); process.exit(1); });
