import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/connection.ts';
import {
  getGovernmentOrders,
  getGovernmentOrderById,
  getGovernmentTier,
  ensureSeededProjects
} from '../server/game/government.ts';
import { GovernmentOrdersRepository } from '../server/repositories/government-orders-repository.ts';
import '../server/routes/government-routes.ts';
import { globalRouteRegistry } from '../server/http/route-registry.ts';

// Helper to dispatch mock HTTP requests through globalRouteRegistry
async function dispatch(
  pathname: string,
  method: string = 'GET',
  body?: unknown
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = pathname;
  req.headers = { host: '127.0.0.1:3000' };

  let status = 200;
  const headers: Record<string, string> = {};
  let rawBody = '';

  const res = new EventEmitter() as ServerResponse;
  res.statusCode = 200;
  res.setHeader = (key: string, value: string) => {
    headers[key.toLowerCase()] = String(value);
    return res;
  };
  res.getHeader = (key: string) => headers[key.toLowerCase()];
  res.writeHead = (code: number, responseHeaders?: Record<string, string>) => {
    status = code;
    if (responseHeaders) {
      for (const [k, v] of Object.entries(responseHeaders)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    return res;
  };
  res.end = (chunk?: unknown) => {
    if (chunk !== undefined) {
      rawBody += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
    }
    return res;
  };

  const handled = await globalRouteRegistry.dispatch(req, res, pathname, method);
  assert.equal(handled, true, `Route must be handled: ${method} ${pathname}`);
  return {
    status,
    payload: rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  };
}

const testRealmId = 191;

// Clean slate for testRealmId
db.prepare('DELETE FROM government_orders WHERE realm_id = ?').run(testRealmId);

// 1. Acceptance Criteria: Standard projects seeded with valid agencies and client-compatible keys
console.log('Test 1: Standard projects seeding and agency validity');
ensureSeededProjects(testRealmId);
const seededOrders = getGovernmentOrders(testRealmId);
assert.equal(seededOrders.length, 7, 'Must seed 7 standard government procurement projects');

const expectedAgencies: Record<string, true> = {
  FIRE_DEPARTMENT: true,
  SPACE_EXPLORATION_AGENCY: true,
  DEPARTMENT_OF_DEFENSE: true,
  ENVIRONMENTAL_PROTECTION_AGENCY: true,
  DEPARTMENT_OF_AGRICULTURE: true,
  ENERGY_DEPARTMENT: true,
  PUBLIC_HEALTH_DEPARTMENT: true
};

for (const order of seededOrders) {
  assert.ok(order.id > 0, 'Order ID must be positive number');
  assert.ok(order.agency, `Agency must not be empty for project ${order.projectKey}`);
  assert.ok(expectedAgencies[order.agency], `Agency ${order.agency} must be in recognized agencies list`);
  assert.ok(order.projectKey, 'projectKey must be defined');
  assert.ok(order.name, 'name must be defined');
  assert.ok(order.deadline, 'deadline must be defined');
  assert.ok(!isNaN(Date.parse(order.deadline)), 'deadline must be valid ISO date string');
  assert.ok(order.startDate, 'startDate must be defined');
  assert.ok(!isNaN(Date.parse(order.startDate)), 'startDate must be valid ISO date string');
  assert.ok(order.governmentorderrequiredresourceSet.length > 0, 'required resources must not be empty');

  for (const resource of order.governmentorderrequiredresourceSet) {
    assert.ok(resource.id > 0, 'Resource ID must be positive number');
    assert.ok(resource.kind > 0, 'Resource kind must be positive number');
    assert.ok(typeof resource.quality === 'number' && resource.quality >= 0, 'Resource quality must be non-negative number');
    assert.ok(resource.amountBase > 0, 'Resource amountBase must be positive');
    assert.ok(resource.name, 'Resource name must be defined');
  }
}

// 2. Acceptance Criteria: Missing agency, null agency, or empty agency has safe default
console.log('Test 2: Missing or null agency has safe fallback');
const nullAgencyId = 191001;
db.prepare('DELETE FROM government_orders WHERE id = ?').run(nullAgencyId);
try {
  db.prepare(`
    INSERT INTO government_orders (
      id, realm_id, project_key, agency, estimated_base_value, days_to_fulfill,
      resource_multiplier_awarded, required_resources_json, unit_compensation_price,
      start_date, deadline, created_at
    ) VALUES (?, ?, 'FIRE_TRUCKS', NULL, 260000, 7, NULL, '[]', 85, NULL, NULL, NULL)
  `).run(nullAgencyId, testRealmId);

  const resolved = getGovernmentOrderById(nullAgencyId);
  assert.ok(resolved, 'Order with NULL agency must be resolvable');
  assert.equal(resolved.agency, 'FIRE_DEPARTMENT', 'Must fall back to official agency for FIRE_TRUCKS');
} finally {
  db.prepare('DELETE FROM government_orders WHERE id = ?').run(nullAgencyId);
}

// 3. Acceptance Criteria: Dirty data, corrupted JSON, missing fields do not crash
console.log('Test 3: Dirty data and corrupted JSON do not crash');
const dirtyId = 191002;
db.prepare('DELETE FROM government_orders WHERE id = ?').run(dirtyId);
try {
  db.prepare(`
    INSERT INTO government_orders (
      id, realm_id, project_key, agency, estimated_base_value, days_to_fulfill,
      resource_multiplier_awarded, required_resources_json, unit_compensation_price,
      start_date, deadline, created_at
    ) VALUES (?, ?, 'INVALID_NON_EXISTENT_KEY', '', NULL, NULL, NULL, 'NOT_A_JSON', NULL, 'INVALID_DATE', 'INVALID_DATE', NULL)
  `).run(dirtyId, testRealmId);

  const dirtyResolved = getGovernmentOrderById(dirtyId);
  assert.ok(dirtyResolved, 'Dirty order must be successfully parsed without throwing');
  assert.equal(dirtyResolved.projectKey, 'FIRE_TRUCKS', 'Unknown projectKey must fall back to safe client key');
  assert.ok(dirtyResolved.agency, 'Agency must not be empty');
  assert.equal(dirtyResolved.agency, 'FIRE_DEPARTMENT', 'Agency must fall back to safe agency');
  assert.ok(!isNaN(Date.parse(dirtyResolved.deadline)), 'Deadline must fall back to valid ISO string');
  assert.ok(!isNaN(Date.parse(dirtyResolved.startDate)), 'StartDate must fall back to valid ISO string');
  assert.ok(dirtyResolved.governmentorderrequiredresourceSet.length > 0, 'Resources must fall back to safe non-empty list');
  assert.ok(dirtyResolved.estimatedBaseValue > 0, 'Estimated base value must have safe positive default');
} finally {
  db.prepare('DELETE FROM government_orders WHERE id = ?').run(dirtyId);
}

// 4. Acceptance Criteria: Legacy project keys are normalized
console.log('Test 4: Legacy project keys are normalized');
const legacyKeys = [
  ['FIRE_TRUCK_FLEET', 'FIRE_TRUCKS'],
  ['STRATEGIC_GRAIN_RESERVE', 'CROP_DIVERSITY_PROGRAM'],
  ['GRID_REINFORCEMENT', 'FUEL_RESERVES'],
  ['EMERGENCY_MEDICAL_SUPPLY', 'MEDICAL_SUPPLIES'],
  ['SATELLITE_NETWORK', 'MARS_ROVER'],
  ['BORDER_SECURITY_LOGISTICS', 'DRONE_FLEET'],
  ['CLEAN_WATER_INITIATIVE', 'GREEN_DIPLOMATIC_FLEET']
];

for (let i = 0; i < legacyKeys.length; i++) {
  const [oldKey, expectedKey] = legacyKeys[i];
  const legId = 191010 + i;
  db.prepare('DELETE FROM government_orders WHERE id = ?').run(legId);
  try {
    db.prepare(`
      INSERT INTO government_orders (
        id, realm_id, project_key, agency, estimated_base_value, days_to_fulfill,
        resource_multiplier_awarded, required_resources_json, unit_compensation_price,
        start_date, deadline, created_at
      ) VALUES (?, ?, ?, NULL, 200000, 5, NULL, '[]', 50, NULL, NULL, NULL)
    `).run(legId, testRealmId, oldKey);

    const legOrder = getGovernmentOrderById(legId);
    assert.ok(legOrder, `Legacy order ${oldKey} must resolve`);
    assert.equal(legOrder.projectKey, expectedKey, `Legacy key ${oldKey} must map to ${expectedKey}`);
    assert.ok(legOrder.agency, `Agency for ${oldKey} must not be empty`);
  } finally {
    db.prepare('DELETE FROM government_orders WHERE id = ?').run(legId);
  }
}

// 5. Acceptance Criteria: v1 and v3 endpoints field parity (agency, project, resources, quality, deadline)
console.log('Test 5: v1 and v3 endpoints field parity');
const v3OrdersRes = await dispatch(`/api/v3/realms/${testRealmId}/government-orders/`);
assert.equal(v3OrdersRes.status, 200);
const v3Orders = v3OrdersRes.payload.governmentOrders as Array<Record<string, unknown>>;
assert.equal(v3Orders.length, 7);
assert.ok(Array.isArray(v3OrdersRes.payload.orders), 'v3 response must also contain orders array');

const v1OrdersRes = await dispatch(`/api/v1/realms/${testRealmId}/government-orders/`);
assert.equal(v1OrdersRes.status, 200);
const v1Orders = v1OrdersRes.payload.governmentOrders as Array<Record<string, unknown>>;
assert.equal(v1Orders.length, 7);
assert.ok(Array.isArray(v1OrdersRes.payload.orders), 'v1 response must also contain orders array');

for (let i = 0; i < 7; i++) {
  const v3O = v3Orders[i];
  const v1O = v1Orders[i];

  assert.equal(v3O.id, v1O.id, 'IDs must match between v1 and v3');
  assert.equal(v3O.projectKey, v1O.projectKey, 'projectKey must match between v1 and v3');
  assert.equal(v3O.agency, v1O.agency, 'agency must match between v1 and v3');
  assert.equal(v3O.deadline, v1O.deadline, 'deadline must match between v1 and v3');
  assert.deepEqual(v3O.governmentorderrequiredresourceSet, v1O.governmentorderrequiredresourceSet, 'resources must match between v1 and v3');
}

// 6. Acceptance Criteria: Endpoint compatibility across various URL formats
console.log('Test 6: Endpoint compatibility across URL formats');
const urlVariants = [
  `/api/v3/government-orders/`,
  `/api/v3/government-orders/${testRealmId}/`,
  `/api/v3/government-orders/realm/${testRealmId}/`,
  `/api/v1/government-orders/`,
  `/api/v1/government-orders/${testRealmId}/`,
  `/api/v1/government-orders/realm/${testRealmId}/`
];

for (const url of urlVariants) {
  const res = await dispatch(url);
  assert.equal(res.status, 200, `Endpoint ${url} must return 200`);
  assert.ok(Array.isArray(res.payload.governmentOrders), `Endpoint ${url} must include governmentOrders array`);
  assert.ok(Array.isArray(res.payload.orders), `Endpoint ${url} must include orders array`);
}

// 7. Acceptance Criteria: Single project detail endpoint returns template with agency
console.log('Test 7: Single project detail endpoint');
const firstOrderId = seededOrders[0].id;
const projectRes = await dispatch(`/api/v3/government-orders/projects/${firstOrderId}/`);
assert.equal(projectRes.status, 200);
assert.equal(projectRes.payload.id, firstOrderId);
assert.ok(projectRes.payload.agency, 'Single project detail must include agency');
assert.ok(Array.isArray(projectRes.payload.governmentOrders), 'Single project detail must include governmentOrders');

// 8. Clean up
db.prepare('DELETE FROM government_orders WHERE realm_id = ?').run(testRealmId);

console.log('ALL VERIFICATION CHECKS PASSED (#191)!');
