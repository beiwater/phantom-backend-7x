import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const dataDir = mkdtempSync(join(tmpdir(), 'social-private-'));
process.env.DATA_DIR = dataDir;
// Intentionally exercise the module-loading boundary: connection/config must
// load only after DATA_DIR is set, so this test never touches the user's DB.
const { db, registerPlayer } = await import('../server/db/database.ts');
const { createSession, extractSessionToken, getSession, destroySession } = await import('../server/auth/session.ts');
const { setupWebSocket, broadcastToCompany } = await import('../server/ws/websocket.ts');
const { handleChatSubroutes } = await import('../server/routes/social/chat-subroutes.ts');
const { handleActivitySubroutes } = await import('../server/routes/social/activity-subroutes.ts');
const { createCourse, getCourse, updateCourse, deleteCourse } = await import('../server/application/social/courses.ts');
const { socialRepository } = await import('../server/repositories/social-repository.ts');
const { storyLoader } = await import('../server/game/story/story-loader.ts');
const { storyEngine } = await import('../server/game/story/story-engine.ts');

const participants = ['Sender', 'Receiver', 'Observer'].map(name => {
  const player = registerPlayer(`${name.toLowerCase()}@private.test`, 'password123', name);
  return { companyId: player.companyId, token: createSession(player.playerId, player.companyId) };
});
const [sender, receiver, observer] = participants;
const server = http.createServer(async (req, res) => {
  try {
    const token = extractSessionToken(req);
    const companyId = token ? getSession(token)?.companyId ?? null : null;
    const pathname = new URL(req.url!, 'http://localhost').pathname;
    if (await handleChatSubroutes(req, res, pathname, req.method!, companyId)) return;
    if (await handleActivitySubroutes(req, res, pathname, req.method!, companyId)) return;
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
const wss = setupWebSocket(server);
const sockets: WebSocket[] = [];
type Frame = { routing: string; data: { body?: string; token?: number; chatroom?: string } };
const frames: Frame[][] = [];

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  for (const cookie of ['', 'sessionid=sess_' + 'a'.repeat(64)]) {
    const rejected = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
    rejected.on('error', () => {});
    const status = await new Promise<number>(resolve => {
      rejected.once('unexpected-response', (_req, res) => { resolve(res.statusCode!); res.resume(); rejected.terminate(); });
    });
    assert.equal(status, 401);
  }
  for (const participant of participants) {
    const socket = new WebSocket(wsUrl, { headers: { Cookie: `sessionid=${participant.token}` } });
    const received: Frame[] = [];
    socket.on('message', raw => received.push(JSON.parse(raw.toString()) as Frame));
    sockets.push(socket);
    frames.push(received);
    await once(socket, 'open');
  }
  const flush = async () => {
    await Promise.all(sockets.filter(socket => socket.readyState === WebSocket.OPEN).map(socket => new Promise<void>(resolve => {
      const listener = (raw: Buffer) => {
        const frame: Frame = JSON.parse(raw.toString());
        if (frame.routing === 'PONG') {
          socket.off('message', listener);
          resolve();
        }
      };
      socket.on('message', listener);
      socket.send(JSON.stringify({ routing: 'PING' }));
    })));
  };
  const request = (path: string, method = 'GET', participant?: typeof sender, body?: unknown) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(participant ? { Cookie: `sessionid=${participant.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const post = (body: unknown) => request('/api/v2/message/', 'POST', sender, body);

  assert.equal((await post({ companyId: receiver.companyId, body: 'private dm', token: 123 })).status, 200);
  await flush();
  for (const index of [0, 1]) assert.ok(frames[index].some(frame => frame.routing === 'NEW_MESSAGE' && frame.data.body === 'private dm' && frame.data.token === 123));
  assert.ok(!frames[2].some(frame => frame.data.body === 'private dm'));

  broadcastToCompany(sender.companyId, { body: 'private update' });
  await flush();
  assert.ok(frames[0].some(frame => frame.routing === 'COMPANY_UPDATE' && frame.data.body === 'private update'));
  assert.ok(!frames[1].some(frame => frame.data.body === 'private update'));
  assert.ok(!frames[2].some(frame => frame.data.body === 'private update'));

  assert.equal((await post({ chatroom: 'N', body: 'public room', token: 456 })).status, 200);
  await flush();
  for (const received of frames) assert.ok(received.some(frame => frame.routing === 'NEW_MESSAGE' && frame.data.body === 'public room' && frame.data.token === 456));

  const privateRoom = `story_${sender.companyId}`;
  for (const suffix of ['/', '/from-id/0/']) {
    assert.equal((await request(`/api/v2/chatroom/${privateRoom}${suffix}`)).status, 401);
    assert.equal((await request(`/api/v2/chatroom/${privateRoom}${suffix}`, 'GET', observer)).status, 403);
    assert.equal((await request(`/api/v2/chatroom/${privateRoom}${suffix}`, 'GET', sender)).status, 200);
  }
  const before = socialRepository.listChatMessages(privateRoom, 100).length;
  assert.equal((await request('/api/v2/message/', 'POST', observer, { chatroom: privateRoom, body: 'intrusion' })).status, 403);
  assert.equal(socialRepository.listChatMessages(privateRoom, 100).length, before);
  assert.equal((await post({ chatroom: privateRoom, body: 'story secret' })).status, 200);
  await flush();
  assert.ok(frames[0].some(frame => frame.data.body === 'story secret'));
  for (const index of [1, 2]) assert.ok(!frames[index].some(frame => frame.data.body === 'story secret'));

  storyLoader.loadAllStories();
  const counts = frames.map(received => received.length);
  assert.equal((await storyEngine.startStory(sender.companyId, 'dragon_return')).success, true);
  await flush();
  assert.ok(frames[0].slice(counts[0]).some(frame => frame.routing === 'NEW_MESSAGE'));
  for (const index of [1, 2]) assert.ok(!frames[index].slice(counts[index]).some(frame => frame.routing === 'NEW_MESSAGE' || frame.routing === 'COMPANY_UPDATE'));

  createCourse('Sender', 'Private authorization', '', sender.companyId);
  const insertedCourse = db.prepare('SELECT MAX(id) AS id FROM courses').get();
  assert.ok(insertedCourse && typeof insertedCourse.id === 'number');
  const courseId = insertedCourse.id;
  for (const method of ['PATCH', 'DELETE']) {
    const body = method === 'PATCH' ? { html: 'intrusion', maxStudents: 999 } : undefined;
    assert.equal((await request(`/api/courses/${courseId}/`, method, undefined, body)).status, 401);
    assert.equal((await request(`/api/courses/${courseId}/`, method, observer, body)).status, 403);
  }
  assert.equal(updateCourse(courseId, observer.companyId, { html: 'intrusion' }), null);
  assert.equal(deleteCourse(courseId, observer.companyId), false);
  assert.notEqual(getCourse(courseId)?.html, 'intrusion');
  assert.equal((await request(`/api/courses/${courseId}/`, 'PATCH', sender, { html: 'owner edit', maxStudents: 20 })).status, 200);
  assert.equal(getCourse(courseId)?.html, 'owner edit');
  assert.equal((await request(`/api/courses/${courseId}/`, 'DELETE', sender)).status, 200);
  assert.equal(getCourse(courseId), null);

  const closed = once(sockets[2], 'close');
  destroySession(observer.token);
  broadcastToCompany(observer.companyId, { body: 'revoked secret' });
  await closed;
  assert.ok(!frames[2].some(frame => frame.data.body === 'revoked secret'));
  console.log('Private social authentication and ownership regressions passed.');
} finally {
  for (const socket of sockets) socket.terminate();
  await new Promise<void>(resolve => wss.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
}
