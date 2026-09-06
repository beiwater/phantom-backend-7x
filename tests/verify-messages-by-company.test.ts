import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { handleSocialRoutes } from '../server/routes/social-routes.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';

interface CapturedResponse {
  status: number;
  body: any;
}

async function invoke(
  pathname: string,
  method: string,
  companyId: number,
  body?: Record<string, unknown>
): Promise<CapturedResponse> {
  const request = {
    headers: {},
    method,
    url: pathname
  } as unknown as IncomingMessage;
  if (body !== undefined) setPreparsedBody(request, body);

  let status = 0;
  let payload = '';
  const response = {
    setHeader() {},
    getHeader() { return '*'; },
    writeHead(nextStatus: number) { status = nextStatus; },
    end(value?: string) { payload = value || ''; }
  } as unknown as ServerResponse;

  const urlObj = new URL(pathname, 'http://127.0.0.1');
  const handled = await handleSocialRoutes(request, response, urlObj.pathname, method, companyId);
  assert.equal(handled, true, `Route must be handled: ${pathname}`);
  return { status, body: JSON.parse(payload) as unknown };
}

console.log('=== Verifying /api/messages_by_company/ Contract & Private Messages ===');

// Setup two test companies
const userA = await FixtureService.applyScenario({ companyName: `Test Company A ${Date.now()}`, money: 50000 });
const userB = await FixtureService.applyScenario({ companyName: `Test Company B ${Date.now()}`, money: 50000 });

// 1. Initial contact lookup without previous history
console.log('[1/4] Testing initial contact lookup with no messages history...');
const initialRes = await invoke(
  `/api/messages_by_company/?company=${encodeURIComponent(userB.companyName)}&last_id=undefined`,
  'GET',
  userA.companyId
);
assert.equal(initialRes.status, 200);
assert.equal(initialRes.body.status, 'ok');
assert.deepEqual(initialRes.body.messages, []);
assert.ok(initialRes.body.contact, 'Response must include contact object');
assert.equal(initialRes.body.contact.company, userB.companyName);
assert.equal(initialRes.body.contact.companyId, userB.companyId);
assert.equal(initialRes.body.contact.lastMessageId, null);
assert.equal(initialRes.body.contact.chatBlocked, false);
console.log('  -> PASS: initial contact contract matches official HAR shape');

// 2. Non-existent company lookup returns 404
console.log('[2/4] Testing non-existent company lookup...');
const notFoundRes = await invoke(
  '/api/messages_by_company/?company=NonExistentCompany999999&last_id=undefined',
  'GET',
  userA.companyId
);
assert.equal(notFoundRes.status, 404);
assert.equal(notFoundRes.body.status, 'error');
console.log('  -> PASS: non-existent company returns error');

// 3. Sending private direct message via POST /api/v2/message/
console.log('[3/4] Testing private message sending and retrieval...');
const postRes = await invoke(
  '/api/v2/message/',
  'POST',
  userA.companyId,
  {
    companyId: userB.companyId,
    body: 'Hello private direct message'
  }
);
assert.equal(postRes.status, 200);
assert.equal(postRes.body.body, 'Hello private direct message');
assert.equal(postRes.body.sender.id, userA.companyId);
assert.equal(postRes.body.receiver.id, userB.companyId);

// Verify message is now listed under /api/messages_by_company/
const afterSendRes = await invoke(
  `/api/messages_by_company/?company=${encodeURIComponent(userB.companyName)}&last_id=undefined`,
  'GET',
  userA.companyId
);
assert.equal(afterSendRes.status, 200);
assert.equal(afterSendRes.body.messages.length, 1);
assert.equal(afterSendRes.body.messages[0].body, 'Hello private direct message');
assert.equal(afterSendRes.body.contact.lastMessageId, postRes.body.id);
console.log('  -> PASS: private message persisted and retrieved in channel');

// 4. PATCH /api/messages/ clears unread
console.log('[4/4] Testing PATCH /api/messages/ ...');
const patchRes = await invoke(
  '/api/messages/',
  'PATCH',
  userA.companyId,
  { companyId: userB.companyId }
);
assert.equal(patchRes.status, 200);
assert.equal(patchRes.body.status, 'ok');
console.log('  -> PASS: PATCH /api/messages/ responds with status ok');

console.log('================================================================');
console.log('       ALL /api/messages_by_company/ TESTS PASSED               ');
console.log('================================================================');
