import assert from 'node:assert/strict';
import { withTestServer } from './support/test-server.ts';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';
import { handleMarketRoutes } from '../server/routes/market-routes.ts';
import { handleContractRoutes } from '../server/routes/contract-routes.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface DispatchResult {
  status: number;
  body: Record<string, unknown>;
}

async function dispatchMarket(pathname: string, method: string, companyId: number, body: Record<string, unknown>): Promise<DispatchResult> {
  const req = {
    url: pathname,
    method,
    headers: { 'content-type': 'application/json' }
  } as unknown as IncomingMessage;
  setPreparsedBody(req, body);

  let status = 200;
  let responseData = '';
  const res = {
    statusCode: 200,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(code: number) { status = code; },
    end(chunk?: unknown) { if (chunk) responseData = String(chunk); }
  } as unknown as ServerResponse;

  const handled = await handleMarketRoutes(req, res, pathname, method, companyId);
  assert.ok(handled, `route must be handled: ${pathname}`);
  return { status, body: responseData ? (JSON.parse(responseData) as Record<string, unknown>) : {} };
}

async function dispatchContract(pathname: string, method: string, companyId: number): Promise<DispatchResult> {
  const req = {
    url: pathname,
    method,
    headers: {}
  } as unknown as IncomingMessage;

  let status = 200;
  let responseData = '';
  const res = {
    statusCode: 200,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(code: number) { status = code; },
    end(chunk?: unknown) { if (chunk) responseData = String(chunk); }
  } as unknown as ServerResponse;

  const handled = await handleContractRoutes(req, res, pathname, method, companyId);
  assert.ok(handled, `route must be handled: ${pathname}`);
  return { status, body: responseData ? (JSON.parse(responseData) as Record<string, unknown>) : {} };
}

db.prepare("DELETE FROM companies WHERE name LIKE 'Issue 193%'").run();

// Sender setup
const sender = await FixtureService.applyScenario({
  companyName: 'Issue 193 Sender Co',
  money: 500_000,
  level: 30
});
// Recipient setup
const recipient = await FixtureService.applyScenario({
  companyName: 'Issue 193 Recipient Co',
  money: 500_000,
  level: 30
});

// Seed power (kind 1) to sender warehouse
warehouseRepository.addResource(sender.companyId, 1, 0, 500);
const startStock = warehouseRepository.findByCompanyAndResource(sender.companyId, 1, 0)?.amount ?? 0;
assert.ok(startStock >= 500);

// 1. Successful contract submission via POST /api/v2/market-order/ with contractTo name
const successRes = await dispatchMarket('/api/v2/market-order/', 'POST', sender.companyId, {
  kind: 1,
  quality: 0,
  quantity: 200,
  price: 0.15,
  contractTo: 'Issue 193 Recipient Co'
});

assert.equal(successRes.status, 200, `Contract send must return 200, got: ${JSON.stringify(successRes.body)}`);
assert.ok(successRes.body.contract, 'Response must contain contract field for frontend Redux action');
const contract = successRes.body.contract as Record<string, unknown>;
assert.equal(contract.kind, 1);
assert.equal(contract.amount, 200);
assert.equal(contract.quantity, 200, 'contract.quantity must be populated for frontend delta calculations');
assert.equal(contract.price, 0.15);
assert.equal(contract.total, 30);
assert.equal(contract.status, 'pending');

// Inventory deducted atomically
const stockAfter = warehouseRepository.findByCompanyAndResource(sender.companyId, 1, 0)?.amount ?? 0;
assert.equal(stockAfter, startStock - 200);

// 2. Both parties see the contract
const outgoingRes = await dispatchContract('/api/v2/contracts-outgoing/', 'GET', sender.companyId);
assert.equal(outgoingRes.status, 200);
const outgoing = outgoingRes.body as Array<{ id: number; kind: number }>;
assert.ok(outgoing.some(c => c.id === contract.id && c.kind === 1));

const incomingRes = await dispatchContract('/api/v2/contracts-incoming/', 'GET', recipient.companyId);
assert.equal(incomingRes.status, 200);
const incoming = (incomingRes.body.incomingContracts as Array<{ id: number; kind: number }>);
assert.ok(incoming.some(c => c.id === contract.id && c.kind === 1));

// 3. Insufficient inventory: rolls back without deducting stock
const failRes = await dispatchMarket('/api/v2/market-order/', 'POST', sender.companyId, {
  kind: 1,
  quality: 0,
  quantity: 999_999,
  price: 0.15,
  contractTo: 'Issue 193 Recipient Co'
});
assert.ok(failRes.status >= 400);
const stockRollback = warehouseRepository.findByCompanyAndResource(sender.companyId, 1, 0)?.amount ?? 0;
assert.equal(stockRollback, stockAfter, 'Stock must not change when contract submission fails');

// 4. Non-existent recipient: rolls back with 404
const notFoundRes = await dispatchMarket('/api/v2/market-order/', 'POST', sender.companyId, {
  kind: 1,
  quality: 0,
  quantity: 10,
  price: 0.15,
  contractTo: 'NonExistent Company XYZ 12345'
});
assert.equal(notFoundRes.status, 404);
assert.equal(warehouseRepository.findByCompanyAndResource(sender.companyId, 1, 0)?.amount ?? 0, stockAfter);

// 5. Self-contract rejection
const selfRes = await dispatchMarket('/api/v2/market-order/', 'POST', sender.companyId, {
  kind: 1,
  quality: 0,
  quantity: 10,
  price: 0.15,
  contractTo: 'Issue 193 Sender Co'
});
assert.ok(selfRes.status >= 400);

console.log('PASS contract submission via market-order creates contract atomically and handles errors (#193)');

// #227: only the refund scenario is new; service/account/stock setup is shared.
await withTestServer(async server => {
  const seller = await server.registerCompany('contract-refund-seller');
  const buyer = await server.registerCompany('contract-refund-buyer');
  const outsider = await server.registerCompany('contract-refund-outsider');
  server.db.prepare('UPDATE companies SET level = 30 WHERE company_id IN (?, ?)').run(seller.companyId, buyer.companyId);
  const sourceCost = { workers: 1, admin: 2, material1: 3, material2: 4, market: 50 };
  for (const action of ['cancel', 'reject']) {
    server.setStock(seller.companyId, 2, 100, 50);
    server.db.prepare(`
      UPDATE warehouse SET cost_workers = ?, cost_admin = ?, cost_material1 = ?,
        cost_material2 = ?, cost_market = ?
      WHERE company_id = ? AND kind = 2 AND quality = 0
    `).run(sourceCost.workers, sourceCost.admin, sourceCost.material1, sourceCost.material2, sourceCost.market, seller.companyId);
    const sent = await server.request<{ id: number }>('POST', '/api/v2/contracts/', {
      cookie: seller.cookie, body: { recipient: buyer.companyId, kind: 2, quality: 0, amount: 25, price: 1 }
    });
    assert.equal(sent.status, 200, sent.text);
    const balance = () => server.db.prepare(`
      SELECT amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market
      FROM warehouse WHERE company_id = ? AND kind = 2 AND quality = 0
    `).get(seller.companyId) as {
      amount: number;
      cost_workers: number;
      cost_admin: number;
      cost_material1: number;
      cost_material2: number;
      cost_market: number;
    };
    assert.equal(balance().amount, 75);
    assert.equal(balance().amount * balance().cost_market, 3750, 'the outgoing contract removes its inventory valuation');
    const method = action === 'cancel' ? 'DELETE' : 'POST';
    const url = `/api/v2/contracts/${sent.json.id}/${action === 'reject' ? 'reject/' : ''}`;
    const cookie = action === 'cancel' ? seller.cookie : buyer.cookie;

    const wrongOwner = await server.request(method, url, {
      cookie: action === 'cancel' ? buyer.cookie : outsider.cookie
    });
    assert.ok(wrongOwner.status >= 400, 'only the sender can cancel or the recipient can reject');
    assert.equal(balance().amount, 75);
    const outgoingBalance = { ...balance() };
    assert.deepEqual(outgoingBalance, {
      amount: 75,
      cost_workers: sourceCost.workers,
      cost_admin: sourceCost.admin,
      cost_material1: sourceCost.material1,
      cost_material2: sourceCost.material2,
      cost_market: sourceCost.market
    });

    server.db.exec(`
      CREATE TRIGGER issue_227_abort_contract_refund
      BEFORE UPDATE OF amount ON warehouse
      WHEN NEW.company_id = ${seller.companyId} AND NEW.kind = 2 AND NEW.quality = 0
      BEGIN SELECT RAISE(ABORT, 'issue 227 contract rollback probe'); END;
    `);
    try {
      const failedRefund = await server.request(method, url, { cookie });
      assert.ok(failedRefund.status >= 400, 'warehouse failure rejects the contract transition');
    } finally {
      server.db.exec('DROP TRIGGER issue_227_abort_contract_refund');
    }
    assert.equal(balance().amount, 75, 'failed contract refund rolls back the contract state and inventory');
    assert.deepEqual({ ...balance() }, outgoingBalance, 'failed refund preserves every stored cost bucket');

    const refunded = await server.request(method, url, { cookie });
    assert.equal(refunded.status, 200, refunded.text);
    assert.equal(balance().amount, 100);
    assert.deepEqual(
      {
        workers: balance().cost_workers,
        admin: balance().cost_admin,
        material1: balance().cost_material1,
        material2: balance().cost_material2,
        market: balance().cost_market
      },
      sourceCost,
      'refund restores all original cost buckets, independent of the $1 contract price'
    );
    assert.equal(balance().amount * balance().cost_market, 5000, 'warehouse valuation returns to its pre-contract value');
    const repeated = await server.request(method, url, { cookie });
    assert.ok(repeated.status >= 400, 'settled contract cannot refund twice');
    assert.equal(balance().amount, 100);
    assert.equal(balance().amount * balance().cost_market, 5000);
  }
  console.log('PASS contract cancel/reject restore quantity and original valuation idempotently (#227)');
});
