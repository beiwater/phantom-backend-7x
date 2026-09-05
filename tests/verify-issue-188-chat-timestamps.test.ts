import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/database.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { handleSocialRoutes } from '../server/routes/social-routes.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';

interface CapturedResponse {
  status: number;
  body: unknown;
}

async function invoke(
  pathname: string,
  method: string,
  companyId: number,
  body?: Record<string, unknown>
): Promise<CapturedResponse> {
  const request = { headers: {}, method } as unknown as IncomingMessage;
  if (body !== undefined) setPreparsedBody(request, body);

  let status = 0;
  let payload = '';
  const response = {
    setHeader() {},
    getHeader() { return '*'; },
    writeHead(nextStatus: number) { status = nextStatus; },
    end(value?: string) { payload = value || ''; }
  } as unknown as ServerResponse;

  const handled = await handleSocialRoutes(request, response, pathname, method, companyId);
  assert.equal(handled, true);
  return { status, body: JSON.parse(payload) as unknown };
}

const { companyId } = await FixtureService.applyScenario({
  companyName: 'Issue 188 chat timestamps',
  money: 100_000,
  level: 30
});
const room = 'ISSUE_188_CHAT';
db.prepare('DELETE FROM chat_messages WHERE room = ?').run(room);
virtualClock.setTime('2042-05-06T12:00:00.000Z');

const sent = await invoke('/api/v2/message/', 'POST', companyId, {
  chatroom: room,
  body: 'server timestamp'
});
assert.equal(sent.status, 200);
const sentMessage = sent.body as { id: number; datetime: string; body: string };
assert.equal(sentMessage.body, 'server timestamp');
assert.equal(Object.hasOwn(sentMessage, 'enc'), false, 'POST chat payload must omit unsupported encrypted data');
const sentAt = sentMessage.datetime;
assert.ok(Date.parse(sentAt) >= Date.parse('2042-05-06T12:00:00.000Z'));
assert.equal(
  (db.prepare('SELECT sent_at FROM chat_messages WHERE id = ?').get(sentMessage.id) as { sent_at: string }).sent_at,
  sentAt
);

// Refreshing after a virtual-time jump preserves the server-created timestamp.
virtualClock.advance({ hours: 2 });
const history = await invoke(`/api/v2/chatroom/${room}/`, 'GET', companyId);
assert.equal(history.status, 200);
const historyMessage = (history.body as Array<{ id: number; datetime: string }>).find(message => message.id === sentMessage.id);
assert.ok(historyMessage);
assert.equal(historyMessage!.datetime, sentAt);

const incremental = await invoke(`/api/v2/chatroom/${room}/from-id/${sentMessage.id - 1}/`, 'GET', companyId);
assert.equal(incremental.status, 200);
const incrementalMessage = (incremental.body as Array<{ id: number; datetime: string }>).find(message => message.id === sentMessage.id);
assert.ok(incrementalMessage);
assert.equal(incrementalMessage!.datetime, sentAt);

const invalid = await invoke('/api/v2/message/', 'POST', companyId, {
  chatroom: room,
  body: ''
});
assert.equal(invalid.status, 400);
assert.equal(
  Number((db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE room = ? AND text = ?').get(room, '') as { count: number }).count),
  0
);

virtualClock.reset();
console.log('PASS chat send, refresh, incremental fetch, and failure paths share server virtual timestamps (#188)');
