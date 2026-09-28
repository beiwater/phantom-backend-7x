/**
 * P0-02: production queue showed "$NaN" and "Quality: 0" because the queue
 * rows never persisted an input-cost basis and the serialization omitted
 * `resource.unitCost` / `resource.name` — the original frontend renders
 * `unitCost * amount` and guards with `!== null`, so `undefined` leaked into
 * money formatting.
 *
 * Contract under test (HAR/frontend consumption evidence):
 *  - POST /api/v2/companies/buildings/:id/queue/  -> queue item with
 *    `resource.{name,image,kind,quality,unitCost}` all finite numbers.
 *  - GET  /api/v2/companies/buildings/:id/ (busy) -> `busy.resource` carries
 *    the same fields; `unitCost` non-null finite, `quality` >= 0.
 *  - POST /api/v2/order/take/:id/ -> collect succeeds, `resource.{kind,
 *    quality,amount}` finite.
 *  - Values are persisted: re-GET (fresh serialization, no request-scoped
 *    state) returns identical cost/quality.
 *  - Legacy rows (inserted without the cost column) must not serialize as
 *    null: the DTO falls back to on-the-fly computation from current
 *    warehouse/recipe data.
 */
import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3202'}`;

interface QueueResourceDTO {
  name: string;
  image: string;
  kind: number;
  quality: number;
  unitCost: number;
}
interface QueueItemDTO {
  id: number;
  kind: number;
  quality: number;
  amount: number;
  duration: number;
  resource: QueueResourceDTO | null;
}
interface BusyResourceDTO extends QueueResourceDTO {
  amountAvailableNow: number;
}
interface BusyDTO {
  id: number;
  resource: BusyResourceDTO | null;
}

function assertFiniteNumber(value: unknown, label: string): number {
  assert.equal(typeof value, 'number', `${label} must be a JSON number, got ${typeof value}`);
  assert.ok(Number.isFinite(value), `${label} must be finite, got ${value}`);
  return value as number;
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const time = Date.now();
  const email = `p002_${label}_${time}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' })
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'registration must yield a session cookie');
  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(authResponse.status, 200);
  const auth = await authResponse.json() as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function runP0_02Test() {
  console.log('================================================================');
  console.log(' Starting P0-02 Production Cost/Quality Serialization Verification');
  console.log(` Base URL: ${baseUrl}`);
  console.log('================================================================');

  const user = await register('main');
  const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

  // Starter buildings: Farm (kind 'P') produces Apples #3 from Water #2 x3 + Seeds #66 x1.
  const buildings = await (await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, { headers })).json() as
    Array<{ id: number; kind: string; name: string }>;
  const farm = buildings.find(b => b.kind === 'P');
  assert.ok(farm, 'starter Farm building must exist');

  // 1. Start production through the real API (input cost: Water/Seeds cost 1.0 each
  //    in starter warehouse -> apples unit cost = (300*1 + 100*1) / 100 = 4).
  console.log('[1/5] Starting apple production via POST /queue/...');
  const startRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farm.id}/queue/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 3, amount: 100 })
  });
  assert.equal(startRes.status, 200, `queue POST must succeed: ${startRes.status}`);
  const startedQueue = await startRes.json() as QueueItemDTO[];
  assert.ok(Array.isArray(startedQueue), 'queue POST must return the updated queue list');
  const started = startedQueue.find(item => item.kind === 3);
  assert.ok(started, 'the newly started production task must be present in the response');
  assert.ok(started.id, 'queue item id returned');
  assert.equal(started.kind, 3);
  assert.ok(started.amount > 0, 'queue amount must be positive');
  assert.ok(started.duration > 0, 'queue duration must be positive');

  assertFiniteNumber(started.quality, 'queue.quality');
  assert.ok(started.quality >= 0, 'queue.quality must be >= 0');
  assert.ok(started.resource, 'queue.resource must be present');
  assertFiniteNumber(started.resource!.unitCost, 'queue.resource.unitCost');
  assertFiniteNumber(started.resource!.amount ?? started.amount, 'queue.amount');
  assert.equal(started.resource!.kind, 3);
  assert.ok(started.resource!.name.length > 0, 'queue.resource.name must be non-empty');
  assert.ok(started.resource!.unitCost > 0, 'apples unit cost must reflect consumed input cost');
  const persistedCost = db.prepare('SELECT amount, cost, input_ingredients_json FROM production_queues WHERE id = ?')
    .get(started.id) as { amount: number; cost: number; input_ingredients_json: string };
  const consumedCost = (JSON.parse(persistedCost.input_ingredients_json) as Array<{
    amount: number;
    cost: { workers: number; admin: number; material1: number; material2: number; market: number };
  }>).reduce((sum, ingredient) => sum + ingredient.amount * Object.values(ingredient.cost).reduce((a, value) => a + value, 0), 0);
  assert.ok(
    Math.abs(persistedCost.amount * persistedCost.cost - consumedCost) < 1e-8,
    'total queued output valuation must equal the exact consumed input cost even when economy changes output amount'
  );
  const applesBeforeCollect = db.prepare('SELECT amount, cost_market FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = ?')
    .get(user.companyId, started.quality) as { amount: number; cost_market: number } | undefined;
  const applesMarketValueBefore = Number(applesBeforeCollect?.amount ?? 0) * Number(applesBeforeCollect?.cost_market ?? 0);
  console.log(`  -> queue item ${started.id}: quality=${started.quality} unitCost=${started.resource!.unitCost} (finite)`);

  // 2. Busy serialization (what the building page DOM renders).
  console.log('[2/5] Verifying building busy serialization...');
  const details = await (await fetch(`${baseUrl}/api/v2/companies/buildings/${farm.id}/`, { headers })).json() as
    { busy: BusyDTO | null };
  const busyResource = details.busy?.resource;
  assert.ok(busyResource, 'busy.resource must be present while producing');
  const busyUnitCost = assertFiniteNumber(busyResource.unitCost, 'busy.resource.unitCost');
  const busyQuality = assertFiniteNumber(busyResource.quality, 'busy.resource.quality');
  assert.ok(busyQuality >= 0, 'busy.resource.quality must be >= 0');
  assert.ok(busyResource.name.length > 0, 'busy.resource.name must be non-empty');
  assert.equal(busyUnitCost, started.resource!.unitCost, 'busy.unitCost must match queue serialization');
  console.log(`  -> busy.resource: name="${busyResource.name}" quality=${busyQuality} unitCost=${busyUnitCost}`);

  // 3. Persistence: values must be stable across a fresh GET (no request-scoped recomputation).
  console.log('[3/5] Verifying value stability across re-GET...');
  const queueAgain = await (await fetch(`${baseUrl}/api/v2/companies/buildings/${farm.id}/queue/`, { headers })).json() as QueueItemDTO[];
  const row = queueAgain.find(q => q.id === started.id);
  assert.ok(row, 'started queue item must still be listed');
  assert.equal(row!.quality, started.quality, 'quality must be identical after re-GET');
  assert.equal(row!.resource!.unitCost, started.resource!.unitCost, 'unitCost must be identical after re-GET');

  // This regression covers persistence/serialization and collection, not the
  // production clock. Finish the persisted order directly so the test stays
  // independent of whichever economy speed the isolated server starts with.
  const finishedAt = new Date(Date.now() - 1000).toISOString();
  db.prepare('UPDATE production_queues SET finishes_at = ? WHERE id = ?').run(finishedAt, started.id);
  const finishedRow = db.prepare('SELECT finishes_at FROM production_queues WHERE id = ?')
    .get(started.id) as { finishes_at: string } | undefined;
  assert.ok(finishedRow && Date.parse(finishedRow.finishes_at) <= Date.now(), 'test fixture marks the persisted order finished');

  // 4. Collect must succeed and return finite resource numbers.
  console.log('[4/5] Collecting finished production...');
  const takeRes = await fetch(`${baseUrl}/api/v2/order/take/${farm.id}/`, {
    method: 'POST',
    headers,
    body: '{}'
  });
  assert.equal(takeRes.status, 200, `collect must succeed: ${takeRes.status}`);
  const takeData = await takeRes.json() as {
    success: boolean;
    resource: { kind: number; quality: number; amount: number };
  };
  assert.equal(takeData.success, true);
  assertFiniteNumber(takeData.resource.quality, 'collect.resource.quality');
  assertFiniteNumber(takeData.resource.amount, 'collect.resource.amount');
  assert.ok(takeData.resource.amount > 0, 'collected amount must be positive');
  const applesAfterCollect = db.prepare('SELECT amount, cost_market FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = ?')
    .get(user.companyId, started.quality) as { amount: number; cost_market: number };
  assert.ok(
    Math.abs(Number(applesAfterCollect.amount) * Number(applesAfterCollect.cost_market) - applesMarketValueBefore - consumedCost) < 1e-6,
    'collected warehouse market value must increase by the consumed input basis'
  );
  console.log(`  -> collected: kind=${takeData.resource.kind} quality=${takeData.resource.quality} amount=${takeData.resource.amount}`);

  // 5. History must echo the persisted quality (stable after refresh/collect).
  console.log('[5/5] Verifying history echoes persisted values...');
  const history = await (await fetch(`${baseUrl}/api/v2/companies/buildings/${farm.id}/history/`, { headers })).json() as
    Array<{ id: number; quality: number; amount: number }>;
  const histRow = history.find(h => h.id === started.id);
  assert.ok(histRow, 'collected item must appear in history');
  assertFiniteNumber(histRow!.quality, 'history.quality');
  assert.equal(histRow!.quality, started.quality, 'history quality must match queue-time quality');

  // 6. Legacy-row fallback: a queue row persisted WITHOUT a cost basis (as in
  //    databases created before this fix) must serialize as a finite number,
  //    computed on the fly from current warehouse/recipe data.
  console.log('[6/6] Verifying legacy row (cost=NULL) fallback serialization...');
  const nowIso = new Date().toISOString();
  const legacyId = db.prepare(`
    INSERT INTO production_queues (building_id, company_id, kind, quality, cost, amount, duration_seconds, started_at, finishes_at, resolved)
    VALUES (?, ?, 3, 0, NULL, 100, 600, ?, ?, 0)
  `).run(farm.id, user.companyId, nowIso, new Date(Date.now() + 600000).toISOString()).lastInsertRowid as number;
  const legacyQueue = await (await fetch(`${baseUrl}/api/v2/companies/buildings/${farm.id}/queue/`, { headers })).json() as QueueItemDTO[];
  const legacyRow = legacyQueue.find(q => q.id === legacyId);
  assert.ok(legacyRow, 'legacy row must be serialized');
  const legacyUnitCost = assertFiniteNumber(legacyRow!.resource!.unitCost, 'legacy.resource.unitCost');
  assert.ok(legacyUnitCost > 0, 'legacy fallback unit cost must be computed from warehouse costs, not null');
  assert.ok(legacyRow!.resource!.name.length > 0, 'legacy resource name must be non-empty');
  assertFiniteNumber(legacyRow!.quality, 'legacy.quality');
  assert.ok(legacyRow!.quality >= 0, 'legacy.quality must be >= 0');
  console.log(`  -> legacy row fallback unitCost=${legacyUnitCost} quality=${legacyRow!.quality} (finite, no NaN)`);
  // Cleanup the synthetic legacy row so it cannot affect other tests.
  db.prepare('DELETE FROM production_queues WHERE id = ?').run(legacyId);

  console.log('================================================================');
  console.log(' ✅ P0-02 PRODUCTION COST/QUALITY PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runP0_02Test().catch(err => {
  console.error('❌ P0-02 test failed:', err);
  process.exit(1);
});
