import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const time = Date.now();
  const email = `retail_${label}_${time}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Retail Co ${label} ${Date.now()}` })
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie);

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = (await authResponse.json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function runIssue47And44Test() {
  console.log('================================================================');
  console.log(' Starting Issue #47 & #44 Building Busy & Retail Verification');
  console.log('================================================================');

  const { cookie, companyId } = await register('test');
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  // Fund company and stock warehouse materials
  db.prepare('UPDATE companies SET money = 1000000, simboosts = 5000, extra_building_slots = 20 WHERE company_id = ?').run(companyId);
  db.prepare('UPDATE companies SET money = 1000000, simboosts = 5000, extra_building_slots = 20 WHERE id = ?').run(companyId);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 101, 0, 5000, 0, 0, 0, 0, 1.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 5000')
    .run(companyId, now);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 102, 0, 5000, 0, 0, 0, 0, 1.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 5000')
    .run(companyId, now);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 111, 0, 5000, 0, 0, 0, 0, 1.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 5000')
    .run(companyId, now);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 3, 0, 5000, 0, 0, 0, 0, 1.0, ?) ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + 5000')
    .run(companyId, now);

  // -------------------------------------------------------------
  // PART 1: ISSUE #47 Building Busy State Blocks Production/Upgrade
  // -------------------------------------------------------------
  console.log('\n--- PART 1: ISSUE #47 Building Busy State ---');
  console.log('[1/4] Constructing a new Farm at position 10...');
  const constructRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'P', position: '10' })
  });
  assert.equal(constructRes.status, 200);
  const constructData = (await constructRes.json()) as { building: { id: number; isUnderConstruction: boolean } };
  const farmId = constructData.building.id;
  assert.ok(constructData.building.isUnderConstruction, 'Building must be marked under construction');
  console.log(`  -> Farm constructed (id: ${farmId}) and is under construction`);

  console.log('[2/4] Verifying queueing production while under construction is REJECTED...');
  const prematureProdRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farmId}/queue/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 3, amount: 100 })
  });
  assert.equal(prematureProdRes.status, 400, 'Queueing production during construction must return 400');
  console.log('  -> Premature production correctly rejected with 400');

  console.log('[3/4] Verifying upgrading while under construction is REJECTED...');
  const prematureUpgradeRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farmId}/`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ reqSize: 1 })
  });
  assert.equal(prematureUpgradeRes.status, 400, 'Upgrading while busy must return 400');
  console.log('  -> Repeated upgrade while busy correctly rejected with 400');

  console.log('[4/4] Rushing construction with SimBoosts and starting production...');
  const rushRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farmId}/construction-rush/`, {
    method: 'POST',
    headers
  });
  assert.equal(rushRes.status, 200, 'Construction rush should succeed');

  const validProdRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farmId}/queue/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 3, amount: 100 })
  });
  assert.equal(validProdRes.status, 200, 'Production must be permitted after construction is completed/rushed');
  console.log('  -> Production queue allowed after construction completed');

  // -------------------------------------------------------------
  // PART 2: ISSUE #44 Retail Price Bounds and Premature Fulfillment
  // -------------------------------------------------------------
  console.log('\n--- PART 2: ISSUE #44 Retail Price Bounds & Timing ---');
  console.log('[1/4] Constructing a Grocery Store at position 11...');
  const groceryRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'G', position: '11' })
  });
  assert.equal(groceryRes.status, 200);
  const groceryData = (await groceryRes.json()) as { building: { id: number } };
  const groceryId = groceryData.building.id;
  // Rush construction to enable immediate retail testing
  await fetch(`${baseUrl}/api/v2/companies/buildings/${groceryId}/construction-rush/`, {
    method: 'POST',
    headers
  });

  console.log('[2/4] Verifying extreme selling price ($999999) is REJECTED by server...');
  const extremePriceRes = await fetch(`${baseUrl}/api/v2/sales-orders/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      building: groceryId,
      resource: 3, // Apples
      units: 10,
      sellingPrice: 999999
    })
  });
  assert.equal(extremePriceRes.status, 400, 'Extreme selling price must be rejected');
  const errBody = (await extremePriceRes.json()) as { error: string };
  assert.match(errBody.error, /exceeds server-authoritative maximum/i);
  console.log('  -> Extreme price correctly rejected with 400');

  console.log('[3/4] Creating valid retail order and verifying premature fulfillment is BLOCKED...');
  const validRetailRes = await fetch(`${baseUrl}/api/v2/sales-orders/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      building: groceryId,
      resource: 3,
      units: 10,
      sellingPrice: 3.5
    })
  });
  assert.equal(validRetailRes.status, 200);
  const orderData = (await validRetailRes.json()) as { id: number; sellingPrice: number; finishedAt: string };
  const orderId = orderData.id;
  assert.equal(orderData.sellingPrice, 3.5);
  assert.ok(new Date(orderData.finishedAt).getTime() > Date.now(), 'finishedAt must be in the future');

  const authBeforeFulfill = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers })).json()) as { authCompany: { money: number } };
  const moneyBeforeFulfill = authBeforeFulfill.authCompany.money;

  // Premature fulfillment attempt
  const prematureFulfillRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${groceryId}/sales-orders/${orderId}/`, {
    method: 'PUT',
    headers
  });
  assert.equal(prematureFulfillRes.status, 400, 'Premature fulfillment must be rejected');
  const authAfterPremature = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers })).json()) as { authCompany: { money: number } };
  assert.equal(authAfterPremature.authCompany.money, moneyBeforeFulfill, 'Money must not change on failed fulfillment');
  console.log('  -> Premature fulfillment rejected and 0 phantom money minted');

  console.log('[4/4] Fast-forwarding order to finished_at and verifying valid fulfillment...');
  db.prepare("UPDATE retail_orders SET finished_at = datetime('now', '-5 seconds') WHERE id = ?").run(orderId);

  const validFulfillRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${groceryId}/sales-orders/${orderId}/`, {
    method: 'PUT',
    headers
  });
  if (validFulfillRes.status !== 200) {
    console.error('Fulfillment error:', await validFulfillRes.text());
  }
  assert.equal(validFulfillRes.status, 200, 'Valid fulfillment must succeed');
  const fulfillData = (await validFulfillRes.json()) as { success: boolean; revenue: number; moneyBalance: number };
  assert.equal(fulfillData.success, true);
  assert.equal(fulfillData.revenue, 35); // 10 units * $3.5
  assert.equal(fulfillData.moneyBalance, moneyBeforeFulfill + 35);
  console.log('  -> Valid fulfillment credited accurate authoritative revenue: $35.00');

  console.log('================================================================');
  console.log(' ✅ ISSUE #47 & #44 PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue47And44Test().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
