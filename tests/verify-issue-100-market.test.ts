import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

// Issue #100 — Market robustness regression suite:
//   1. VWAP reference price tracker: every fill lands in the market_trades
//      ledger and GET /api/v2/market/reference-prices/:realm/ returns the
//      daily VWAP (Σ(price×amount)/Σ(amount)) per resource+quality.
//   2. Tick size grid: order posting rejects off-grid prices with 400
//      { error, code: 'PRICE_TICK_INVALID' } per formulas_market.md §2.
//   3. Exchange fee semantics: no fee at posting, no fee on cancellation;
//      the 4% fee (ceil(amount × price × 0.04)) is deducted from the
//      SELLER's proceeds at fill time.

const TEST_PORT = Number(process.env.PORT || '3890');
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
      if (res.ok) return;
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
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

  const dataDir = path.resolve('data', `test-run-issue-100-${Date.now()}`);
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
  const email = `market100_${label}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Market100 ${label} ${Date.now()}`
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

function companyMoney(db: DatabaseSync, companyId: number): number {
  const row = db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number };
  return Number(row.money);
}

interface PostResult {
  status: number;
  body: { sellOrder?: { id: number }; money?: number | null; error?: string; code?: string };
}

async function postOrder(cookie: string, body: { kind: number; quantity: number; price: number; quality?: number }): Promise<PostResult> {
  const res = await fetch(`${BASE_URL}/api/v2/market-order/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as PostResult['body'] };
}

async function takeOrder(cookie: string, body: { resource: number; quantity: number; quality?: number; maxPrice?: number }): Promise<{ status: number; body: { amountBought?: number; moneyDelta?: number; error?: string; code?: string } }> {
  const res = await fetch(`${BASE_URL}/api/v2/market-order/take/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as { amountBought?: number; moneyDelta?: number; error?: string; code?: string } };
}

async function runIssue100MarketVerification() {
  console.log('================================================================');
  console.log(' Starting Issue #100: Market VWAP Reference Prices, Tick Grid, and 4% Seller-Side Fee');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');

  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('✔ Test server started successfully on port', TEST_PORT);

    const db = new DatabaseSync(server.dbPath);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // -------------------------------------------------------------
    // Scenario 1: No posting-time fee; 4% seller-side fee on fill
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Exchange fee charged from seller proceeds at fill time only ---');
    const sellerA = await registerCompany('sellerA');
    const buyerB = await registerCompany('buyerB');
    console.log(`Registered Seller A (Company ${sellerA.companyId}) and Buyer B (Company ${buyerB.companyId})`);

    // Deterministic orderbook: deactivate all seeded kind 2 (water) orders
    db.prepare('UPDATE market_orders SET active = 0 WHERE kind = 2').run();

    const sellerMoney0 = companyMoney(db, sellerA.companyId);

    // Seller posts 40 units of water (kind 2) @ $2.50 (on-grid: 2-4.99 → 0.05 tick)
    const post1 = await postOrder(sellerA.cookie, { kind: 2, quantity: 40, price: 2.5, quality: 0 });
    assert.equal(post1.status, 200, 'Posting order should succeed with 200');
    assert.ok(post1.body.sellOrder, 'Posted order returned');
    const orderAId = post1.body.sellOrder!.id;
    console.log(`✔ Seller A posted market order #${orderAId} (40 units @ $2.50)`);

    // No fee at posting: company balance untouched, response money == balance
    assert.equal(companyMoney(db, sellerA.companyId), sellerMoney0, 'Posting must NOT charge any fee');
    assert.equal(Number(post1.body.money), sellerMoney0, 'Post response money must equal the balance (no fee)');
    const orderARow = db.prepare('SELECT fees FROM market_orders WHERE id = ?').get(orderAId) as { fees: number };
    assert.equal(Number(orderARow.fees), 0, 'Order fees must be 0 at posting time');
    console.log('✔ No fee charged at posting time');

    // Buyer takes all 40 units: pays 40 × 2.50 = $100
    const take1 = await takeOrder(buyerB.cookie, { resource: 2, quantity: 40, maxPrice: 3 });
    assert.equal(take1.status, 200, 'Buyer take should succeed with 200');
    assert.equal(take1.body.amountBought, 40, 'Buyer bought 40 units');
    assert.ok(Math.abs(Number(take1.body.moneyDelta) + 100) < 1e-6, `Buyer moneyDelta must be -100, got ${take1.body.moneyDelta}`);
    assert.equal(companyMoney(db, buyerB.companyId), 100000 - 100, 'Buyer pays the full amount × price');

    // Seller proceeds = 100 - ceil(100 × 0.04) = 100 - 4 = 96
    assert.equal(companyMoney(db, sellerA.companyId), sellerMoney0 + 96, 'Seller proceeds must be cost minus the 4% fee (ceil)');
    const feesAfterFill = (db.prepare('SELECT fees FROM market_orders WHERE id = ?').get(orderAId) as { fees: number }).fees;
    assert.equal(Number(feesAfterFill), 4, 'Order fees must record the 4 charged on the fill');
    console.log('✔ 4% fee (ceil($100 × 0.04) = $4) deducted from seller proceeds at fill');

    // Fill recorded in the trade ledger
    const tradeRow = db.prepare(`
      SELECT * FROM market_trades
      WHERE seller_id = ? AND kind = 2 AND quality = 0 AND price = 2.5 AND amount = 40
    `).get(sellerA.companyId) as {
      kind: number; quality: number; price: number; amount: number; fee: number;
      buyer_id: number; seller_id: number; trade_date: string; traded_at: string;
    };
    assert.ok(tradeRow, 'Fill must be recorded in market_trades ledger');
    assert.equal(Number(tradeRow.fee), 4, 'Ledger fill must record the 4 fee');
    assert.equal(tradeRow.buyer_id, buyerB.companyId, 'Ledger fill must record the buyer');
    assert.equal(tradeRow.trade_date, today, 'Ledger fill must carry today\'s UTC date key');
    console.log('✔ Fill recorded in market_trades ledger (kind, quality, price, amount, fee, parties, date)');

    // -------------------------------------------------------------
    // Scenario 2: Daily VWAP computed from the ledger
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: VWAP reference prices from the trade ledger ---');
    const sellerC = await registerCompany('sellerC');
    const sellerD = await registerCompany('sellerD');

    // Two more fills on kind 2 q0 with UNEQUAL amounts so the test proves the
    // VWAP is amount-weighted: 40 @ $0.20 and 20 @ $0.50.
    const post2 = await postOrder(sellerC.cookie, { kind: 2, quantity: 40, price: 0.2, quality: 0 });
    assert.equal(post2.status, 200, 'Seller C posting @0.20 should succeed (on-grid 0.001/0.005 band)');
    const post3 = await postOrder(sellerD.cookie, { kind: 2, quantity: 20, price: 0.5, quality: 0 });
    assert.equal(post3.status, 200, 'Seller D posting @0.50 should succeed (on-grid 0.005 band)');
    const orderCId = post2.body.sellOrder!.id;
    const orderDId = post3.body.sellOrder!.id;

    const take2 = await takeOrder(buyerB.cookie, { resource: 2, quantity: 60, maxPrice: 1 });
    assert.equal(take2.status, 200, 'Buyer take across both orders should succeed');
    assert.equal(take2.body.amountBought, 60, 'Buyer bought 60 units across two fills');

    // Fee per fill: ceil(40×0.2×0.04) = ceil(0.32) = 1 and ceil(20×0.5×0.04) = ceil(0.4) = 1
    assert.equal(companyMoney(db, sellerC.companyId), 100000 + 8 - 1, 'Seller C proceeds = 8 - 1');
    assert.equal(companyMoney(db, sellerD.companyId), 100000 + 10 - 1, 'Seller D proceeds = 10 - 1');
    const feesC = Number((db.prepare('SELECT fees FROM market_orders WHERE id = ?').get(orderCId) as { fees: number }).fees);
    const feesD = Number((db.prepare('SELECT fees FROM market_orders WHERE id = ?').get(orderDId) as { fees: number }).fees);
    assert.equal(feesC, 1, 'Seller C order records its fill fee');
    assert.equal(feesD, 1, 'Seller D order records its fill fee');
    console.log('✔ Per-fill fees (ceil each) deducted from each seller independently');

    // Three API fills on kind 2 q0 today so far: 40@2.5, 40@0.2, 20@0.5
    const kind2Count = (db.prepare('SELECT COUNT(*) AS c FROM market_trades WHERE kind = 2 AND quality = 0 AND trade_date = ?').get(today) as { c: number }).c;
    assert.equal(kind2Count, 3, 'Every fill must be recorded exactly once in the ledger');

    // Synthetic YESTERDAY trade: if the implementation ignored daily grouping
    // the VWAP would blend to (118 + 10) / 200 = 0.64 instead of 1.18.
    db.prepare(`
      INSERT INTO market_trades (kind, quality, price, amount, fee, buyer_id, seller_id, trade_date, traded_at)
      VALUES (2, 0, 0.1, 100, 0, NULL, NULL, ?, ?)
    `).run(yesterday, new Date(Date.now() - 86400000).toISOString());

    const refRes = await fetch(`${BASE_URL}/api/v2/market/reference-prices/0/`);
    assert.equal(refRes.status, 200, 'GET /api/v2/market/reference-prices/0/ should return 200');
    const refBody = (await refRes.json()) as { referencePrices: Array<{ kind: number; quality: number; vwap: number; date: string }> };
    assert.ok(Array.isArray(refBody.referencePrices), 'referencePrices must be an array');
    assert.ok(refBody.referencePrices.length >= 1, 'referencePrices must contain the traded resource');

    const water = refBody.referencePrices.find(e => e.kind === 2 && e.quality === 0);
    assert.ok(water, 'Water (kind 2, quality 0) must have a reference price');
    // Daily VWAP = (2.5×40 + 0.2×40 + 0.5×20) / (40 + 40 + 20) = 118 / 100 = 1.18
    assert.ok(Math.abs(water!.vwap - 1.18) < 1e-6, `VWAP must be 1.18 (amount-weighted, latest day), got ${water!.vwap}`);
    assert.equal(water!.date, today, 'Reference price date must be the latest trading day');
    for (const entry of refBody.referencePrices) {
      assert.ok(Number.isFinite(entry.vwap) && entry.vwap > 0, `Every reference price must be a positive finite number (${entry.kind})`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(entry.date), 'Every reference price must carry a YYYY-MM-DD date');
    }
    console.log('✔ GET /api/v2/market/reference-prices/0/ returns daily VWAP 1.18 for kind 2 q0 (amount-weighted, latest day only)');

    // Route shape robustness: without the realm segment
    const refResNoRealm = await fetch(`${BASE_URL}/api/v2/market/reference-prices/`);
    assert.equal(refResNoRealm.status, 200, 'GET /api/v2/market/reference-prices/ should also return 200');
    const refBodyNoRealm = (await refResNoRealm.json()) as { referencePrices: unknown[] };
    assert.ok(Array.isArray(refBodyNoRealm.referencePrices), 'Realm-less reference prices call must return the same shape');
    console.log('✔ Reference prices endpoint works with and without the realm segment');

    // -------------------------------------------------------------
    // Scenario 3: No fee on cancellation
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Cancellation is free ---');
    const sellerE = await registerCompany('sellerE');
    const sellerEMoney0 = companyMoney(db, sellerE.companyId);

    const post4 = await postOrder(sellerE.cookie, { kind: 4, quantity: 10, price: 1.25, quality: 0 });
    assert.equal(post4.status, 200, 'Seller E posting @1.25 should succeed (on-grid 0.01 band)');
    const orderEId = post4.body.sellOrder!.id;
    assert.equal(companyMoney(db, sellerE.companyId), sellerEMoney0, 'Posting must not change the balance');

    const cancelRes = await fetch(`${BASE_URL}/api/v2/market-order/${orderEId}/`, {
      method: 'DELETE',
      headers: { Cookie: sellerE.cookie }
    });
    assert.equal(cancelRes.status, 200, 'Cancel should return 200');
    assert.equal(companyMoney(db, sellerE.companyId), sellerEMoney0, 'Cancellation must NOT charge any fee');

    const kind4Trades = (db.prepare('SELECT COUNT(*) AS c FROM market_trades WHERE kind = 4').get() as { c: number }).c;
    assert.equal(kind4Trades, 0, 'A cancelled order must never appear in the trade ledger');
    const wh4 = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 4 AND quality = 0').get(sellerE.companyId) as { amount: number };
    assert.equal(Number(wh4.amount), 5000, 'Cancelled inventory must be fully refunded');
    console.log('✔ Cancellation charged no fee and left no ledger trace');

    // -------------------------------------------------------------
    // Scenario 4: Tick size grid enforcement (formulas_market.md §2)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Tick size grid on order posting ---');
    const sellerF = await registerCompany('sellerF');

    // One valid on-grid price per tick band
    const validPrices = [0.125, 0.5, 1.25, 2.5, 4.95, 5.1, 19.9, 20.25, 49.75, 50.5, 99.5, 150, 250, 750, 1500, 5025, 10500, 20500];
    for (const price of validPrices) {
      const post = await postOrder(sellerF.cookie, { kind: 1, quantity: 1, price, quality: 0 });
      assert.equal(post.status, 200, `On-grid price ${price} must be accepted with 200`);
    }
    console.log(`✔ All ${validPrices.length} on-grid prices accepted (one per tick band)`);

    // Off-grid prices must be rejected with 400 + PRICE_TICK_INVALID
    const whBefore = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 1 AND quality = 0').get(sellerF.companyId) as { amount: number };
    const invalidPrices = [0.1234, 0.996, 1.234, 2.52, 5.15, 25.1, 75.25, 150.5, 333, 999.99, 1505, 5555, 12345, 23456];
    for (const price of invalidPrices) {
      const post = await postOrder(sellerF.cookie, { kind: 1, quantity: 1, price, quality: 0 });
      assert.equal(post.status, 400, `Off-grid price ${price} must be rejected with 400`);
      assert.equal(post.body.code, 'PRICE_TICK_INVALID', `Off-grid price ${price} must return code PRICE_TICK_INVALID`);
      assert.ok(post.body.error && post.body.error.length > 0, `Off-grid rejection for ${price} must carry an error message`);
    }
    const whAfter = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 1 AND quality = 0').get(sellerF.companyId) as { amount: number };
    assert.equal(Number(whAfter.amount), Number(whBefore.amount), 'Rejected postings must not consume inventory');
    assert.equal(companyMoney(db, sellerF.companyId), 100000, 'Rejected postings must not charge money');

    const activeCount = (db.prepare('SELECT COUNT(*) AS c FROM market_orders WHERE seller_id = ? AND active = 1').get(sellerF.companyId) as { c: number }).c;
    assert.equal(activeCount, validPrices.length, 'Exactly the on-grid orders must be active');
    console.log(`✔ All ${invalidPrices.length} off-grid prices rejected with 400 PRICE_TICK_INVALID, no side effects`);

    // -------------------------------------------------------------
    // Scenario 5: Market limits expose the 4% fee
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Market limits fee percentage ---');
    const limitsRes = await fetch(`${BASE_URL}/api/v2/market/limits/0/2/0/`);
    assert.equal(limitsRes.status, 200, 'Market limits endpoint should return 200');
    const limitsBody = (await limitsRes.json()) as { feePercentage: number };
    assert.equal(limitsBody.feePercentage, 0.04, 'Market limits must report the 4% exchange fee');
    console.log('✔ Market limits report feePercentage 0.04');

    console.log('\n================================================================');
    console.log(' ALL ISSUE #100 MARKET REGRESSION CHECKS PASSED (0 ERRORS)');
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

runIssue100MarketVerification().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
