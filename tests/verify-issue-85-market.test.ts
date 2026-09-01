import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3730');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function isPortAvailable(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const tester = net.createServer()
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
    // Integration polling delay against spawned child process
    const { promise: sleepPromise, resolve: sleepResolve } = Promise.withResolvers<void>();
    setTimeout(sleepResolve, 150);
    await sleepPromise;
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

  const dataDir = path.resolve('data', `test-run-issue-85-${Date.now()}`);
  const nodeBinary = existsSync('/opt/magnate/.node22/bin/node')
    ? '/opt/magnate/.node22/bin/node'
    : process.execPath;

  const child = spawn(
    nodeBinary,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: '/home/ubuntu/phantom-backend-7x',
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
      process.stderr.write(`[server-${TEST_PORT}] ${str}`);
    }
  });

  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number; playerId: number }> {
  const email = `market_${label}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Market ${label} ${Date.now()}`
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
    authUser?: { id?: number; playerId?: number };
    player?: { id: number };
    authPlayer?: { playerId?: number; id?: number };
  };

  const companyId = authData.companyPublicInfo?.id || authData.authCompany?.companyId || authData.authCompany?.id || 0;
  const playerId = authData.authUser?.id || authData.authUser?.playerId || authData.player?.id || authData.authPlayer?.playerId || authData.authPlayer?.id || 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  assert.ok(playerId > 0, 'Valid playerId must be extracted');
  return { cookie, companyId, playerId };
}

async function runIssue85MarketVerification() {
  console.log('================================================================');
  console.log(' Starting Issue #85: Market Self-Trade Prevention, Cost Basis Preservation, and Realm Ticker');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');

  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('✔ Test server started successfully on port', TEST_PORT);

    const db = new DatabaseSync(server.dbPath);

    // -------------------------------------------------------------
    // Scenario 1: Self-Trading (Wash Trading) Prevention
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Self-Trading Prevention ---');
    const seller = await registerCompany('seller');
    const buyer = await registerCompany('buyer');
    console.log(`Registered Seller (Company ${seller.companyId}) and Buyer (Company ${buyer.companyId})`);

    // Clean existing seed market orders for resource 1 to ensure deterministic orderbook
    db.prepare('UPDATE market_orders SET active = 0 WHERE kind = 1').run();

    // Seller has seed stock of Power (kind: 1) and Transport (kind: 13)
    // Post a market order: 100 units of kind 1 @ $0.15
    const postOrderRes = await fetch(`${BASE_URL}/api/v2/market-order/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: seller.cookie
      },
      body: JSON.stringify({
        kind: 1,
        quantity: 100,
        price: 0.15,
        quality: 0
      })
    });
    assert.equal(postOrderRes.status, 200, 'Seller posting order should succeed with 200');
    const postOrderJson = await postOrderRes.json() as { sellOrder: { id: number; price: number; quantity: number } };
    const orderId = postOrderJson.sellOrder.id;
    console.log(`✔ Seller posted market order #${orderId} (100 units @ $0.15)`);

    // Seller attempts to purchase their own market order (Self-Trading)
    const selfTakeRes = await fetch(`${BASE_URL}/api/v2/market-order/take/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: seller.cookie
      },
      body: JSON.stringify({
        resource: 1,
        quantity: 50,
        maxPrice: 0.20
      })
    });

    assert.equal(selfTakeRes.status, 400, 'Self-trading should be rejected with 400 Bad Request');
    const selfTakeJson = await selfTakeRes.json() as { error: string; code: string };
    assert.equal(selfTakeJson.error, 'Cannot purchase your own market order', 'Error message must match');
    assert.equal(selfTakeJson.code, 'SELF_TRADE_PROHIBITED', 'Error code must be SELF_TRADE_PROHIBITED');
    console.log('✔ Self-trade rejected with 400 Bad Request and code SELF_TRADE_PROHIBITED');

    // Verify order was not modified
    const orderInDb = db.prepare('SELECT * FROM market_orders WHERE id = ?').get(orderId) as { quantity: number; active: number };
    assert.equal(orderInDb.quantity, 100, 'Order quantity should remain 100');
    assert.equal(orderInDb.active, 1, 'Order should still be active');

    // Legitimate Buyer purchases 40 units from Seller
    const buyerTakeRes = await fetch(`${BASE_URL}/api/v2/market-order/take/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: buyer.cookie
      },
      body: JSON.stringify({
        resource: 1,
        quantity: 40,
        maxPrice: 0.20
      })
    });
    assert.equal(buyerTakeRes.status, 200, 'Buyer purchasing from seller should return 200 OK');
    const buyerTakeJson = await buyerTakeRes.json() as { amountBought: number; moneyDelta: number };
    assert.equal(buyerTakeJson.amountBought, 40, 'Buyer bought 40 units');
    console.log('✔ Legitimate buyer successfully purchased 40 units from seller');

    // Seller tries again to buy remaining 60 units -> still rejected with SELF_TRADE_PROHIBITED
    const selfTakeRes2 = await fetch(`${BASE_URL}/api/v2/market-order/take/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: seller.cookie
      },
      body: JSON.stringify({
        resource: 1,
        quantity: 60,
        maxPrice: 0.20
      })
    });
    assert.equal(selfTakeRes2.status, 400, 'Self-trade still rejected with 400');
    const selfTakeJson2 = await selfTakeRes2.json() as { error: string; code: string };
    assert.equal(selfTakeJson2.code, 'SELF_TRADE_PROHIBITED');
    console.log('✔ Second self-trade attempt on remaining quantity rejected with SELF_TRADE_PROHIBITED');

    // Scenario 1b: Multi-order transaction rollback on self-trade
    // Third-party seller posts 20 units @ $0.10
    // Seller (buyer in this test) posts 20 units @ $0.12
    // If seller requests 30 units (would take 20 from third-party + 10 from self):
    // Entire transaction must rollback atomically!
    console.log('\n--- Scenario 1b: Atomic Rollback on Multi-Order Self-Trade ---');
    const thirdParty = await registerCompany('third_party');
    db.prepare('UPDATE market_orders SET active = 0 WHERE kind = 2').run();

    // Third party posts Water (kind 2) 20 units @ $0.10
    const tpPostRes = await fetch(`${BASE_URL}/api/v2/market-order/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: thirdParty.cookie },
      body: JSON.stringify({ kind: 2, quantity: 20, price: 0.10, quality: 0 })
    });
    assert.equal(tpPostRes.status, 200);
    const tpPostJson = await tpPostRes.json() as { sellOrder: { id: number } };
    const tpOrderId = tpPostJson.sellOrder.id;

    // Seller posts Water (kind 2) 20 units @ $0.12
    const sellerPostRes = await fetch(`${BASE_URL}/api/v2/market-order/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: seller.cookie },
      body: JSON.stringify({ kind: 2, quantity: 20, price: 0.12, quality: 0 })
    });
    assert.equal(sellerPostRes.status, 200);
    const sellerPostJson = await sellerPostRes.json() as { sellOrder: { id: number } };
    const sellerWaterOrderId = sellerPostJson.sellOrder.id;

    // Seller tries to take 30 units (hits third party first, then hits own order)
    const multiTakeRes = await fetch(`${BASE_URL}/api/v2/market-order/take/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: seller.cookie },
      body: JSON.stringify({ resource: 2, quantity: 30, maxPrice: 0.20 })
    });
    assert.equal(multiTakeRes.status, 400);
    const multiTakeJson = await multiTakeRes.json() as { error: string; code: string };
    assert.equal(multiTakeJson.code, 'SELF_TRADE_PROHIBITED');

    // Verify third-party order was NOT partially consumed (atomic rollback)
    const tpOrderCheck = db.prepare('SELECT quantity, active FROM market_orders WHERE id = ?').get(tpOrderId) as { quantity: number; active: number };
    assert.equal(tpOrderCheck.quantity, 20, 'Third party order quantity must remain 20 due to rollback');
    assert.equal(tpOrderCheck.active, 1, 'Third party order must remain active');
    console.log('✔ Multi-order transaction rolled back atomically when self-trade encountered');

    // Scenario 1c: Same Player multi-account wash trade prevention
    console.log('\n--- Scenario 1c: Same-Player Multi-Company Wash Trade Prevention ---');
    // Create another company for the same player (seller.playerId)
    const secondCompId = Math.floor(5000000 + Math.random() * 4000000);
    db.prepare(`
      INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
      VALUES (?, ?, 'Sister Company', 50000, 100, 5, 'BBB', 0, 0, '', 'old', '', ?)
    `).run(secondCompId, seller.playerId, new Date().toISOString());

    // Generate valid session token for sister company
    const token = `sess_00112233445566778899aabbccddeeff`;
    db.prepare(`
      INSERT INTO sessions (session_token, player_id, active_company_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, seller.playerId, secondCompId, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
    const sisterCookie = `sessionid=${token}`;
    // Since seller has order in kind 2 and they share player_id, when sister tries to buy, it is rejected
    // Note: third-party order at $0.10 will be taken first, so if sister takes 25 units:
    const sisterMultiTakeRes = await fetch(`${BASE_URL}/api/v2/market-order/take/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sisterCookie },
      body: JSON.stringify({ resource: 2, quantity: 25, maxPrice: 0.20 })
    });
    assert.equal(sisterMultiTakeRes.status, 400);
    const sisterJson = await sisterMultiTakeRes.json() as { code: string };
    assert.equal(sisterJson.code, 'SELF_TRADE_PROHIBITED');
    console.log('✔ Same-player multi-company trade rejected with SELF_TRADE_PROHIBITED');
    // -------------------------------------------------------------
    // Scenario 2: Escrow Cost Basis Preservation on Order Cancel
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Escrow Cost Basis Preservation on Order Cancel ---');
    const compCostTest = await registerCompany('cost_preservation');

    // Setup an inventory item in warehouse with specific non-default cost basis
    // Resource kind: 3 (Apples), Quality: 1
    const testKind = 3;
    const testQuality = 1;
    const initialAmount = 200;
    const expectedWorkers = 3.25;
    const expectedAdmin = 0.85;
    const expectedMat1 = 1.40;
    const expectedMat2 = 0.60;
    const expectedMarket = 5.75;

    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      compCostTest.companyId,
      testKind,
      testQuality,
      initialAmount,
      expectedWorkers,
      expectedAdmin,
      expectedMat1,
      expectedMat2,
      expectedMarket,
      new Date().toISOString()
    );

    console.log(`Inserted 200 units of resource #${testKind} (Q${testQuality}) with cost_market: ${expectedMarket}, cost_workers: ${expectedWorkers}`);

    // Post market order for 150 units @ $12.00
    const postEscrowRes = await fetch(`${BASE_URL}/api/v2/market-order/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: compCostTest.cookie
      },
      body: JSON.stringify({
        kind: testKind,
        quality: testQuality,
        quantity: 150,
        price: 12.0
      })
    });
    assert.equal(postEscrowRes.status, 200, 'Posting escrow order should succeed');
    const postEscrowJson = await postEscrowRes.json() as { sellOrder: { id: number } };
    const escrowOrderId = postEscrowJson.sellOrder.id;

    // Verify market_orders table recorded the unit cost basis
    const orderCostRow = db.prepare('SELECT * FROM market_orders WHERE id = ?').get(escrowOrderId) as {
      cost_workers: number;
      cost_admin: number;
      cost_material1: number;
      cost_material2: number;
      cost_market: number;
    };
    assert.ok(orderCostRow, 'Market order row must exist');
    assert.equal(orderCostRow.cost_market, expectedMarket, 'Escrowed order must record original cost_market');
    assert.equal(orderCostRow.cost_workers, expectedWorkers, 'Escrowed order must record original cost_workers');
    assert.equal(orderCostRow.cost_admin, expectedAdmin, 'Escrowed order must record original cost_admin');
    assert.equal(orderCostRow.cost_material1, expectedMat1, 'Escrowed order must record original cost_material1');
    assert.equal(orderCostRow.cost_material2, expectedMat2, 'Escrowed order must record original cost_material2');
    console.log('✔ market_orders table correctly recorded unit cost basis during postMarketOrder');

    // Verify remaining inventory in warehouse
    const remainingWh = db.prepare('SELECT amount, cost_market FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?')
      .get(compCostTest.companyId, testKind, testQuality) as { amount: number; cost_market: number };
    assert.equal(remainingWh.amount, 50, 'Warehouse should have 50 units remaining');
    assert.equal(remainingWh.cost_market, expectedMarket, 'Remaining warehouse stock keeps cost basis');

    // Cancel the market order: DELETE /api/v2/market-order/:orderId/
    const cancelRes = await fetch(`${BASE_URL}/api/v2/market-order/${escrowOrderId}/`, {
      method: 'DELETE',
      headers: {
        Cookie: compCostTest.cookie
      }
    });
    assert.equal(cancelRes.status, 200, 'Cancel market order should return 200');
    console.log(`✔ Cancelled market order #${escrowOrderId}`);

    // Verify warehouse item has 200 units refunded and cost basis preserved (NOT reset to 1.0)
    const refundedWh = db.prepare('SELECT amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?')
      .get(compCostTest.companyId, testKind, testQuality) as {
        amount: number;
        cost_workers: number;
        cost_admin: number;
        cost_material1: number;
        cost_material2: number;
        cost_market: number;
      };
    assert.equal(refundedWh.amount, 200, 'Warehouse amount must be restored to 200 units');
    assert.equal(refundedWh.cost_market, expectedMarket, `cost_market must be preserved at ${expectedMarket}, not reset to 1.0`);
    assert.equal(refundedWh.cost_workers, expectedWorkers, `cost_workers must be preserved at ${expectedWorkers}`);
    assert.equal(refundedWh.cost_admin, expectedAdmin, `cost_admin must be preserved at ${expectedAdmin}`);
    assert.equal(refundedWh.cost_material1, expectedMat1, `cost_material1 must be preserved at ${expectedMat1}`);
    assert.equal(refundedWh.cost_material2, expectedMat2, `cost_material2 must be preserved at ${expectedMat2}`);
    console.log('✔ Warehouse refunded stock has original cost basis completely preserved');

    // -------------------------------------------------------------
    // Scenario 3: Realm Filter on Market Ticker
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Realm Filter on Market Ticker ---');

    // Test GET /api/v2/market-ticker/ (default realm 0)
    const tickerV2Default = await fetch(`${BASE_URL}/api/v2/market-ticker/`);
    assert.equal(tickerV2Default.status, 200, '/api/v2/market-ticker/ should return 200');
    const tickerV2DefaultJson = await tickerV2Default.json() as Array<{ kind: number; realmId: number; price: number }>;
    assert.ok(Array.isArray(tickerV2DefaultJson), 'Ticker must be an array');
    assert.ok(tickerV2DefaultJson.length > 0, 'Ticker array must not be empty');
    assert.equal(tickerV2DefaultJson[0].realmId, 0, 'Default ticker should have realmId 0');
    console.log(`✔ /api/v2/market-ticker/ returned ${tickerV2DefaultJson.length} resources with realmId 0`);

    // Test GET /api/v2/market-ticker/0/
    const tickerV2Realm0 = await fetch(`${BASE_URL}/api/v2/market-ticker/0/`);
    assert.equal(tickerV2Realm0.status, 200, '/api/v2/market-ticker/0/ should return 200');
    const tickerV2Realm0Json = await tickerV2Realm0.json() as Array<{ kind: number; realmId: number; price: number }>;
    assert.equal(tickerV2Realm0Json[0].realmId, 0, 'Ticker for realm 0 must have realmId 0');
    console.log('✔ /api/v2/market-ticker/0/ correctly returned realmId 0 data');

    // Test GET /api/v2/market-ticker/1/
    const tickerV2Realm1 = await fetch(`${BASE_URL}/api/v2/market-ticker/1/`);
    assert.equal(tickerV2Realm1.status, 200, '/api/v2/market-ticker/1/ should return 200');
    const tickerV2Realm1Json = await tickerV2Realm1.json() as Array<{ kind: number; realmId: number; price: number }>;
    assert.equal(tickerV2Realm1Json[0].realmId, 1, 'Ticker for realm 1 must have realmId 1');
    console.log('✔ /api/v2/market-ticker/1/ correctly returned realmId 1 data');

    // Test GET /api/v3/market-ticker/0/
    const tickerV3Realm0 = await fetch(`${BASE_URL}/api/v3/market-ticker/0/`);
    assert.equal(tickerV3Realm0.status, 200, '/api/v3/market-ticker/0/ should return 200');
    const tickerV3Realm0Json = await tickerV3Realm0.json() as Array<{ kind: number; realmId: number; price: number }>;
    assert.equal(tickerV3Realm0Json[0].realmId, 0, 'Ticker v3 for realm 0 must have realmId 0');
    console.log('✔ /api/v3/market-ticker/0/ correctly returned realmId 0 data');

    // Test GET /api/v3/market-ticker/1/
    const tickerV3Realm1 = await fetch(`${BASE_URL}/api/v3/market-ticker/1/`);
    assert.equal(tickerV3Realm1.status, 200, '/api/v3/market-ticker/1/ should return 200');
    const tickerV3Realm1Json = await tickerV3Realm1.json() as Array<{ kind: number; realmId: number; price: number }>;
    assert.equal(tickerV3Realm1Json[0].realmId, 1, 'Ticker v3 for realm 1 must have realmId 1');
    console.log('✔ /api/v3/market-ticker/1/ correctly returned realmId 1 data');

    // Verify realm-specific price isolation in market ticker
    // Clear kind 66 orders
    db.prepare('UPDATE market_orders SET active = 0 WHERE kind = 66').run();
    const compRealm0Id = Math.floor(6000000 + Math.random() * 1000000);
    const compRealm1Id = Math.floor(7000000 + Math.random() * 1000000);
    db.prepare(`
      INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
      VALUES (?, 111111, 'Realm 0 Co', 50000, 100, 5, 'BBB', 0, 0, '', 'old', '', ?),
             (?, 222222, 'Realm 1 Co', 50000, 100, 5, 'BBB', 0, 1, '', 'old', '', ?)
    `).run(compRealm0Id, new Date().toISOString(), compRealm1Id, new Date().toISOString());

    // Realm 0 company posts order at $0.45
    db.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
      VALUES (?, 66, 0, 100, 0.45, 1, ?, 1)
    `).run(compRealm0Id, new Date().toISOString());

    // Realm 1 company posts order at $0.85
    db.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
      VALUES (?, 66, 0, 100, 0.85, 1, ?, 1)
    `).run(compRealm1Id, new Date().toISOString());

    // Check ticker for realm 0 has price 0.45 for resource 66
    const resTicker0 = await fetch(`${BASE_URL}/api/v3/market-ticker/0/`);
    const ticker0Json = await resTicker0.json() as Array<{ kind: number; price: number }>;
    const item66Realm0 = ticker0Json.find(x => x.kind === 66);
    assert.ok(item66Realm0, 'Resource 66 must exist in ticker');
    assert.equal(item66Realm0.price, 0.45, 'Realm 0 ticker should show realm 0 price ($0.45)');

    // Check ticker for realm 1 has price 0.85 for resource 66
    const resTicker1 = await fetch(`${BASE_URL}/api/v3/market-ticker/1/`);
    const ticker1Json = await resTicker1.json() as Array<{ kind: number; price: number }>;
    const item66Realm1 = ticker1Json.find(x => x.kind === 66);
    assert.ok(item66Realm1, 'Resource 66 must exist in ticker');
    assert.equal(item66Realm1.price, 0.85, 'Realm 1 ticker should show realm 1 price ($0.85)');
    console.log('✔ Market ticker prices correctly reflect realm-specific lowest orders');

    console.log('\n================================================================');
    console.log(' ALL ISSUE #85 MARKET REGRESSION CHECKS PASSED (0 ERRORS)');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      try {
        rmSync(server.dataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

runIssue85MarketVerification().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
