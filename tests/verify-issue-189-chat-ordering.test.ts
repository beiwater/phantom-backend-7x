import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { socialRepository } from '../server/repositories/social-repository.ts';
import { handleSocialRoutes } from '../server/routes/social-routes.ts';

interface CapturedResponse {
  status: number;
  body: unknown;
}

async function invoke(pathname: string, companyId: number): Promise<CapturedResponse> {
  const request = { headers: {}, method: 'GET' } as unknown as IncomingMessage;
  let status = 0;
  let payload = '';
  const response = {
    setHeader() {},
    getHeader() { return '*'; },
    writeHead(nextStatus: number) { status = nextStatus; },
    end(value?: string) { payload = value || ''; }
  } as unknown as ServerResponse;

  const handled = await handleSocialRoutes(request, response, pathname, 'GET', companyId);
  assert.equal(handled, true);
  return { status, body: JSON.parse(payload) as unknown };
}

const firstCompany = await FixtureService.applyScenario({ companyName: 'Issue 189 chat sender A', money: 100_000, level: 30 });
const secondCompany = await FixtureService.applyScenario({ companyName: 'Issue 189 chat sender B', money: 100_000, level: 30 });
const room = 'ISSUE_189_ORDER';
db.prepare("DELETE FROM chat_messages WHERE room IN (?, 'N', '1')").run(room);

const tieTimestamp = '2043-01-02T10:00:00.000Z';
const firstId = socialRepository.insertChatMessage(room, firstCompany.companyId, 'Sender A', 'first', tieTimestamp);
const secondId = socialRepository.insertChatMessage(room, secondCompany.companyId, 'Sender B', 'second', tieTimestamp);
const thirdId = socialRepository.insertChatMessage(room, firstCompany.companyId, 'Sender A', 'third', tieTimestamp);
// Higher id but older server time: timestamp is primary, id is the tie-breaker.
const olderId = socialRepository.insertChatMessage(room, secondCompany.companyId, 'Sender B', 'older', '2043-01-02T09:59:59.000Z');

const expectedIds = [thirdId, secondId, firstId, olderId];
const firstView = await invoke(`/api/v2/chatroom/${room}/`, firstCompany.companyId);
const secondView = await invoke(`/api/v2/chatroom/${room}/`, secondCompany.companyId);
assert.equal(firstView.status, 200);
assert.equal(secondView.status, 200);
const idsFrom = (body: unknown): number[] => (body as Array<{ id: number }>).map(message => message.id);
assert.deepEqual(idsFrom(firstView.body), expectedIds);
assert.deepEqual(idsFrom(secondView.body), expectedIds);

const incremental = await invoke(`/api/v2/chatroom/${room}/from-id/${firstId}/`, firstCompany.companyId);
assert.equal(incremental.status, 200);
const incrementalRows = incremental.body as Array<{ id: number; body: string; datetime: string }>;
assert.deepEqual(idsFrom(incremental.body), [thirdId, secondId, olderId]);
assert.deepEqual(incrementalRows.map(message => message.body), ['third', 'second', 'older']);
assert.ok(incrementalRows.every(message => message.datetime));

console.log('PASS chat history and from-id use timestamp DESC plus id DESC for production parity (#189)');
