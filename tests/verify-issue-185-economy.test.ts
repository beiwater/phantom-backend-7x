import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/connection.ts';
import {
  getEconomyPhase,
  getEconomyPhaseHistory,
  getEconomyPhaseStatistics,
  setEconomyPhase
} from '../server/application/scheduler/daily-jobs.ts';
import '../server/routes/economy-routes.ts';
import { globalRouteRegistry } from '../server/http/route-registry.ts';

const realmId = 185;
const first = new Date('2035-01-05T15:00:00.000Z');
const second = new Date('2035-01-12T15:00:00.000Z');
const third = new Date('2035-01-19T15:00:00.000Z');

db.prepare('DELETE FROM economy_phase_history WHERE realm_id = ?').run(realmId);
db.prepare('DELETE FROM economy_state WHERE realm_id = ?').run(realmId);

setEconomyPhase(realmId, 0, first, 'test');
setEconomyPhase(realmId, 1, second, 'test');
setEconomyPhase(realmId, 2, third, 'test');
setEconomyPhase(realmId, 2, third, 'test');

const history = getEconomyPhaseHistory(realmId, 20, 0);
assert.equal(history.length, 3, 'repeating the same boundary must be idempotent');
assert.equal(history[0].phase, 'boom');
assert.equal(history[1].phase, 'normal');
assert.equal(history[2].phase, 'recession');
assert.equal(history[0].endAt, null, 'current interval remains open');
assert.equal(history[1].endAt, third.toISOString());
assert.equal(history[2].endAt, second.toISOString());
assert.equal(history[2].startAt, first.toISOString());

const current = getEconomyPhase(realmId);
assert.equal(current.phase, 'boom');
assert.equal(current.status, 'active');
assert.equal(current.startAt, third.toISOString());
assert.ok(current.endAt > current.startAt, 'current phase exposes the next UTC boundary');

const statistics = getEconomyPhaseStatistics(realmId);
assert.equal(statistics.phases.recession.cycles, 1);
assert.equal(statistics.phases.normal.cycles, 1);
assert.equal(statistics.phases.boom.cycles, 1);
assert.ok(Math.abs(Object.values(statistics.phases).reduce((sum, item) => sum + item.percentage, 0) - 1) < 1e-9);

const req = new EventEmitter() as IncomingMessage;
Object.assign(req, {
  url: `/api/v3/realms/${realmId}/phases/`,
  method: 'GET',
  headers: {},
  resume: () => req
});
const response = { status: 0, body: '' };
const res = {
  setHeader() {},
  writeHead(status: number) { response.status = status; },
  end(body?: unknown) { response.body = body === undefined ? '' : String(body); },
  getHeader() { return undefined; }
} as unknown as ServerResponse;
const handled = await globalRouteRegistry.dispatch(
  req,
  res,
  `/api/v3/realms/${realmId}/phases/`,
  'GET',
  null
);
assert.equal(handled, true);
assert.equal(response.status, 200);
const payload = JSON.parse(response.body) as {
  currentPhase: { phase: string };
  history: unknown[];
  statistics: { phases: Record<string, { cycles: number }> };
};
assert.equal(payload.currentPhase.phase, 'boom');
assert.equal(payload.history.length, 3);
assert.equal(payload.statistics.phases.boom.cycles, 1);
console.log('PASS economy phase intervals, idempotency, statistics, and API status (#185)');
