/**
 * Deterministic restaurant-guide regression script.
 *
 * Run:
 *   node --experimental-strip-types tests/verify-issue-92-restaurant.test.ts
 *
 * The script starts an isolated backend, seeds only the food needed by the
 * scenario, advances cycle timestamps in that isolated SQLite database, and
 * verifies the public API. It is intentionally reproducible and does not
 * change the development database.
 */
import assert from 'node:assert/strict';
import { withTestServer, type TestServer } from './support/test-server.ts';

let server: TestServer;
const CYCLE_MS = 12 * 60 * 60 * 1000;
interface ApiResult { status: number; json: any; }

async function api(cookie: string, method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  return server.request(method, urlPath, {cookie, body});
}

async function registerCompany(label: string) {
  return server.registerCompany(label);
}

function seedFood(dataDir: string, companyId: number, quality: number, kinds: number[]): void {
  const database = server.db;
  const now = new Date().toISOString();
  for (const kind of kinds) {
    database.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, ?, 1000, 0, 0, 0, 0, 1, ?)
      ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 1000, updated_at = excluded.updated_at
    `).run(companyId, kind, quality, now);
  }
}

function expireRun(dataDir: string, runId: number): void {
  const database = server.db;
  database.prepare('UPDATE restaurant_runs SET cycle_end = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), runId);
}

function finishReconstruction(dataDir: string, buildingId: number): void {
  const database = server.db;
  const finished = new Date(Date.now() - 1000).toISOString();
  database.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(finished, buildingId);
  database.prepare('UPDATE restaurant_properties SET reconstruction_until = ? WHERE building_id = ?').run(finished, buildingId);
}

async function waitForRestaurantIdle(cookie: string, buildingId: number, timeoutMs: number = 16000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    const busyUntil = detail.json?.building?.busy_until ? new Date(detail.json.building.busy_until).getTime() : 0;
    if (detail.status === 200 && busyUntil <= Date.now()) return detail.json;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('restaurant did not become idle in time');
}

async function getBuildingDTO(cookie: string, buildingId: number): Promise<any> {
  const list = await api(cookie, 'GET', '/api/v2/companies/me/buildings/');
  assert.equal(list.status, 200);
  return list.json.find((building: any) => building.id === buildingId);
}

async function run(): Promise<void> {
  await withTestServer(async instance => {
    server = instance;
    const { cookie, companyId } = await registerCompany('main');
    console.log('1. menu guide and restaurant construction');
    const menuGuide = await api(cookie, 'GET', '/api/v2/restaurant-menu/');
    assert.equal(menuGuide.status, 200);
    assert.deepEqual(menuGuide.json.dishes.map((dish: any) => dish.kind), [117, 121, 134, 122, 119, 123, 129, 130, 131, 142, 143, 132, 124, 125, 126, 149]);
    assert.equal(menuGuide.json.dishes.find((dish: any) => dish.kind === 129).name, 'Hamburger');
    assert.equal(menuGuide.json.dishes.find((dish: any) => dish.kind === 117).name, 'Milk');

    const created = await api(cookie, 'POST', '/api/v2/companies/me/buildings/', { kind: 'r', position: '2' });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const buildingId = Number(created.json.building.id);
    finishReconstruction(server.dataDir, buildingId);
    await waitForRestaurantIdle(cookie, buildingId);

    seedFood(server.dataDir, companyId, 0, [119, 129, 132]);
    seedFood(server.dataDir, companyId, 2, [119, 129, 132]);

    console.log('2. common price, three categories, and invalid price rejection');
    const configured = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, {
      menu: [
        { resource: 119, quality: 0, qualityMode: 'low' },
        { resource: 129, quality: 0, qualityMode: 'low' },
        { resource: 132, quality: 0, qualityMode: 'low' }
      ],
      menuPrice: 96,
      goodService: false,
      keepOpen: false
    });
    assert.equal(configured.status, 200, JSON.stringify(configured.json));
    assert.equal(configured.json.restaurantProperties.menuPrice, 96);
    assert.equal(configured.json.restaurantProperties.menu.length, 3);
    assert.equal(configured.json.restaurantProperties.rating, 0, 'editing the menu preserves the rating until a completed operating cycle');
    const badPrice = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { menuPrice: 59 });
    assert.equal(badPrice.status, 400);

    console.log('3. 12-hour open cycle, exact food coefficients, wages, and duplicate prevention');
    const opened = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { keepOpen: true });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const firstRun = opened.json.cycle;
    assert.ok(firstRun && firstRun.resolved === false, 'opening creates an unresolved cycle');
    assert.equal(firstRun.capacity, 1000);
    assert.equal(firstRun.prepared, 203 + 8 + 9, 'one selected dish in each category uses the 2.1 variety factor');
    assert.equal(firstRun.wages, 7038, '345 x 1.7 x size x 12 hours');
    assert.equal(firstRun.cost, firstRun.foodCost + firstRun.wages);
    assert.equal(new Date(firstRun.cycleEnd).getTime() - new Date(firstRun.cycleStart).getTime(), CYCLE_MS);
    assert.equal(firstRun.revenue, null, 'revenue is deferred until the cycle ends');
    assert.equal((opened.json.moneyUpdate * -1), firstRun.cost);
    const duplicate = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(duplicate.status, 400, 'a second active cycle is rejected');
    const activeBuilding = await getBuildingDTO(cookie, buildingId);
    assert.equal(activeBuilding.busy.category, 'o');

    console.log('4. settlement, spoilage, revenue, and automatic next cycle');
    expireRun(server.dataDir, firstRun.id);
    const runsAfterSettlement = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(runsAfterSettlement.status, 200);
    const settled = runsAfterSettlement.json.runs.find((run: any) => run.id === firstRun.id);
    assert.equal(settled.resolved, true);
    assert.ok(settled.served >= 0 && settled.served <= settled.prepared);
    assert.equal(settled.spoiled, settled.prepared - settled.served);
    assert.equal(settled.revenue, settled.served * 96);
    assert.equal(settled.profit, settled.revenue - settled.cost);
    const nextRun = runsAfterSettlement.json.runs.find((run: any) => run.id !== firstRun.id);
    assert.ok(nextRun && nextRun.resolved === false, 'open restaurant automatically queues the next cycle');

    console.log('5. close penalty and closed-cycle behavior');
    const beforeClose = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    const ratingBeforeClose = Number(beforeClose.json.restaurantProperties.rating);
    const closed = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { keepOpen: false });
    assert.equal(closed.status, 200);
    assert.equal(closed.json.restaurantProperties.rating, ratingBeforeClose, 'scheduling closure preserves rating until the active cycle settles');
    const closedStart = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(closedStart.status, 400);

    console.log('6. luxury reconstruction, seating, cost, and high-quality sourcing');
    expireRun(server.dataDir, nextRun.id);
    const settledClosure = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(settledClosure.status, 200);
    const afterClose = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    assert.equal(afterClose.json.restaurantProperties.rating, Math.round(ratingBeforeClose * 0.875 * 100) / 100);
    const cashBeforeStyle = Number((await api(cookie, 'GET', '/api/v2/companies/me/balance-sheet/')).json.cash);
    const luxury = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { isLuxury: true });
    assert.equal(luxury.status, 200, JSON.stringify(luxury.json));
    assert.equal(luxury.json.restaurantProperties.seats, 500);
    const luxuryBuilding = await getBuildingDTO(cookie, buildingId);
    assert.equal(luxuryBuilding.busy.category, 'b');
    const cashAfterStyle = Number((await api(cookie, 'GET', '/api/v2/companies/me/balance-sheet/')).json.cash);
    assert.equal(cashBeforeStyle - cashAfterStyle, 44850, 'style reconstruction costs ceil(26 x 10 x 345 x size / 2)');
    finishReconstruction(server.dataDir, buildingId);
    await waitForRestaurantIdle(cookie, buildingId);

    const luxuryMenu = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, {
      menu: [
        { resource: 119, quality: 2, qualityMode: 'high' },
        { resource: 129, quality: 2, qualityMode: 'high' },
        { resource: 132, quality: 2, qualityMode: 'high' }
      ],
      menuPrice: 100,
      keepOpen: false
    });
    assert.equal(luxuryMenu.status, 200);
    const luxuryOpened = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { keepOpen: true });
    assert.equal(luxuryOpened.status, 200, JSON.stringify(luxuryOpened.json));
    assert.equal(luxuryOpened.json.cycle.capacity, 500);
    assert.equal(luxuryOpened.json.cycle.prepared, 102 + 4 + 5, 'luxury uses half the economy food requirement');
    assert.equal(luxuryOpened.json.cycle.wages, 3519, 'luxury basic wages are half economy wages');
    assert.ok(luxuryOpened.json.resourceTransactions.every((tx: any) => tx.quality === 2), 'TOP/high mode takes the highest warehouse quality');

    console.log('7. ownership isolation');
    const other = await registerCompany('other');
    const forbidden = await api(other.cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    assert.equal(forbidden.status, 404);
    const ownList = await api(other.cookie, 'GET', '/api/v2/restaurants/');
    assert.deepEqual(ownList.json.restaurants, []);

    console.log('\nAll Issue #92 restaurant guide assertions passed.');
  });
}

run().catch(error => {
  console.error('\nIssue #92 restaurant verification FAILED:', error);
  process.exit(1);
});
