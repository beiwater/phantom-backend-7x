import assert from 'node:assert/strict';

// Regression tests for attack-audit findings C-2, C-3, C-6, C-10, C-11.
// Run against a live server: BASE_URL or PORT (default 3402).
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3402'}`;

interface ChatMessage {
  id: number;
  chatroom: string;
  sender: { id: number; company: string; logo: string; certificates?: number; supporter: boolean; realmId: number };
  text: string;
  datetime: string;
  pinned?: boolean;
}

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

interface CompanyListItem {
  companyId: number;
  company: string;
  logo: string;
  realmId: number;
  deleted: boolean;
}

interface CompanyNote {
  id: number;
  note: string;
  about: { id: number; company: string; logo: string; realmId: number; deleted: boolean; online: string };
}

async function fetchWithRateRetry(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  let retries = 0;
  while (response.status === 429 && retries < 70) {
    const retryAfter = Number(response.headers.get('Retry-After') || '2');
    await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 5) * 1000));
    response = await fetch(url, init);
    retries++;
  }
  return response;
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const response = await fetchWithRateRetry(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `chatfix_${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}@domain.local`,
      password: 'Password123!',
      company: `ChatFix ${label} ${Date.now()}`
    })
  });
  assert.equal(response.status, 200, `registration failed: ${response.status}`);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(value => value.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'registration did not return a session cookie');
  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(authResponse.status, 200);
  const auth = await authResponse.json() as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function runTests(): Promise<void> {
  console.log('====================================================');
  console.log(' Chat/Chatroom/Search Fix Regression Tests (C-2..C-11)');
  console.log('====================================================');

  const stamp = Date.now();
  const userA = await register('A');
  const userB = await register('B');

  // ---------- C-2: POST /api/v2/message/ accepts the bundle field name ----------
  console.log('[C-2] POST /api/v2/message/ with frontend {chatroom, body} shape...');
  let response = await fetch(`${baseUrl}/api/v2/message/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ chatroom: 'N', body: `bundle shape message ${stamp}` })
  });
  assert.equal(response.status, 200, `bundle-shaped message rejected: ${response.status}`);
  const bundleMessage = await response.json() as ChatMessage;
  assert.equal(bundleMessage.text, `bundle shape message ${stamp}`);

  console.log('[C-2] legacy {chatroom, text} shape still accepted...');
  response = await fetch(`${baseUrl}/api/v2/message/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ chatroom: 'N', text: `legacy shape message ${stamp}` })
  });
  assert.equal(response.status, 200, `legacy-shaped message rejected: ${response.status}`);

  console.log('[C-2] empty text still rejected with 400...');
  response = await fetch(`${baseUrl}/api/v2/message/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ chatroom: 'N', body: '' })
  });
  assert.equal(response.status, 400, 'empty message body must stay rejected');

  // ---------- C-3: sender objects carry realmId ----------
  console.log('[C-3] POST response sender includes numeric realmId...');
  assert.equal(typeof bundleMessage.sender.realmId, 'number', 'POST response sender.realmId missing');
  assert.equal(bundleMessage.sender.realmId, 0, 'sender.realmId should match company realm_id (0)');

  console.log('[C-3] GET /api/v2/chatroom/N/ every message sender has realmId...');
  response = await fetch(`${baseUrl}/api/v2/chatroom/N/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200);
  const messages = await response.json() as ChatMessage[];
  assert.ok(Array.isArray(messages) && messages.length > 0, 'chatroom should contain the messages just posted');
  for (const message of messages) {
    assert.equal(typeof message.sender.realmId, 'number', `message ${message.id} sender.realmId missing (frontend Kt[realmId] crash)`);
  }

  // ---------- C-6: search endpoints ----------
  console.log('[C-6] GET /api/v2/companies/list/0/<q>/ returns matching companies...');
  response = await fetch(`${baseUrl}/api/v2/companies/list/0/ChatFix/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200, `companies/list 404/failed: ${response.status}`);
  const companies = await response.json() as CompanyListItem[];
  assert.ok(Array.isArray(companies), 'companies/list must return an array');
  const ownCompany = companies.find(entry => entry.companyId === userA.companyId);
  assert.ok(ownCompany, 'freshly registered company must be findable by name substring');
  assert.equal(ownCompany.company.startsWith('ChatFix'), true);
  assert.equal(ownCompany.realmId, 0);

  console.log('[C-6] companies/list filters to the requested realm...');
  response = await fetch(`${baseUrl}/api/v2/companies/list/7/ChatFix/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200);
  const otherRealm = await response.json() as CompanyListItem[];
  assert.ok(otherRealm.every(entry => entry.realmId === 7), 'results must be filtered to the requested realm');

  console.log('[C-6] GET /api/v2/newspaper/articles-by-substring/0/<q>/ returns array payload...');
  response = await fetch(`${baseUrl}/api/v2/newspaper/articles-by-substring/0/economy/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200, `articles-by-substring 404/failed: ${response.status}`);
  const articles = await response.json();
  assert.ok(Array.isArray(articles), 'articles-by-substring must return an array (search page renders (r||[]).slice)');

  // ---------- C-10: chatroom metadata endpoint ----------
  console.log('[C-10] GET /api/v2/companies/chatrooms/me/ returns chatroom catalog...');
  response = await fetch(`${baseUrl}/api/v2/companies/chatrooms/me/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200, `chatrooms/me 404/failed: ${response.status}`);
  const chatrooms = await response.json() as ChatroomEntry[];
  assert.ok(Array.isArray(chatrooms) && chatrooms.length > 0, 'chatroom catalog must not be empty');
  const zhGame = chatrooms.find(entry => entry.db_letter === 'N');
  assert.ok(zhGame, 'ZH game chatroom (db_letter N) must be present');
  for (const field of ['name', 'language', 'category', 'image', 'db_letter'] as const) {
    assert.ok(zhGame[field], `chatroom entry missing ${field}`);
  }
  assert.equal(zhGame.notSubscribed, undefined, 'subscribed rooms must not carry notSubscribed');

  console.log('[C-10] GET /api/v2/companies/chatrooms/:id/ works for a numeric company id...');
  response = await fetch(`${baseUrl}/api/v2/companies/chatrooms/${userA.companyId}/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200, `chatrooms/:id 404/failed: ${response.status}`);
  assert.ok((await response.json() as ChatroomEntry[]).length > 0);

  console.log('[C-10] POST subscription toggle persists across requests...');
  response = await fetch(`${baseUrl}/api/v2/companies/chatrooms/me/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ added: [], deleted: ['S'] })
  });
  assert.equal(response.status, 200);
  const afterToggle = await response.json() as ChatroomEntry[];
  assert.equal(afterToggle.find(entry => entry.db_letter === 'S')?.notSubscribed, true, 'deleted room must be marked notSubscribed');
  response = await fetch(`${baseUrl}/api/v2/companies/chatrooms/me/`, { headers: { Cookie: userA.cookie } });
  const afterReload = await response.json() as ChatroomEntry[];
  assert.equal(afterReload.find(entry => entry.db_letter === 'S')?.notSubscribed, true, 'subscription state must persist after reload');

  // ---------- C-11: note read/write ----------
  console.log('[C-11] GET /api/v2/companies/me/my-note/ returns the company note string...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/my-note/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200, `my-note 404/failed: ${response.status}`);
  assert.equal(typeof await response.json(), 'string', 'my-note must return a plain string (official HAR)');

  console.log('[C-11] POST /api/v2/companies/me/my-note/ writes and read-back persists...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/my-note/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ note: `chatfix memo ${stamp}` })
  });
  assert.equal(response.status, 200);
  assert.equal(await response.json(), `chatfix memo ${stamp}`);
  response = await fetch(`${baseUrl}/api/v2/companies/me/my-note/`, { headers: { Cookie: userA.cookie } });
  assert.equal(await response.json(), `chatfix memo ${stamp}`, 'my-note write must survive a reload');

  console.log('[C-11] note list starts empty for a fresh company...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200, `note list 404/failed: ${response.status}`);
  assert.deepEqual(await response.json(), []);

  console.log('[C-11] POST /api/v2/companies/me/note/:aboutId/ creates a note about another company...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/${userB.companyId}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ note: 'reliable trading partner' })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { note: 'reliable trading partner' });

  console.log('[C-11] note list entry carries the official about shape...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/`, { headers: { Cookie: userA.cookie } });
  const noteList = await response.json() as CompanyNote[];
  assert.equal(noteList.length, 1, 'exactly one note expected');
  assert.equal(noteList[0].about.id, userB.companyId);
  assert.equal(noteList[0].about.company.startsWith('ChatFix B'), true);
  assert.equal(typeof noteList[0].about.realmId, 'number');
  assert.equal(noteList[0].note, 'reliable trading partner');

  console.log('[C-11] GET single note returns {note}...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/${userB.companyId}/`, { headers: { Cookie: userA.cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { note: 'reliable trading partner' });

  console.log('[C-11] PUT priority and DELETE work...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/${userB.companyId}/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ priority: 'up' })
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/${userB.companyId}/`, {
    method: 'DELETE',
    headers: { Cookie: userA.cookie }
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/`, { headers: { Cookie: userA.cookie } });
  assert.deepEqual(await response.json(), [], 'note must be gone after DELETE');

  console.log('[C-11] empty note write clears the entry...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/${userB.companyId}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ note: 'temporary' })
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/${userB.companyId}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
    body: JSON.stringify({ note: '' })
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/`, { headers: { Cookie: userA.cookie } });
  assert.deepEqual(await response.json(), [], 'empty note must remove the entry (frontend filters note!=="")');

  console.log('[C-11] unauthenticated note access is rejected with 401...');
  response = await fetch(`${baseUrl}/api/v2/companies/me/my-note/`);
  assert.equal(response.status, 401, 'my-note without session must 401');
  response = await fetch(`${baseUrl}/api/v2/companies/me/note/`);
  assert.equal(response.status, 401, 'note list without session must 401');

  console.log('====================================================');
  console.log(' ALL CHAT/SEARCH/NOTE FIX TESTS PASSED');
  console.log('====================================================');
}

runTests().catch(error => {
  console.error('CHAT FIX REGRESSION FAILED:', error);
  process.exit(1);
});
