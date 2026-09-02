import assert from 'node:assert';
import { Readable } from 'node:stream';
import { handleSocialRoutes } from '../server/routes/social-routes.ts';
import { db } from '../server/db/database.ts';
console.log('=== Verifying Chat Persistence & Body Field Compatibility (Issue #151) ===');

// Prepare a test player and company in database
let testCompany = db.prepare('SELECT company_id, name, realm_id FROM companies LIMIT 1').get() as { company_id: number; name: string; realm_id: number } | undefined;
if (!testCompany) {
  db.prepare("INSERT INTO companies (company_id, player_id, name, cash) VALUES (1, 1, 'Test Corp', 10000)").run();
  testCompany = { company_id: 1, name: 'Test Corp', realm_id: 0 };
}
// Clean previous test messages in room 'TEST_ROOM'
db.prepare("DELETE FROM chat_messages WHERE room = 'TEST_ROOM'").run();

// [1/3] Test sending a message
const postBodyStr = JSON.stringify({
  chatroom: 'TEST_ROOM',
  body: 'Hello SimCompanies World 2026'
});
const mockPostReq: any = Readable.from([Buffer.from(postBodyStr)]);
mockPostReq.headers = {
  'content-type': 'application/json',
  'content-length': String(Buffer.byteLength(postBodyStr))
};
let postStatus = 0;
let postPayload: any = null;
const mockPostRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; postStatus = code; },
  end(content: string) {
    console.log('end received content:', content);
    if (content) postPayload = JSON.parse(content);
  }
};

const postHandled = await handleSocialRoutes(mockPostReq, mockPostRes, '/api/v2/message/', 'POST', 1, testCompany.company_id);
assert.strictEqual(postHandled, true, 'POST /api/v2/message/ must be handled');
assert.strictEqual(postPayload.body, 'Hello SimCompanies World 2026', 'POST response must contain body field');
assert.strictEqual(postPayload.text, 'Hello SimCompanies World 2026', 'POST response must contain text field');
assert.ok(postPayload.id > 0, 'Message ID must be positive');
console.log('  -> POST message returned body & text successfully.');

// [2/3] Test GET /api/v2/chatroom/:room/
console.log('[2/3] Testing GET /api/v2/chatroom/TEST_ROOM/ history schema...');
let getPayload: any = null;
const mockGetRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { getPayload = JSON.parse(content); }
};

const getHandled = await handleSocialRoutes({} as any, mockGetRes, '/api/v2/chatroom/TEST_ROOM/', 'GET', 1, testCompany.company_id);
assert.strictEqual(getHandled, true, 'GET /api/v2/chatroom/TEST_ROOM/ must be handled');
assert.ok(Array.isArray(getPayload), 'Payload must be an array');
const foundMsg = getPayload.find((m: any) => m.id === postPayload.id);
assert.ok(foundMsg, 'Created message must be in chat history');
assert.strictEqual(foundMsg.body, 'Hello SimCompanies World 2026', 'History message must include body for frontend renderer');
assert.strictEqual(foundMsg.text, 'Hello SimCompanies World 2026', 'History message must include text');
console.log('  -> Chatroom history includes body field on reload.');

// [3/3] Test GET /api/v2/chatroom/:room/from-id/:id/
console.log('[3/3] Testing GET /api/v2/chatroom/TEST_ROOM/from-id/0/ incremental query...');
let fromIdPayload: any = null;
const mockFromIdRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { fromIdPayload = JSON.parse(content); }
};

const fromIdHandled = await handleSocialRoutes({} as any, mockFromIdRes, '/api/v2/chatroom/TEST_ROOM/from-id/0/', 'GET', 1, testCompany.company_id);
assert.strictEqual(fromIdHandled, true, 'from-id query must be handled');
const foundFromId = fromIdPayload.find((m: any) => m.id === postPayload.id);
assert.ok(foundFromId, 'Created message must be returned in from-id query');
assert.strictEqual(foundFromId.body, 'Hello SimCompanies World 2026', 'from-id message must have body field');
console.log('================================================================');
console.log(' [OK] ISSUE #151 CHAT PERSISTENCE CHECKS PASSED ALL TESTS');
console.log('================================================================');
