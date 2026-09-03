import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/connection.ts';
import { getGovernmentOrders } from '../server/game/government.ts';
import '../server/routes/government-routes.ts';
import { globalRouteRegistry } from '../server/http/route-registry.ts';

const realmId = 184;
db.prepare('DELETE FROM government_orders WHERE realm_id = ?').run(realmId);

const firstRead = getGovernmentOrders(realmId);
const secondRead = getGovernmentOrders(realmId);
assert.equal(firstRead.length, 7);
assert.deepEqual(firstRead.map(order => order.id), secondRead.map(order => order.id), 'project IDs must remain stable');
assert.deepEqual(firstRead.map(order => order.projectKey), secondRead.map(order => order.projectKey));
assert.ok(firstRead.some(order => order.name === 'Mars Rover'));
assert.ok(firstRead.some(order => order.name === 'Drone Fleet'));
assert.ok(firstRead.some(order => order.name === 'Green Diplomatic Fleet'));
for (const order of firstRead) {
  assert.ok(order.projectKey);
  assert.ok(order.created);
  assert.ok(order.startDate);
  assert.ok(order.deadline);
  assert.ok(Date.parse(order.deadline) > Date.parse(order.startDate));
  assert.ok(order.daysToFulfill > 0);
  assert.ok(order.governmentorderrequiredresourceSet.length > 3);
  for (const resource of order.governmentorderrequiredresourceSet) {
    assert.ok(resource.kind > 0);
    assert.ok(resource.name && !resource.name.startsWith('Resource #'));
    assert.ok(resource.quality >= 0);
    assert.ok(resource.amount > 0);
    assert.equal(resource.amount, resource.targetAmount ?? resource.amountBase);
  }
}

async function dispatch(pathname: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const req = new EventEmitter() as IncomingMessage;
  Object.assign(req, { url: pathname, method: 'GET', headers: {}, resume: () => req });
  const response = { status: 0, body: '' };
  const res = {
    setHeader() {},
    writeHead(status: number) { response.status = status; },
    end(body?: unknown) { response.body = body === undefined ? '' : String(body); },
    getHeader() { return undefined; }
  } as unknown as ServerResponse;
  const handled = await globalRouteRegistry.dispatch(req, res, pathname, 'GET', null);
  assert.equal(handled, true);
  return { status: response.status, payload: JSON.parse(response.body) as Record<string, unknown> };
}

const v3 = await dispatch(`/api/v3/realms/${realmId}/government-orders/`);
assert.equal(v3.status, 200);
const v3Orders = v3.payload.governmentOrders as Array<{ id: number; name: string; governmentorderrequiredresourceSet: unknown[] }>;
assert.equal(v3Orders.length, 7);
assert.equal((v3.payload.orders as unknown[]).length, 7);

const v1 = await dispatch('/api/v1/government-orders/');
assert.equal(v1.status, 200);
assert.deepEqual(
  (v1.payload.governmentOrders as Array<{ id: number }>).map(order => order.id),
  (v1.payload.orders as Array<{ id: number }>).map(order => order.id)
);

const detail = await dispatch(`/api/v3/government-orders/projects/${firstRead[0].id}/`);
assert.equal(detail.status, 200);
assert.equal(detail.payload.id, firstRead[0].id);
assert.equal(detail.payload.projectKey, firstRead[0].projectKey);
assert.equal((detail.payload.governmentOrders as unknown[]).length, 7);

const missing = await dispatch('/api/v3/government-orders/projects/999999999/');
assert.equal(missing.status, 404);
console.log('PASS stable government projects, resource mapping, v1/v3 parity, and detail errors (#184)');
