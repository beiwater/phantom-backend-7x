/**
 * Issue #91 Verification Test: Direct Retail Cash Duplicate Fix & Canonical Retail Mapping
 *
 * Requirements:
 * 1. Retail Sale Execution:
 *    - Selling retail goods via POST /api/v1/busy/:id/ credits cash, consumes warehouse stock,
 *      records cash_ledger entry with category 's', and occupies building busy window.
 *    - Retail order is persisted in `retail_orders` table and NOT inserted as active in `production_queues`.
 * 2. Prevent Material/Cash Duplication Exploit:
 *    - Calling /api/v2/order/take/:id/ on retail building or queue ID fails (404 NotFound)
 *      and does NOT duplicate sold materials back to inventory.
 *    - Fast-forwarding time and calling /api/v2/order/take/:id/ still fails (no double collection / no material minting).
 * 3. Canonical Retail Products Mapping:
 *    - Grocery Store ('G'): Apples (3), Oranges (4), Grapes (5), Steak (7), Sausages (8), Eggs (9), etc.
 *    - Gas Station ('A'): Petrol (11), Diesel (12).
 *    - Electronics Store ('C'): Smart phones (24), Tablets (25), Laptops (26), Monitors (27), TVs (28).
 *    - Car Dealership ('2'): Economy e-car (53), Luxury e-car (54), Economy car (55), Luxury car (56), Truck (57).
 *    - Fashion Store ('H'): Underwear (60), Gloves (61), Dress (62), Shoes (63), Handbags (64), Sneakers (65), etc.
 *    - Hardware Store ('d'): Bricks (102), Cement (103), Planks (108), Windows (109), Tools (110).
 *    - Sales Office ('B'): Sub-orbital rocket (91), BFR (94), Jumbo jet (95), etc.
 *    - Restaurant ('r'): Pasta (128), Hamburger (129), Lasagna (130), Meatballs (131), etc.
 *    - Incompatible products rejected with 400.
 * 4. Retail Duration & Revenue Calculation with Demand/Saturation & Quality:
 *    - Lower saturation (higher demand) -> faster sales (shorter duration).
 *    - Higher quality -> faster sales (shorter duration).
 *    - Higher price -> slower sales (longer duration).
 *    - Revenue properly bounded by authoritative pricing.
 *
 * Runs isolated test on port 3720.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

import {
  RETAIL_PRODUCTS,
  getRetailProductsForBuilding,
  isRetailProductForBuilding,
  getAuthoritativeRetailPrice,
  calculateRetailDuration,
  calculateRetailRevenue,
  calculateOptimalRetailPrice,
  calculateRetailUnitsPerHour
} from '../server/game-data/retail.ts';

const TEST_PORT = Number(process.env.PORT || '3720');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function isPortAvailable(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const tester = net
    .createServer()
    .once('error', () => resolve(false))
    .once('listening', () => {
      tester.once('close', () => resolve(true)).close();
    })
    .listen(port, '127.0.0.1');
  return promise;
}

async function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return;
      }
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`);
}

interface ServerInstance {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
}

async function startTestServer(): Promise<ServerInstance> {
  const portAvailable = await isPortAvailable(TEST_PORT);
  assert.ok(portAvailable, `Port ${TEST_PORT} is not available for testing`);

  const dataDir = path.resolve('data', `test-run-issue-91-${Date.now()}`);
  const nodeBinary = existsSync('/opt/magnate/.node22/bin/node')
    ? '/opt/magnate/.node22/bin/node'
    : process.execPath;

  const child = spawn(
    nodeBinary,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATA_DIR: dataDir,
        SPEED_MULTIPLIER: '100'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3720] ${str}`);
    }
  });

  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `retail_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Retail ${label} ${Date.now()}`
    })
  });
  assert.equal(res.status, 200, 'Registration should return 200');

  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.find((v) => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie must be returned');

  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authRes.status, 200, 'Auth data should return 200');
  const authData = (await authRes.json()) as {
    companyPublicInfo?: { id: number };
    authCompany?: { companyId?: number; id?: number };
  };

  const companyId = authData.companyPublicInfo?.id || authData.authCompany?.companyId || authData.authCompany?.id || 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId };
}

async function runTests() {
  console.log('================================================================');
  console.log(' Starting Issue #91: Direct Retail Cash Duplicate Fix & Mapping');
  console.log(` Target Server: ${BASE_URL}`);
  console.log('================================================================\n');

  let server: ServerInstance | null = null;

  try {
    console.log('[Setup] Launching isolated test server on port', TEST_PORT);
    server = await startTestServer();
    console.log('  -> Test server ready.');

    const directDb = new DatabaseSync(server.dbPath);

    // =========================================================================
    // PART 1: Unit & Invariant Checks for Retail Game Data & Formulas
    // =========================================================================
    console.log('\n--- PART 1: Canonical Retail Products Mapping & Formula Invariants ---');

    // 1.1 Canonical building keys check
    console.log('[1/4] Verifying RETAIL_PRODUCTS mapping has canonical building codes...');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['G']), 'Grocery store (G) mapping must exist');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['A']), 'Gas station (A) mapping must exist');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['C']), 'Electronics store (C) mapping must exist');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['2']), 'Car dealership (2) mapping must exist');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['H']), 'Fashion store (H) mapping must exist');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['d']), 'Hardware store (d) mapping must exist');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['B']), 'Sales office (B) mapping must exist');
    assert.ok(Array.isArray(RETAIL_PRODUCTS['r']), 'Restaurant (r) mapping must exist');

    // Specific product mapping checks
    assert.ok(RETAIL_PRODUCTS['G'].includes(3), 'Grocery store sells apples (3)');
    assert.ok(RETAIL_PRODUCTS['G'].includes(4), 'Grocery store sells oranges (4)');
    assert.ok(RETAIL_PRODUCTS['G'].includes(119), 'Grocery store sells coffee powder (119)');
    assert.ok(RETAIL_PRODUCTS['A'].includes(11), 'Gas station sells petrol (11)');
    assert.ok(RETAIL_PRODUCTS['A'].includes(12), 'Gas station sells diesel (12)');
    assert.ok(RETAIL_PRODUCTS['C'].includes(24), 'Electronics store sells smart phones (24)');
    assert.ok(RETAIL_PRODUCTS['C'].includes(25), 'Electronics store sells tablets (25)');
    assert.ok(RETAIL_PRODUCTS['C'].includes(26), 'Electronics store sells laptops (26)');
    assert.ok(RETAIL_PRODUCTS['2'].includes(53), 'Car dealership sells economy e-car (53)');
    assert.ok(RETAIL_PRODUCTS['2'].includes(55), 'Car dealership sells economy car (55)');
    assert.ok(RETAIL_PRODUCTS['H'].includes(60), 'Fashion store sells underwear (60)');
    assert.ok(RETAIL_PRODUCTS['H'].includes(62), 'Fashion store sells dress (62)');
    assert.ok(RETAIL_PRODUCTS['d'].includes(102), 'Hardware store sells bricks (102)');
    assert.ok(RETAIL_PRODUCTS['d'].includes(103), 'Hardware store sells cement (103)');
    assert.ok(RETAIL_PRODUCTS['d'].includes(108), 'Hardware store sells planks (108)');

    assert.ok(isRetailProductForBuilding('G', 3), 'isRetailProductForBuilding G-3 should be true');
    assert.ok(!isRetailProductForBuilding('G', 11), 'isRetailProductForBuilding G-11 (petrol) must be false');
    assert.ok(isRetailProductForBuilding('A', 11), 'isRetailProductForBuilding A-11 should be true');
    assert.ok(!isRetailProductForBuilding('A', 3), 'isRetailProductForBuilding A-3 (apples) must be false');
    console.log('  -> Canonical building mappings verified successfully.');

    // 1.2 Retail Duration Invariants with Demand/Saturation & Quality
    console.log('[2/4] Verifying Retail Duration calculations (demand/saturation & quality impact)...');
    const durBase = calculateRetailDuration(3, 100, 1, { quality: 0, saturation: 0.5 });
    const durHighSat = calculateRetailDuration(3, 100, 1, { quality: 0, saturation: 1.5 });
    const durLowSat = calculateRetailDuration(3, 100, 1, { quality: 0, saturation: 0.1 });
    const durHighQual = calculateRetailDuration(3, 100, 1, { quality: 5, saturation: 0.5 });
    const durSize2 = calculateRetailDuration(3, 100, 2, { quality: 0, saturation: 0.5 });

    console.log(`  -> Duration for 100 apples: Base=${durBase}s, HighSat(1.5)=${durHighSat}s, LowSat(0.1)=${durLowSat}s, Q5=${durHighQual}s, Size2=${durSize2}s`);
    assert.ok(durHighSat > durLowSat, 'Higher saturation (lower demand) must increase sales duration');
    assert.ok(durHighQual <= durBase, 'Higher quality should sell at least as fast or faster than Q0');
    assert.ok(durSize2 < durBase, 'Larger building size must reduce sales duration');

    // 1.3 Price Elasticity in Duration
    console.log('[3/4] Verifying Price Elasticity in Retail Duration...');
    const durCheap = calculateRetailDuration(3, 100, 1, { price: 2.0, quality: 0, saturation: 0.5 });
    const durExpensive = calculateRetailDuration(3, 100, 1, { price: 4.0, quality: 0, saturation: 0.5 });
    console.log(`  -> Duration @ $2.00: ${durCheap}s, Duration @ $4.00: ${durExpensive}s`);
    assert.ok(durExpensive > durCheap, 'Higher selling price must increase retail sales duration');

    // 1.4 Authoritative Pricing & Revenue Calculations
    console.log('[4/4] Verifying Authoritative Pricing & Revenue calculations...');
    const priceQ0 = getAuthoritativeRetailPrice(3, 0);
    const priceQ5 = getAuthoritativeRetailPrice(3, 5);
    assert.ok(priceQ5.maxPrice > priceQ0.maxPrice, 'Q5 max price must exceed Q0 max price');
    assert.ok(priceQ5.defaultPrice > priceQ0.defaultPrice, 'Q5 default price must exceed Q0 default price');

    const revNormal = calculateRetailRevenue(3, 100, 2.5, 0);
    assert.equal(revNormal.revenue, 250, '100 apples @ $2.50 = $250.00 revenue');
    assert.equal(revNormal.unitPrice, 2.5);

    // Over-maximum price validation
    assert.throws(() => {
      getAuthoritativeRetailPrice(3, 0, 99999);
    }, /exceeds server-authoritative maximum/);

    console.log('  -> All retail calculation invariants passed.\n');

    // =========================================================================
    // PART 2: Retail Sale Execution & Persistence (No active production queue)
    // =========================================================================
    console.log('--- PART 2: Retail Sale Flow & Queue Persistence Invariant ---');

    const user = await registerCompany('player1');
    const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

    // Find the starter Grocery store
    const buildingsRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers });
    const authData = (await buildingsRes.json()) as { authCompany: { money: number } };
    const initialMoney = authData.authCompany.money;

    const buildings = directDb.prepare('SELECT * FROM buildings WHERE company_id = ? AND kind = ?').all(user.companyId, 'G') as Array<{ id: number; kind: string; busy_until: string | null }>;
    assert.ok(buildings.length > 0, 'Starter grocery store must exist');
    const groceryStore = buildings[0];

    // Seed 1000 apples (kind: 3) in warehouse
    const nowIso = new Date().toISOString();
    directDb.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 3, 0, 1000, 0, 0, 0, 0, 1.5, ?)
      ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 1000
    `).run(user.companyId, nowIso);

    const whBefore = directDb.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0').get(user.companyId) as { amount: number };
    const stockBefore = whBefore.amount;
    console.log(`  -> Initial warehouse stock for Apples: ${stockBefore} units, Money: $${initialMoney}`);

    // Sell 200 apples at $2.50 via POST /api/v1/busy/:id/
    console.log('[1/4] Starting retail sale of 200 apples @ $2.50...');
    const sellRes = await fetch(`${BASE_URL}/api/v1/busy/${groceryStore.id}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 3,
        amount: 200,
        price: 2.5,
        estimatedSecondsToFinish: 120,
        forceQuality: 0
      })
    });
    assert.equal(sellRes.status, 200, `Retail sale should return 200 (got ${sellRes.status})`);
    const sellData = (await sellRes.json()) as { money: number };
    assert.equal(sellData.money, 500, 'Retail sale revenue should be 200 * $2.50 = $500');

    // Verify cash increased
    const authAfterSell = (await (await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers })).json()) as { authCompany: { money: number } };
    assert.equal(authAfterSell.authCompany.money, initialMoney + 500, 'Company cash must increase by exactly $500');

    // Verify warehouse stock decreased
    const whAfterSell = directDb.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0').get(user.companyId) as { amount: number };
    assert.equal(whAfterSell.amount, stockBefore - 200, 'Warehouse apples must be reduced by 200');

    // Verify cash_ledger record
    const ledgerRow = directDb.prepare("SELECT * FROM cash_ledger WHERE company_id = ? AND category = 's' ORDER BY id DESC LIMIT 1").get(user.companyId) as { amount: number; category: string } | undefined;
    assert.ok(ledgerRow, 'Cash ledger entry with category s must exist');
    assert.equal(ledgerRow.amount, 500, 'Cash ledger amount must be 500');

    // Verify building is busy
    const bldRow = directDb.prepare('SELECT * FROM buildings WHERE id = ?').get(groceryStore.id) as { id: number; busy_until: string | null } | undefined;
    assert.ok(bldRow?.busy_until, 'Building busy_until must be set');
    assert.ok(new Date(bldRow.busy_until).getTime() > Date.now(), 'busy_until must be in the future');

    // Verify order is persisted in retail_orders table
    const retailOrderRow = directDb.prepare('SELECT * FROM retail_orders WHERE company_id = ? AND building_id = ? ORDER BY id DESC LIMIT 1').get(user.companyId, groceryStore.id) as { id: number; resource_kind: number; units: number; unit_price: number } | undefined;
    assert.ok(retailOrderRow, 'Retail order row must exist in retail_orders');
    assert.equal(retailOrderRow.resource_kind, 3);
    assert.equal(retailOrderRow.units, 200);
    assert.equal(retailOrderRow.unit_price, 2.5);
    // CRITICAL: Verify production_queues does NOT have an active entry for this retail sale
    const activeProdQueues = directDb.prepare('SELECT * FROM production_queues WHERE company_id = ? AND building_id = ? AND resolved = 0').all(user.companyId, groceryStore.id);
    assert.equal(activeProdQueues.length, 0, 'Retail sale MUST NOT insert an active row into production_queues (Issue #91 fix)');
    console.log('  -> Retail sale succeeded, stock deducted, cash credited, and NO active production queue created.\n');

    // =========================================================================
    // PART 3: Verify Direct Retail Cash Duplicate Exploit is BLOCKED
    // =========================================================================
    console.log('--- PART 3: Verifying Direct Retail Cash Duplicate Exploit is BLOCKED ---');

    console.log('[1/3] Calling POST /api/v2/order/take/:id/ with building ID while busy...');
    const takeWhileBusy = await fetch(`${BASE_URL}/api/v2/order/take/${groceryStore.id}/`, {
      method: 'POST',
      headers,
      body: '{}'
    });
    // Must fail because there is no production queue item to collect
    assert.ok(
      takeWhileBusy.status === 404 || takeWhileBusy.status === 400,
      `take on retail building must return 404/400 (got ${takeWhileBusy.status})`
    );

    // Verify warehouse stock did NOT increase
    const whCheck1 = directDb.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0').get(user.companyId) as { amount: number };
    assert.equal(whCheck1.amount, stockBefore - 200, 'Warehouse stock must remain unchanged after failed take');

    console.log('[2/3] Fast-forwarding building and retail order timestamps to the past...');
    directDb.prepare("UPDATE buildings SET busy_until = datetime('now', '-10 seconds') WHERE id = ?").run(groceryStore.id);
    directDb.prepare("UPDATE retail_orders SET finished_at = datetime('now', '-10 seconds') WHERE id = ?").run(retailOrderRow.id);

    console.log('[3/3] Calling POST /api/v2/order/take/:id/ after retail finished_at elapsed...');
    const takeAfterFinish = await fetch(`${BASE_URL}/api/v2/order/take/${groceryStore.id}/`, {
      method: 'POST',
      headers,
      body: '{}'
    });
    assert.ok(
      takeAfterFinish.status === 404 || takeAfterFinish.status === 400,
      `take on finished retail building must still fail (no production queue) -> got ${takeAfterFinish.status}`
    );

    // Verify warehouse stock is STILL NOT duplicated
    const whCheck2 = directDb.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0').get(user.companyId) as { amount: number };
    assert.equal(whCheck2.amount, stockBefore - 200, 'Warehouse apples MUST NOT be refunded/duplicated back into warehouse');

    // Verify company money is unchanged (no double cash reward)
    const authCheck = (await (await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers })).json()) as { authCompany: { money: number } };
    assert.equal(authCheck.authCompany.money, initialMoney + 500, 'Company money must NOT be double-awarded');
    console.log('  -> Direct retail duplicate exploit is completely BLOCKED. Warehouse & Cash invariants intact.\n');

    // =========================================================================
    // PART 4: Additional Canonical Sales Buildings & Product Compatibility
    // =========================================================================
    console.log('--- PART 4: Testing Multiple Canonical Sales Buildings & Product Compatibility ---');

    // Give user extra building slots and funds for construction
    directDb.prepare('UPDATE companies SET money = 1000000, extra_building_slots = 50 WHERE company_id = ?').run(user.companyId);

    // Seed construction materials (Bricks #102, Reinforced concrete #101, Construction units #111)
    directDb.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 101, 0, 5000, 0, 0, 0, 0, 1.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 5000').run(user.companyId, nowIso);
    directDb.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 102, 0, 5000, 0, 0, 0, 0, 1.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 5000').run(user.companyId, nowIso);
    directDb.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 111, 0, 5000, 0, 0, 0, 0, 1.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 5000').run(user.companyId, nowIso);

    const testBuildings = [
      { kind: 'A', name: 'Gas station', validProduct: 11, invalidProduct: 3, pos: '20' },
      { kind: 'C', name: 'Electronics store', validProduct: 24, invalidProduct: 11, pos: '21' },
      { kind: '2', name: 'Car dealership', validProduct: 53, invalidProduct: 24, pos: '22' },
      { kind: 'H', name: 'Fashion store', validProduct: 62, invalidProduct: 53, pos: '23' },
      { kind: 'd', name: 'Hardware store', validProduct: 108, invalidProduct: 62, pos: '24' }
    ];

    for (const tb of testBuildings) {
      console.log(`[Testing ${tb.name} ('${tb.kind}')]`);

      // 1. Construct building
      const constr = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: tb.kind, position: tb.pos })
      });
      assert.equal(constr.status, 200, `Constructing ${tb.name} should return 200`);
      const constrData = (await constr.json()) as { building?: { id: number }; id?: number };
      const bldId = constrData.building?.id || constrData.id;
      assert.ok(bldId, `Building ID returned for ${tb.name}`);

      // Clear construction busy state
      directDb.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(bldId);

      // Seed valid product stock
      directDb.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, ?, 0, 100, 0, 0, 0, 0, 10.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 100').run(user.companyId, tb.validProduct, nowIso);

      // 2. Reject invalid retail product
      const invalidRes = await fetch(`${BASE_URL}/api/v2/sales-orders/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          building: bldId,
          resource: tb.invalidProduct,
          units: 5
        })
      });
      assert.equal(
        invalidRes.status,
        400,
        `${tb.name} must reject incompatible product #${tb.invalidProduct} with 400`
      );

      // 3. Accept valid retail product
      const validRes = await fetch(`${BASE_URL}/api/v2/sales-orders/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          building: bldId,
          resource: tb.validProduct,
          units: 5
        })
      });
      assert.equal(
        validRes.status,
        200,
        `${tb.name} must accept supported product #${tb.validProduct} with 200`
      );
      const validOrder = (await validRes.json()) as { id?: number; salesOrder?: { id: number } };
      assert.ok(validOrder.id || validOrder.salesOrder?.id, `Sales order created for ${tb.name}`);
      console.log(`  -> ${tb.name} ('${tb.kind}') verified: accepts #${tb.validProduct}, rejects #${tb.invalidProduct}.`);
    }

    console.log('\n================================================================');
    console.log(' All Issue #91 Verification Tests PASSED with 0 Errors!');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      try {
        rmSync(server.dataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

runTests().catch((err) => {
  console.error('\n[FATAL] Test failed with error:', err);
  process.exit(1);
});
