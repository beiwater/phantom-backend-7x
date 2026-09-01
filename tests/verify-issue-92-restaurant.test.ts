/**
 * Verification test suite for Issue #92: Restaurant subsystem.
 *
 * Run with an isolated server:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-92-restaurant.test.ts
 *
 * Covers the decompiled restaurant guide spec:
 *   1. Module registration: /api/v2/restaurants/... and /api/v2/restaurant-menu/
 *      routes are served by the restaurant subsystem.
 *   2. 12-hour cycle lifecycle: every run is one fixed 12-hour cycle
 *      (cycleEnd - cycleStart === 12h) and menu food loaded from the warehouse
 *      spoils at the end of the cycle regardless of sales.
 *   3. Seating capacity: economy = 1,000 seats per building level,
 *      luxury = 500 seats per building level; professional staff wages = 5x
 *      basic staff wages.
 *   4. 10-star rating scale: rating stays within 0.0 - 10.0 and is derived
 *      from quality / service / menu balance.
 */
const PORT = process.env.PORT || '3810';
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

interface ApiResult {
  status: number;
  json: any;
}

async function api(
  cookie: string,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<ApiResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON response
  }
  return { status: response.status, json };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `rest_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Rest Co ${label} ${Date.now()}` })
  });
  assert.equal(response.status, 200, `Registration failed for ${label}: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie missing');
  const auth = await api(cookie as string, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(auth.status, 200);
  const companyId = auth.json.authCompany.companyId;
  return { cookie: cookie as string, companyId };
}

async function getStock(cookie: string, companyId: number, kind: number): Promise<number> {
  const stock = await api(cookie, 'GET', `/api/v3/resources/${companyId}/`);
  assert.equal(stock.status, 200, 'warehouse stock readable');
  const rows = Array.isArray(stock.json) ? stock.json : [];
  const row = rows.find((r: { kind: number }) => r.kind === kind);
  return row ? Number(row.amount) : 0;
}

async function getCash(cookie: string): Promise<number> {
  const balance = await api(cookie, 'GET', '/api/v2/companies/me/balance-sheet/');
  assert.equal(balance.status, 200, 'balance sheet readable');
  return Number(balance.json.cash);
}

interface TestServer {
  child: ChildProcess;
  dataDir: string;
  port: number;
}

async function waitUntilReachable(url: string, timeoutMs: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const deadline = Date.now() + timeoutMs;
  const probe = async (): Promise<void> => {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {
        // Retry
      }
      await new Promise(res => setTimeout(res, 400));
    }
    reject(new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`));
  };
  void probe();
  return promise;
}

async function startTestServer(portNumber: number): Promise<TestServer> {
  const dataDir = path.resolve('data', `test-run-restaurant-${portNumber}-${Date.now()}`);
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(portNumber),
        DATA_DIR: dataDir
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );
  child.stderr?.on('data', chunk => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) {
      process.stderr.write(`[test-srv] ${text}`);
    }
  });
  await waitUntilReachable(`http://127.0.0.1:${portNumber}/version/`, 30000);
  return { child, dataDir, port: portNumber };
}

const CYCLE_MS = 12 * 60 * 60 * 1000;

async function runRestaurantTests(): Promise<void> {
  const { cookie, companyId } = await registerCompany('main');
  let buildingId = 0;

  // --- 1. Module registration -------------------------------------------
  console.log('1. Restaurant module registration');
  {
    const anon = await api('', 'GET', '/api/v2/restaurants/');
    assert.equal(anon.status, 401, 'unauthenticated restaurant list is rejected with 401');

    const list = await api(cookie, 'GET', '/api/v2/restaurants/');
    assert.equal(list.status, 200, 'GET /api/v2/restaurants/ is registered and served');
    assert.deepEqual(list.json.restaurants, [], 'new company has no restaurants yet');

    const menu = await api(cookie, 'GET', '/api/v2/restaurant-menu/');
    assert.equal(menu.status, 200, 'GET /api/v2/restaurant-menu/ is registered and served');
    assert.equal(menu.json.dishes.length, 16, 'restaurant guide lists 16 dishes');
    const hamburger = menu.json.dishes.find((d: { kind: number }) => d.kind === 119);
    assert.ok(hamburger, 'hamburger present in the guide');
    assert.equal(hamburger.name, 'Hamburger', 'guide carries dish names');
    for (const key of ['kind', 'name', 'category', 'suggestedPrice', 'image']) {
      assert.ok(hamburger[key] !== undefined, `guide entry has ${key}`);
    }
  }

  // --- 2. Construction of a restaurant ----------------------------------
  console.log('2. Restaurant construction (kind r)');
  {
    const constructed = await api(cookie, 'POST', '/api/v2/companies/me/buildings/', {
      kind: 'r',
      position: '2'
    });
    assert.equal(constructed.status, 200, `restaurant constructed: ${JSON.stringify(constructed.json)}`);
    buildingId = constructed.json.building.id;
    assert.ok(buildingId > 0, 'constructed building has an id');

    const list = await api(cookie, 'GET', '/api/v2/restaurants/');
    assert.equal(list.json.restaurants.length, 1, 'restaurant appears in the company list');
    assert.equal(list.json.restaurants[0].buildingId, buildingId, 'list references the restaurant building');
  }

  // --- 3. Seating capacity: 1,000 per level (economy) --------------------
  console.log('3. Seating capacity: economy 1,000 seats per level');
  {
    const detail = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    assert.equal(detail.status, 200, 'restaurant detail readable');
    assert.equal(detail.json.restaurantProperties.seats, 1000, 'economy level 1 = 1,000 seats');
    assert.equal(detail.json.restaurantProperties.isLuxury, false, 'default format is economy');
  }

  // --- 4. Seating capacity: 500 per level (luxury) ------------------------
  console.log('4. Seating capacity: luxury 500 seats per level');
  {
    const updated = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { isLuxury: true });
    assert.equal(updated.status, 200, 'luxury format accepted');
    assert.equal(updated.json.restaurantProperties.seats, 500, 'luxury level 1 = 500 seats');

    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { isLuxury: false });
    const detail = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    assert.equal(detail.json.restaurantProperties.seats, 1000, 'switching back restores 1,000 seats');
  }

  // --- 5. 10-star rating scale and menu setup ----------------------------
  console.log('5. 10-star rating scale and menu setup');
  {
    const basic = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    const basicRating = basic.json.restaurantProperties.rating;
    assert.ok(basicRating >= 0 && basicRating <= 10, `default rating within 0-10 (got ${basicRating})`);

    const maxMenu = [117, 119, 121, 122, 123, 129, 130, 131].map(kind => ({
      resource: kind,
      quality: 2,
      price: 20
    }));
    const upgraded = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, {
      menu: maxMenu,
      goodService: true,
      professionalStaff: true
    });
    assert.equal(upgraded.status, 200, 'menu setup accepted');
    assert.equal(upgraded.json.restaurantProperties.rating, 10, 'quality 2 + professional service + 8 dishes = 10.0 stars');
    assert.equal(upgraded.json.restaurantProperties.menu.length, 8, 'menu persisted');
    assert.equal(upgraded.json.restaurantProperties.professionalStaff, true, 'professional staff persisted');
    assert.ok(upgraded.json.restaurantProperties.occupancy >= 0 && upgraded.json.restaurantProperties.occupancy <= 1,
      'occupancy derived from rating stays in [0, 1]');

    const invalid = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, {
      menu: [{ resource: 3, quality: 0, price: 5 }]
    });
    assert.equal(invalid.status, 400, 'non-dish resources are rejected from the menu');

    // Back to a lean basic-staff setup for the cycle tests.
    const lean = await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, {
      menu: [{ resource: 119, quality: 0, price: 18.5 }],
      goodService: true,
      professionalStaff: false
    });
    assert.equal(lean.json.restaurantProperties.rating, 1.6, 'lean setup rating = service 1.2 + menu balance 0.375 (rounded)');

    const ratings = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/ratings/`);
    assert.equal(ratings.status, 200, 'ratings endpoint registered');
    for (const key of ['overallRating', 'foodRating', 'serviceRating', 'ambianceRating']) {
      const value = Number(ratings.json[key]);
      assert.ok(value >= 0 && value <= 10, `${key} on 0-10 scale (got ${value})`);
    }
  }

  // --- 6. 12-hour cycle lifecycle and food spoilage -----------------------
  console.log('6. 12-hour cycle: full load, spoilage regardless of sales');
  {
    const stockBefore = await getStock(cookie, companyId, 119);
    assert.equal(stockBefore, 5000, 'seed warehouse holds 5,000 hamburgers');
    const cashBefore = await getCash(cookie);

    const run = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(run.status, 200, `cycle executed: ${JSON.stringify(run.json)}`);

    const r = run.json.run;
    assert.equal(r.capacity, 1000, 'cycle capacity = 1,000 seats');
    assert.equal(r.prepared, 1000, 'one dish per seat loaded for the cycle');
    assert.ok(r.served >= 800 && r.served <= 980, `served guests in occupancy band (got ${r.served})`);
    assert.ok(r.spoiled > 0, `unsold loaded food spoiled (got ${r.spoiled})`);
    assert.equal(r.spoiled, r.prepared - r.served, 'spoiled = prepared - served');
    assert.equal(new Date(r.cycleEnd).getTime() - new Date(r.cycleStart).getTime(), CYCLE_MS,
      'cycle length is exactly 12 hours');
    assert.equal(r.wages, 200, 'basic staff wages = 200 per cycle');
    assert.equal(r.foodCost, 1000, 'full loaded food cost charged (1,000 units @ 1.0)');
    assert.equal(r.revenue, Math.round(r.served * 18.5 * 100) / 100, 'revenue = served x menu price');
    assert.equal(r.cost, Math.round((r.foodCost + r.wages) * 100) / 100, 'cost = food + wages');
    assert.equal(r.profit, Math.round((r.revenue - r.cost) * 100) / 100, 'profit = revenue - cost');

    const stockAfter = await getStock(cookie, companyId, 119);
    assert.equal(stockAfter, stockBefore - r.prepared,
      'warehouse decremented by the full load, not by sales (spoilage regardless of sales)');

    const cashAfter = await getCash(cookie);
    assert.equal(Math.round((cashAfter - cashBefore) * 100) / 100, r.profit, 'company money changed by the cycle profit');

    const runs = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(runs.status, 200, 'runs list registered');
    assert.ok(runs.json.runs.length >= 1, 'run persisted');
    assert.equal(runs.json.runs[0].id, r.id, 'newest run first');
    assert.equal(runs.json.runs[0].spoiled, r.spoiled, 'run history carries spoilage');
  }

  // --- 7. Partial load caps sales ----------------------------------------
  console.log('7. Partial load: sales limited by loaded food');
  {
    // Salad (#129) is not in stock: half the menu cannot be loaded.
    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, {
      menu: [
        { resource: 119, quality: 0, price: 18.5 },
        { resource: 129, quality: 0, price: 12.0 }
      ]
    });
    const stockBefore = await getStock(cookie, companyId, 119);

    const run = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(run.status, 200, 'cycle with partial load executed');
    const r = run.json.run;
    assert.equal(r.prepared, 500, 'only the stocked dish is loaded (500 of 1,000)');
    assert.equal(r.served, 500, 'service capped by loaded food');
    assert.equal(r.spoiled, 0, 'sold-out food does not spoil');
    const avgPrice = (18.5 + 12.0) / 2;
    assert.equal(r.revenue, Math.round(500 * avgPrice * 100) / 100, 'revenue follows the menu average price');

    const stockAfter = await getStock(cookie, companyId, 119);
    assert.equal(stockAfter, stockBefore - 500, 'hamburger stock decremented by the load');
  }

  // --- 8. Professional staff wages = 5x ----------------------------------
  console.log('8. Professional staff wages: 5x multiplier');
  {
    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { professionalStaff: true });
    const run = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(run.status, 200, 'cycle with professional staff executed');
    assert.equal(run.json.run.wages, 1000, 'professional staff wages = 5 x 200 = 1,000 per cycle');

    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { professionalStaff: false });
  }

  // --- 9. Empty warehouse: no food, no sales, wages still due -------------
  console.log('9. Cycle without food: no sales, wages still due');
  {
    // Drain the remaining hamburgers (3,000 left after tests 6-8).
    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, {
      menu: [{ resource: 119, quality: 0, price: 18.5 }]
    });
    for (let i = 0; i < 3; i++) {
      const drain = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
      assert.equal(drain.status, 200, `drain cycle ${i + 1} executed`);
    }
    const leftover = await getStock(cookie, companyId, 119);
    assert.equal(leftover, 0, 'hamburger stock fully consumed by cycles');

    const dry = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(dry.status, 200, 'cycle without food still resolves');
    const r = dry.json.run;
    assert.equal(r.prepared, 0, 'no food loaded');
    assert.equal(r.served, 0, 'no guests served without food');
    assert.equal(r.spoiled, 0, 'nothing to spoil');
    assert.equal(r.revenue, 0, 'no revenue without food');
    assert.equal(r.profit, -200, 'basic staff wages still due (profit = -200)');

    const cashBefore = await getCash(cookie);
    await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    const cashAfter = await getCash(cookie);
    assert.equal(Math.round((cashAfter - cashBefore) * 100) / 100, -200, 'wages deducted from company money');
  }

  // --- 10. Closed restaurant and atomicity --------------------------------
  console.log('10. Closed restaurant rejects cycles atomically');
  {
    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { keepOpen: false });
    const runsBefore = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/runs/`);
    const countBefore = runsBefore.json.runs.length;

    const closed = await api(cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(closed.status, 400, 'closed restaurant cannot start a cycle');

    const runsAfter = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(runsAfter.json.runs.length, countBefore, 'failed cycle persisted no run row');
    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { keepOpen: true });
  }

  // --- 11. Per-level seating after upgrade ---------------------------------
  console.log('11. Seating scales per building level');
  {
    const loan = await api(cookie, 'POST', '/api/v2/companies/me/loans/', { amount: 100000 });
    assert.equal(loan.status, 200, `loan taken to fund the upgrade: ${JSON.stringify(loan.json)}`);

    // Construction/upgrade sets a 10s busy window; poll until the upgrade lands.
    const deadline = Date.now() + 25000;
    let upgrade = await api(cookie, 'PATCH', `/api/v2/companies/buildings/${buildingId}/`, { size: 1 });
    while (upgrade.status !== 200 && Date.now() < deadline) {
      await new Promise(res => setTimeout(res, 1000));
      upgrade = await api(cookie, 'PATCH', `/api/v2/companies/buildings/${buildingId}/`, { size: 1 });
    }
    assert.equal(upgrade.status, 200, `upgrade to level 2 succeeded: ${JSON.stringify(upgrade.json)}`);

    const economy = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    assert.equal(economy.json.restaurantProperties.seats, 2000, 'economy level 2 = 2,000 seats');

    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { isLuxury: true });
    const luxury = await api(cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    assert.equal(luxury.json.restaurantProperties.seats, 1000, 'luxury level 2 = 1,000 seats');
    await api(cookie, 'PUT', `/api/v2/restaurants/${buildingId}/`, { isLuxury: false });
  }

  // --- 12. Ownership isolation ---------------------------------------------
  console.log('12. Ownership isolation');
  {
    const other = await registerCompany('other');
    const forbidden = await api(other.cookie, 'GET', `/api/v2/restaurants/${buildingId}/`);
    assert.equal(forbidden.status, 404, "another company cannot read the restaurant");
    const forbiddenRun = await api(other.cookie, 'POST', `/api/v2/restaurants/${buildingId}/runs/`);
    assert.equal(forbiddenRun.status, 404, "another company cannot run the restaurant");
    const ownList = await api(other.cookie, 'GET', '/api/v2/restaurants/');
    assert.deepEqual(ownList.json.restaurants, [], "other company's list has no restaurants");
  }

  console.log('\nAll Issue #92 restaurant assertions passed.');
}

async function main(): Promise<void> {
  const server = await startTestServer(Number(PORT));
  try {
    await runRestaurantTests();
  } finally {
    server.child.kill('SIGTERM');
    await new Promise(res => setTimeout(res, 500));
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
    rmSync(server.dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('\nIssue #92 restaurant verification FAILED:', err);
  process.exit(1);
});
