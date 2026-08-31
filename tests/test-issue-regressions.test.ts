import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

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

const baseUrl = 'http://127.0.0.1:3000';

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
      company: `Issue Regression ${label}`
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

  const first = await register(`first_${suffix}`);
  const second = await register(`second_${suffix}`);
  const firstBuildingsResponse = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { Cookie: first.cookie }
  });
  assert.equal(firstBuildingsResponse.status, 200);
  const firstBuildings = await readJson(firstBuildingsResponse) as Array<{ id: number; kind: string }>;
  const firstFarm = firstBuildings.find(building => building.kind === 'P');
  const firstStore = firstBuildings.find(building => building.kind === 'G');
  assert.ok(firstFarm && firstStore);

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

  console.log('ISSUE REGRESSIONS PASSED');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
