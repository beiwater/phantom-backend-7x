/**
 * Round-3 regression: P1-07 (account-settings chatroom enable) + P1-08 (messages sidebar icons).
 *
 * P1-07: POST /api/v2/companies/chatrooms/:id/ with {added, deleted} must persist the
 *        subscription toggles so that a later GET reflects them (enable -> state changes ->
 *        refresh keeps it; repeated toggles are idempotent, no duplicates/errors).
 *        NOTE: the real frontend debounces the POST by 2s (bundle: setCallback(...,2e3)),
 *        so "enable then instantly reload" loses the click unless the debounce elapses —
 *        this test verifies the persisted state after the debounce window (equivalent to
 *        the DOM flow: click -> wait >2s -> reload).
 * P1-08: GET /api/v2/contacts/ (the source of the /zh-cn/messages/ sidebar) must return the
 *        official chatroom contract per HAR: per-room `image` (/chat-icon/...), `datetime`,
 *        `db_letter` consistent with the account-settings catalog, `protectedForCountry`
 *        null — a missing `image` made the frontend render the same identicon for every room.
 *
 * Run: PORT=3501 node --experimental-strip-types tests/verify-round3-chatroom.test.ts
 */
import assert from 'node:assert/strict';
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3501'}`;

interface ChatroomEntry {
  name: string;
  language: string;
  category: string;
  image: string;
  db_letter: string;
  realmsShared: boolean;
  protectedForCountry: string | null;
  show_rules?: boolean;
  unread?: number;
  datetime?: string;
  notSubscribed?: boolean;
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `round3chat_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Round3 Chat ${label} ${Date.now()}` })
  });
  assert.equal(res.status, 200, 'signup must succeed');
  const cookie = (res.headers.getSetCookie?.() || [])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'signup must set sessionid cookie');
  const auth = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie! } })).json()) as { authCompany: { companyId: number } | null };
  return { cookie: cookie!, companyId: auth.authCompany!.companyId };
}

const get = (path: string, cookie: string) => fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
const post = (path: string, body: unknown, cookie: string) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body)
  });

let passed = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  assert.ok(cond, `${name}${detail ? ` — ${detail}` : ''}`);
  passed++;
  console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
};

async function runTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Round-3: P1-07 chatroom enable + P1-08 messages sidebar icons');
  console.log(` Target: ${baseUrl}`);
  console.log('================================================================');

  const { cookie, companyId } = await register('t');

  // ---------- P1-07 ----------
  console.log('\n[P1-07] account-settings chatroom enable/disable persistence');

  const page = await get('/zh-cn/account-settings/chatrooms/0/', cookie);
  check('P1-07 page loads (HTML shell)', page.status === 200);

  const cat0 = await (await get(`/api/v2/companies/chatrooms/${companyId}/`, cookie)).json() as ChatroomEntry[];
  check('catalog is a non-empty array', Array.isArray(cat0) && cat0.length > 0, `${cat0.length} rooms`);
  check('catalog entries carry image/datetime/db_letter', cat0.every(e => typeof e.image === 'string' && e.image.startsWith('/chat-icon/') && typeof e.db_letter === 'string' && typeof e.datetime === 'string'));

  const target = cat0.find(e => e.language === 'zh-cn' && !('notSubscribed' in e));
  assert.ok(target, 'must have a subscribed zh-cn room to toggle');
  const letter = target.db_letter;

  // Disable (delete) — the click sends {added:[], deleted:[letter]}
  const delRes = await post(`/api/v2/companies/chatrooms/${companyId}/`, { added: [], deleted: [letter] }, cookie);
  check('POST {deleted:[letter]} returns 200', delRes.status === 200);
  const delBody = await delRes.json() as ChatroomEntry[];
  const afterDel = delBody.find(e => e.db_letter === letter);
  check('response marks the room notSubscribed', afterDel?.notSubscribed === true);

  // Refresh persistence — GET must reflect the delete
  const cat1 = await (await get(`/api/v2/companies/chatrooms/${companyId}/`, cookie)).json() as ChatroomEntry[];
  check('refresh keeps the disabled state (GET reflects POST)', cat1.find(e => e.db_letter === letter)?.notSubscribed === true);

  // Enable (add) — the click sends {added:[letter], deleted:[]}
  const addRes = await post(`/api/v2/companies/chatrooms/${companyId}/`, { added: [letter], deleted: [] }, cookie);
  check('POST {added:[letter]} returns 200', addRes.status === 200);
  const addBody = await addRes.json() as ChatroomEntry[];
  check('response clears notSubscribed', addBody.find(e => e.db_letter === letter)?.notSubscribed !== true);

  // Refresh persistence — GET must reflect the re-enable
  const cat2 = await (await get(`/api/v2/companies/chatrooms/${companyId}/`, cookie)).json() as ChatroomEntry[];
  check('refresh keeps the enabled state', cat2.find(e => e.db_letter === letter)?.notSubscribed !== true);

  // Idempotency: repeating the identical enable must not error nor corrupt state
  const add2 = await post(`/api/v2/companies/chatrooms/${companyId}/`, { added: [letter], deleted: [] }, cookie);
  check('repeated enable returns 200 (idempotent)', add2.status === 200);
  const cat3 = await (await get(`/api/v2/companies/chatrooms/${companyId}/`, cookie)).json() as ChatroomEntry[];
  check('state unchanged after repeat (no duplicates)', cat3.find(e => e.db_letter === letter)?.notSubscribed !== true && cat3.length === cat0.length);
  check('no duplicate db_letter entries', new Set(cat3.map(e => e.db_letter)).size === cat3.length);

  // Unauthenticated POST must be rejected (no company id -> 401)
  const anon = await post('/api/v2/companies/chatrooms/0/', { added: [letter], deleted: [] }, 'sessionid=invalid');
  check('unauthenticated POST is rejected', anon.status === 401 || anon.status === 400, `status=${anon.status}`);

  // ---------- P1-08 ----------
  console.log('\n[P1-08] messages sidebar chatroom contract (/api/v2/contacts/)');

  const page2 = await get('/zh-cn/messages/', cookie);
  check('P1-08 page loads (HTML shell)', page2.status === 200);

  const contacts = await (await get('/api/v2/contacts/', cookie)).json() as {
    chatrooms: ChatroomEntry[];
    contacts: unknown[];
    unreadMessagesOtherRealms?: unknown[];
    invisible?: boolean;
    ignoringCompanies?: unknown[];
    companiesChatBlockingUs?: unknown[];
  };
  check('contacts payload has official top-level keys', Array.isArray(contacts.chatrooms) && Array.isArray(contacts.contacts));
  check('chatrooms list non-empty', contacts.chatrooms.length > 0, `${contacts.chatrooms.length} rooms`);

  // The core bug: rooms must expose `image` (icon URL) — not `icon` — or the
  // frontend renders the identicon fallback for every room.
  check('every room has image (not icon) pointing at /chat-icon/', contacts.chatrooms.every(r => typeof r.image === 'string' && r.image.startsWith('/chat-icon/') && r.image.endsWith('.png')));
  check('rooms do NOT carry the erroneous icon/date fields', contacts.chatrooms.every(r => !('icon' in r) && !('date' in r)));
  check('every room has datetime (official field name)', contacts.chatrooms.every(r => typeof r.datetime === 'string'));

  // Icons must be distinct per room type (same icon for every room = identicon fallback bug)
  const icons = new Set(contacts.chatrooms.map(r => r.image));
  check('icons are distinct across rooms', icons.size >= contacts.chatrooms.length - 2, `${icons.size} unique icons`);

  // db_letter must match the account-settings catalog exactly (wrong letters
  // made sidebar rooms send chat to nonexistent rooms).
  const catalog = await (await get(`/api/v2/companies/chatrooms/${companyId}/`, cookie)).json() as ChatroomEntry[];
  const catalogMap = new Map(catalog.map(e => [e.db_letter, e.name]));
  check('sidebar db_letters exist in the settings catalog', contacts.chatrooms.every(r => catalogMap.has(r.db_letter)));
  check('sidebar room names match catalog for same db_letter', contacts.chatrooms.every(r => catalogMap.get(r.db_letter) === r.name));

  // Icon files must actually be served (frontend loads each image URL).
  const iconUrls = [...icons];
  const served = await Promise.all(iconUrls.map(u => fetch(`${baseUrl}${u}`)));
  check('all icon files served with 200', served.every(r => r.status === 200), `${iconUrls.length} files`);

  // protectedForCountry must be null per official payload ('None' string would
  // wrongly filter rooms in the frontend country-protection check).
  check('protectedForCountry is null (official shape)', contacts.chatrooms.every(r => r.protectedForCountry === null));

  // Disabled room must not appear as enabled in the sidebar source: rooms
  // opted out via POST chatrooms must not be listed as subscribed here.
  const disabled = 'P'; // Supporters room, disabled in the fresh catalog
  await post(`/api/v2/companies/chatrooms/${companyId}/`, { added: [], deleted: [disabled] }, cookie);
  const contacts2 = await (await get('/api/v2/contacts/', cookie)).json() as { chatrooms: ChatroomEntry[] };
  const disabledRoom = contacts2.chatrooms.find(r => r.db_letter === disabled);
  check('opted-out room not presented as a subscribed sidebar room', disabledRoom === undefined || disabledRoom.notSubscribed === true);

  console.log('\n================================================================');
  console.log(` ALL ${passed} CHECKS PASSED`);
  console.log('================================================================');
}

runTest().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
