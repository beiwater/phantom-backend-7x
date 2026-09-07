import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { setupWebSocket } from '../server/ws/websocket.ts';
import { handleRequest } from '../server/router.ts';
import { db } from '../server/db/database.ts';
import { createSession } from '../server/auth/session.ts';

// Test that POST /api/v2/message/ with token broadcasts NEW_MESSAGE with the same token over WebSocket
async function main() {
  console.log('=== Verifying Chat Optimistic Token Reconciliation ===');

  // Prepare test company & session in database
  let testCompany = db.prepare('SELECT company_id, name, realm_id FROM companies LIMIT 1').get() as { company_id: number; name: string; realm_id: number } | undefined;
  if (!testCompany) {
    db.prepare("INSERT INTO companies (company_id, player_id, name, cash) VALUES (99999, 99999, 'TokenTest Corp', 10000)").run();
    testCompany = { company_id: 99999, name: 'TokenTest Corp', realm_id: 0 };
  }

  // Create a valid session token via createSession
  const testSessionToken = createSession(1, testCompany.company_id);

  // Spin up test HTTP server with WebSocket enabled
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });

  setupWebSocket(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const port = addr.port;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const httpUrl = `http://127.0.0.1:${port}`;

  console.log(`Test server running at ${httpUrl}, WS: ${wsUrl}`);

  // Connect WebSocket client
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  console.log('WebSocket client connected.');

  // Set up listener for NEW_MESSAGE
  const receivedMessages: Array<{ routing?: string; data?: any }> = [];
  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString());
      receivedMessages.push(parsed);
    } catch {
      // ignore
    }
  });

  // [1] Post chatroom message with client token
  const testToken = 1788764413999;
  const postRes = await fetch(`${httpUrl}/api/v2/message/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `sessionid=${testSessionToken}`
    },
    body: JSON.stringify({
      chatroom: 'G',
      body: 'Testing optimistic token reconciliation',
      token: testToken
    })
  });

  assert.equal(postRes.status, 200, `POST /api/v2/message/ failed: ${postRes.status}`);
  const postData = await postRes.json() as any;
  assert.equal(postData.body, 'Testing optimistic token reconciliation');

  // Wait for WebSocket message
  const deadline = Date.now() + 3000;
  while (receivedMessages.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const wsMsg = receivedMessages.find(m => m.routing === 'NEW_MESSAGE');
  assert.ok(wsMsg, 'Expected NEW_MESSAGE routing from WebSocket broadcast');
  assert.equal(wsMsg.data.token, testToken, `Expected WebSocket data.token to match ${testToken}, got ${wsMsg.data.token}`);
  assert.equal(wsMsg.data.chatroom, 'G');
  assert.equal(wsMsg.data.body, 'Testing optimistic token reconciliation');
  assert.equal(wsMsg.data.sender.id, testCompany.company_id);

  console.log('  -> Chatroom message token successfully broadcast via WebSocket NEW_MESSAGE.');

  // [2] Clean up
  ws.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  console.log('================================================================');
  console.log(' [OK] CHAT OPTIMISTIC TOKEN RECONCILIATION VERIFIED');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
