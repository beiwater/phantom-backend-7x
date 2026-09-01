import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { addResource } from '../server/game/warehouse.ts';

type Session = {
  cookie: string;
  token: string;
  companyId: number;
};

type AuthCompany = {
  companyId: number;
  money: number;
  simBoosts: number;
  maxTags: number;
};

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function register(label: string): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `issue_regression_${label}_${Date.now()}@domain.local`,
      password: 'Password123!',
      company: `Issue Regression ${label} ${Date.now()}`
    })
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(value => value.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'registration did not return a session cookie');
  const token = cookie.slice('sessionid='.length);

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = await readJson(authResponse) as { authCompany: AuthCompany };
  assert.ok(auth.authCompany.companyId > 0);
  return { cookie, token, companyId: auth.authCompany.companyId };
}

function headers(session: Session) {
  return { 'Content-Type': 'application/json', Cookie: session.cookie };
}

async function authCompany(session: Session): Promise<AuthCompany> {
  const response = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: session.cookie }
  });
  assert.equal(response.status, 200);
  return (await readJson(response)).authCompany as AuthCompany;
}

async function run() {
  const suffix = Date.now();

  // #25: unknown routes, wrong methods, and explicit stubs are observable.
  const unknownApiResponse = await fetch(`${baseUrl}/api/unknown-regression-route/`);
  assert.equal(unknownApiResponse.status, 404);
  assert.equal((await readJson(unknownApiResponse)).code, 'API_NOT_FOUND');
  const wrongMethodResponse = await fetch(`${baseUrl}/api/v2/time-millis/`, { method: 'POST' });
  assert.equal(wrongMethodResponse.status, 405);
  assert.equal(wrongMethodResponse.headers.get('allow'), 'GET');
  const paymentStubResponse = await fetch(`${baseUrl}/api/v2/payment/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'simboosts_small' })
  });
  assert.equal(paymentStubResponse.status, 501);
  assert.equal(paymentStubResponse.headers.get('x-backend-stub'), 'true');

  // #62/#52/#55/#28: every state-changing endpoint rejects guest writes.
  assert.equal((await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v2/message/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'guest write' })
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v2/no-cache/companies/achievements/market-tycoon/`, {
    method: 'DELETE'
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v2/sales-orders/1/`, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v4/executives/`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v2/resources/4259175/`)).status, 401);

  const first = await register(`first_${suffix}`);
  const second = await register(`second_${suffix}`);
  // #18: executive data is company-scoped.
  const crossCompanyExecutives = await fetch(`${baseUrl}/api/v4/companies/${first.companyId}/executives/`, {
    headers: { Cookie: second.cookie }
  });
  assert.equal(crossCompanyExecutives.status, 401);
  const firstBuildingsResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { Cookie: first.cookie }
  });
  assert.equal(firstBuildingsResponse.status, 200);
  const firstBuildings = await readJson(firstBuildingsResponse) as Array<{ id: number; kind: string }>;
  const firstFarm = firstBuildings.find(building => building.kind === 'P');
  const firstStore = firstBuildings.find(building => building.kind === 'G');
  assert.ok(firstFarm && firstStore);

  // #31: ordinary construction cannot replace an occupied slot.
  const occupiedBefore = await authCompany(first);
  const occupiedMaterial = db.prepare(`
    SELECT amount FROM warehouse
    WHERE company_id = ? AND kind = 101 AND quality = 0
  `).get(first.companyId) as { amount?: number } | undefined;
  const occupiedResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers: headers(first),
    body: JSON.stringify({ kind: 'P', position: '0' })
  });
  assert.equal(occupiedResponse.status, 400);
  assert.equal((await authCompany(first)).money, occupiedBefore.money);
  const occupiedMaterialAfter = db.prepare(`
    SELECT amount FROM warehouse
    WHERE company_id = ? AND kind = 101 AND quality = 0
  `).get(first.companyId) as { amount?: number } | undefined;
  assert.equal(occupiedMaterialAfter?.amount, occupiedMaterial?.amount);

  // #31: PATCH size is a target level, so Lv1 -> Lv2 consumes one upgrade unit.
  const upgradeResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/${firstFarm.id}/`, {
    method: 'PATCH',
    headers: headers(first),
    body: JSON.stringify({ size: 2 })
  });
  assert.equal(upgradeResponse.status, 200);
  const upgraded = await readJson(upgradeResponse);
  assert.equal(upgraded.building.size, 2);

  const secondBuildingsResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { Cookie: second.cookie }
  });
  const secondBuildings = await readJson(secondBuildingsResponse) as Array<{ id: number; kind: string }>;
  const secondFarm = secondBuildings.find(building => building.kind === 'P');
  assert.ok(secondFarm);

  // #19/#62: an authenticated company cannot mutate or inspect another company's queue.
  assert.equal((await fetch(`${baseUrl}/api/v2/companies/me/buildings/${secondFarm.id}/`, {
    method: 'PATCH', headers: headers(first), body: JSON.stringify({ name: 'cross-company' })
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v2/companies/me/buildings/${secondFarm.id}/`, {
    method: 'DELETE', headers: headers(first)
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v2/companies/buildings/${secondFarm.id}/queue/`, {
    headers: { Cookie: first.cookie }
  })).status, 401);

  // #54: a construction shortage is rejected before any money/material mutation.
  const shortage = await register(`shortage_${suffix}`);
  db.prepare('UPDATE warehouse SET amount = 0 WHERE company_id = ? AND kind = 101 AND quality = 0')
    .run(shortage.companyId);
  const shortageBefore = await authCompany(shortage);
  const shortageMaterials = db.prepare(`
    SELECT kind, amount FROM warehouse WHERE company_id = ? AND kind IN (101, 102, 108, 111) ORDER BY kind
  `).all(shortage.companyId) as Array<{ kind: number; amount: number }>;
  const shortageResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers: headers(shortage),
    body: JSON.stringify({ kind: 'P', position: `shortage-${suffix}` })
  });
  assert.equal(shortageResponse.status, 400);
  assert.deepEqual(
    db.prepare(`SELECT kind, amount FROM warehouse WHERE company_id = ? AND kind IN (101, 102, 108, 111) ORDER BY kind`)
      .all(shortage.companyId),
    shortageMaterials
  );
  assert.equal((await authCompany(shortage)).money, shortageBefore.money);

  // #56: a purchased tag slot survives a fresh auth-data read.
  const slot = await register(`slot_${suffix}`);
  const slotBefore = await authCompany(slot);
  const unlockResponse = await fetch(`${baseUrl}/api/v2/companies/me/tags/`, {
    method: 'POST', headers: headers(slot)
  });
  assert.equal(unlockResponse.status, 200);
  const unlock = await readJson(unlockResponse);
  assert.equal(unlock.maxTags, slotBefore.maxTags + 1);
  const slotAfter = await authCompany(slot);
  assert.equal(slotAfter.maxTags, slotBefore.maxTags + 1);
  assert.equal(slotAfter.simBoosts, slotBefore.simBoosts - 200);

  // #51/#53: unknown and repeated achievement claims cannot mint rewards.
  const achiever = await register(`achievement_${suffix}`);
  const achievementBefore = await authCompany(achiever);
  const claimResponse = await fetch(`${baseUrl}/api/v2/no-cache/companies/achievements/market-tycoon/`, {
    method: 'DELETE', headers: { Cookie: achiever.cookie }
  });
  assert.equal(claimResponse.status, 200);
  const claim = await readJson(claimResponse);
  assert.equal(claim.sim_boosts, 5);
  assert.equal(claim.simboosts, achievementBefore.simBoosts + 5);
  assert.equal(claim.moneyDelta, 5000);
  const afterClaim = await authCompany(achiever);
  assert.equal(afterClaim.simBoosts, achievementBefore.simBoosts + 5);
  assert.equal(afterClaim.money, achievementBefore.money + 5000);

  const duplicateResponse = await fetch(`${baseUrl}/api/v2/no-cache/companies/achievements/market-tycoon/`, {
    method: 'DELETE', headers: { Cookie: achiever.cookie }
  });
  assert.equal(duplicateResponse.status, 400);
  assert.deepEqual(await authCompany(achiever), afterClaim);

  const unknownResponse = await fetch(`${baseUrl}/api/v2/no-cache/companies/achievements/not-real/`, {
    method: 'DELETE', headers: { Cookie: achiever.cookie }
  });
  assert.equal(unknownResponse.status, 400);
  assert.deepEqual(await authCompany(achiever), afterClaim);

  // #49/#50/#55: retail order persistence, ownership, one-time inventory use, and delta cash.
  const createOrderResponse = await fetch(`${baseUrl}/api/v2/companies/buildings/${firstStore.id}/sales-orders/`, {
    method: 'POST',
    headers: headers(first),
    body: JSON.stringify({ resource: 3, quality: 0, units: 10, sellingPrice: 5 })
  });
  assert.equal(createOrderResponse.status, 200);
  const createdOrder = await readJson(createOrderResponse);
  const orderId = createdOrder.salesOrder?.id || createdOrder.id;
  assert.ok(orderId > 0);

  const foreignDelete = await fetch(`${baseUrl}/api/v2/sales-orders/${orderId}/`, {
    method: 'DELETE', headers: { Cookie: second.cookie }
  });
  assert.equal(foreignDelete.status, 401);

  const retailBefore = await authCompany(first);
  const fulfillResponse = await fetch(`${baseUrl}/api/v2/companies/buildings/${firstStore.id}/sales-orders/${orderId}/`, {
    method: 'PUT', headers: { Cookie: first.cookie }, body: '{}'
  });
  assert.equal(fulfillResponse.status, 200);
  const fulfillment = await readJson(fulfillResponse);
  assert.equal(fulfillment.money, 50);
  assert.equal(fulfillment.moneyBalance, retailBefore.money + 50);
  assert.equal((await authCompany(first)).money, retailBefore.money + 50);
  const remainingApples = db.prepare(`
    SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0
  `).get(first.companyId) as { amount: number };
  assert.equal(remainingApples.amount, 4990);

  const failedOrderResponse = await fetch(`${baseUrl}/api/v2/companies/buildings/${firstStore.id}/sales-orders/`, {
    method: 'POST', headers: headers(first), body: JSON.stringify({ resource: 3, quality: 0, units: 1, sellingPrice: 5 })
  });
  assert.equal(failedOrderResponse.status, 200);
  const failedOrder = await readJson(failedOrderResponse);
  const failedOrderId = failedOrder.salesOrder?.id || failedOrder.id;
  db.prepare('UPDATE warehouse SET amount = 0 WHERE company_id = ? AND kind = 3 AND quality = 0').run(first.companyId);
  const failedBefore = await authCompany(first);
  const failedFulfillment = await fetch(`${baseUrl}/api/v2/sales-orders/${failedOrderId}/`, {
    method: 'PUT', headers: { Cookie: first.cookie }, body: '{}'
  });
  assert.equal(failedFulfillment.status, 400);
  assert.equal((await authCompany(first)).money, failedBefore.money);
  assert.ok(db.prepare('SELECT 1 FROM retail_orders WHERE id = ?').get(failedOrderId));

  // #17: an expired session is rejected and removed instead of remaining usable.
  db.prepare('UPDATE sessions SET expires_at = ? WHERE session_token = ?')
    .run(new Date(Date.now() - 1000).toISOString(), first.token);
  const expiredResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { Cookie: first.cookie }
  });
  assert.equal(expiredResponse.status, 401);
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE session_token = ?').get(first.token), undefined);

  // #20/#29: malformed and oversized JSON are rejected at the request boundary.
  const malformedBody = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers: headers(second),
    body: '{bad}'
  });
  assert.equal(malformedBody.status, 400);
  const oversizedBody = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers: headers(second),
    body: JSON.stringify({ kind: 'P', position: 'x', padding: 'x'.repeat(1024 * 1024) })
  });
  assert.equal(oversizedBody.status, 413);

  // #35: CORS never grants wildcard credentials and rejects an untrusted origin.
  const blockedCors = await fetch(`${baseUrl}/api/v2/time-millis/`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      'Access-Control-Request-Method': 'POST'
    }
  });
  assert.equal(blockedCors.status, 204);
  assert.notEqual(blockedCors.headers.get('access-control-allow-origin'), '*');
  assert.notEqual(blockedCors.headers.get('access-control-allow-credentials'), 'true');
  const allowedCors = await fetch(`${baseUrl}/api/v2/time-millis/`, {
    method: 'OPTIONS',
    headers: {
      Origin: baseUrl,
      'Access-Control-Request-Method': 'POST'
    }
  });
  assert.equal(allowedCors.status, 204);
  assert.equal(allowedCors.headers.get('access-control-allow-origin'), baseUrl);
  assert.equal(allowedCors.headers.get('access-control-allow-credentials'), 'true');

  // #23: issuing a bond creates a liability, and purchase transfers cash once.
  const seller = await register(`bond-seller_${suffix}`);
  const buyer = await register(`bond-buyer_${suffix}`);
  const sellerBeforeBond = await authCompany(seller);
  // Issue #71: bonds unlock at level 10 — arrange both companies there.
  db.prepare('UPDATE companies SET level = 10 WHERE company_id = ?').run(seller.companyId);
  db.prepare('UPDATE companies SET level = 10 WHERE company_id = ?').run(buyer.companyId);
  const issueBondResponse = await fetch(`${baseUrl}/api/v2/bonds/sell/`, {
    method: 'POST',
    headers: headers(seller),
    body: JSON.stringify({ amount: 1000, interest: 0.01 })
  });
  assert.equal(issueBondResponse.status, 200);
  const issuedBond = await readJson(issueBondResponse);
  assert.equal((await authCompany(seller)).money, sellerBeforeBond.money);
  const bondListingsResponse = await fetch(`${baseUrl}/api/v2/market/bonds/`);
  assert.equal(bondListingsResponse.status, 200);
  const bondListings = await readJson(bondListingsResponse) as Array<{ id: number; amount: number; seller: { id: number } }>;
  const listing = bondListings.find(bond => bond.id === issuedBond.bond.id);
  assert.ok(listing);
  const buyerBeforeBond = await authCompany(buyer);
  const buyBondResponse = await fetch(`${baseUrl}/api/v2/bonds/${listing.id}/buy/`, {
    method: 'POST',
    headers: { Cookie: buyer.cookie }
  });
  assert.equal(buyBondResponse.status, 200);
  assert.equal((await authCompany(buyer)).money, buyerBeforeBond.money - 1000);
  assert.equal((await authCompany(seller)).money, sellerBeforeBond.money + 1000);

  // #24: research cannot mint points without exact research inventory.
  const researcher = await register(`research_${suffix}`);
  // Issue #71: research unlocks at level 10 — arrange the company there.
  db.prepare('UPDATE companies SET level = 10 WHERE company_id = ?').run(researcher.companyId);
  const researchResponse = await fetch(`${baseUrl}/api/v2/companies/me/resource-ability/3/`, {
    method: 'POST',
    headers: headers(researcher),
    body: JSON.stringify({ points: 1 })
  });
  assert.equal(researchResponse.status, 400);

  // #33: market listings consume the requested quality tier, not a different one.
  const qualitySeller = await register(`quality-seller_${suffix}`);
  db.prepare('UPDATE warehouse SET amount = 0 WHERE company_id = ? AND kind = 3 AND quality = 0')
    .run(qualitySeller.companyId);
  db.prepare(`
    INSERT INTO warehouse (company_id, kind, quality, amount, cost_market, updated_at)
    VALUES (?, 3, 12, 4, 1, ?)
  `).run(qualitySeller.companyId, new Date().toISOString());
  const qualityOrderResponse = await fetch(`${baseUrl}/api/v2/market-order/`, {
    method: 'POST',
    headers: headers(qualitySeller),
    body: JSON.stringify({ kind: 3, quality: 12, quantity: 2, price: 4 })
  });
  assert.equal(qualityOrderResponse.status, 200);
  const q0Stock = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0')
    .get(qualitySeller.companyId) as { amount: number } | undefined;
  const q12Stock = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 12')
    .get(qualitySeller.companyId) as { amount: number } | undefined;
  assert.equal(q0Stock?.amount, 0);
  assert.equal(q12Stock?.amount, 2);

  // #36: reading a queue or display case does not resolve/write state.
  const readOnly = await register(`readonly_${suffix}`);
  const readOnlyBuildings = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { Cookie: readOnly.cookie }
  });
  const readOnlyBuildingList = await readJson(readOnlyBuildings) as Array<{ id: number }>;
  const readOnlyBuilding = readOnlyBuildingList[0];
  const queueBefore = db.prepare('SELECT COUNT(*) AS count FROM production_queues WHERE company_id = ?')
    .get(readOnly.companyId) as { count: number };
  await fetch(`${baseUrl}/api/v2/companies/buildings/${readOnlyBuilding.id}/queue/`, {
    headers: { Cookie: readOnly.cookie }
  });
  const queueAfter = db.prepare('SELECT COUNT(*) AS count FROM production_queues WHERE company_id = ?')
    .get(readOnly.companyId) as { count: number };
  assert.equal(queueAfter.count, queueBefore.count);
  const displayBefore = db.prepare('SELECT COUNT(*) AS count FROM display_case WHERE company_id = ?')
    .get(readOnly.companyId) as { count: number };
  const displayResponse = await fetch(`${baseUrl}/api/v2/companies/me/display-case/`, {
    headers: { Cookie: readOnly.cookie }
  });
  assert.equal(displayResponse.status, 200);
  const displayAfter = db.prepare('SELECT COUNT(*) AS count FROM display_case WHERE company_id = ?')
    .get(readOnly.companyId) as { count: number };

  // #46: inventory additions maintain weighted market cost.
  const costCompany = await register(`cost_${suffix}`);
  addResource(costCompany.companyId, 3, 12, 2, { market: 2 });
  addResource(costCompany.companyId, 3, 12, 1, { market: 5 });
  const weightedCostRow = db.prepare(`
    SELECT amount, cost_market FROM warehouse
    WHERE company_id = ? AND kind = 3 AND quality = 12
  `).get(costCompany.companyId) as { amount?: number; cost_market?: number } | undefined;
  assert.equal(weightedCostRow?.amount, 3);
  assert.ok(Math.abs(Number(weightedCostRow?.cost_market) - 3) < 0.001);
  assert.equal(displayAfter.count, displayBefore.count);

  // #46: balance sheet values match persisted inventory and building cost.
  const inventoryRow = db.prepare(`
    SELECT COALESCE(SUM(amount * cost_market), 0) AS total
    FROM warehouse WHERE company_id = ?
  `).get(second.companyId) as { total?: number } | undefined;
  const expectedInventory = Number(inventoryRow?.total) || 0;
  const buildingsRow = db.prepare(`
    SELECT COALESCE(SUM(cost), 0) AS total
    FROM buildings WHERE company_id = ?
  `).get(second.companyId) as { total?: number } | undefined;
  const expectedBuildings = Number(buildingsRow?.total) || 0;
  const balanceResponse = await fetch(`${baseUrl}/api/v2/companies/${second.companyId}/balance-sheet/`, {
    headers: { Cookie: second.cookie }
  });
  assert.equal(balanceResponse.status, 200);
  const balance = await readJson(balanceResponse);
  assert.ok(Math.abs(balance.inventory - expectedInventory) < 0.001);
  assert.ok(Math.abs(balance.buildings - expectedBuildings) < 0.001);
  const syntheticIncomeResponse = await fetch(`${baseUrl}/api/v2/companies/me/income-statement/`, {
    headers: { Cookie: second.cookie }
  });
  assert.equal(syntheticIncomeResponse.status, 501);

  // #46: loan mutations persist and balance-sheet liabilities are real.
  const borrower = await register(`borrower_${suffix}`);
  const borrowerBeforeLoan = await authCompany(borrower);
  const loanResponse = await fetch(`${baseUrl}/api/v2/companies/me/loans/`, {
    method: 'POST',
    headers: headers(borrower),
    body: JSON.stringify({ amount: 1000 })
  });
  assert.equal(loanResponse.status, 200);
  const loan = await readJson(loanResponse);
  assert.equal((await authCompany(borrower)).money, borrowerBeforeLoan.money + 1000);
  const loanBalanceResponse = await fetch(`${baseUrl}/api/v2/companies/me/balance-sheet/`, {
    headers: { Cookie: borrower.cookie }
  });
  const loanBalance = await readJson(loanBalanceResponse);
  assert.ok(loanBalance.liabilities >= 1000);
  const repayResponse = await fetch(`${baseUrl}/api/v2/companies/me/loans/${loan.loanId}/repay/`, {
    method: 'POST',
    headers: headers(borrower),
    body: JSON.stringify({ amount: 1000 })
  });
  assert.equal(repayResponse.status, 200);
  assert.equal((await authCompany(borrower)).money, borrowerBeforeLoan.money);

  // #32: taking a finished queue is atomic and cannot be claimed twice.
  const producer = await register(`producer_${suffix}`);
  const producerBuildingsResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { Cookie: producer.cookie }
  });
  const producerBuildings = await readJson(producerBuildingsResponse) as Array<{ id: number; kind: string }>;
  const producerFarm = producerBuildings.find(building => building.kind === 'P');
  assert.ok(producerFarm);
  const productionBefore = db.prepare(`
    SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0
  `).get(producer.companyId) as { amount: number };
  db.prepare(`
    INSERT INTO production_queues
      (building_id, company_id, kind, quality, amount, duration_seconds, started_at, finishes_at, resolved)
    VALUES (?, ?, 3, 0, 1, 1, ?, ?, 0)
  `).run(
    producerFarm.id,
    producer.companyId,
    new Date(Date.now() - 5000).toISOString(),
    new Date(Date.now() - 1000).toISOString()
  );
  const firstTake = await fetch(`${baseUrl}/api/v2/order/take/${producerFarm.id}/`, {
    method: 'POST',
    headers: { Cookie: producer.cookie }
  });
  assert.equal(firstTake.status, 200);
  const secondTake = await fetch(`${baseUrl}/api/v2/order/take/${producerFarm.id}/`, {
    method: 'POST',
    headers: { Cookie: producer.cookie }
  });
  assert.equal(secondTake.status, 400);
  const productionAfter = db.prepare(`
    SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3 AND quality = 0
  `).get(producer.companyId) as { amount: number };
  assert.equal(productionAfter.amount, productionBefore.amount + 1);

  console.log('ISSUE REGRESSIONS PASSED');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
