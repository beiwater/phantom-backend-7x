import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `compat_${label}_${Date.now()}@domain.local`,
      password: 'Password123!',
      company: `Compat ${label} ${Date.now()}`
    })
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(value => value.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'registration did not return a session cookie');

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = await readJson(authResponse);
  return { cookie, companyId: auth.authCompany.companyId };
}

async function runIssue67Tests() {
  console.log('====================================================');
  console.log(' Starting Issue #67 Compatibility Gate Tests');
  console.log('====================================================');

  const user = await register('test67');
  const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

  // 1. Get user buildings
  const buildingsRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, { headers });
  assert.equal(buildingsRes.status, 200);
  const buildings = await readJson(buildingsRes) as Array<{ id: number; kind: string; name: string }>;
  
  const farm = buildings.find(b => b.kind === 'P');
  const store = buildings.find(b => b.kind === 'G');
  assert.ok(farm, 'Farm not found in starter buildings');
  assert.ok(store, 'Grocery store not found in starter buildings');

  // 2. Reject incompatible production in Farm (e.g. Crude Oil #2, Petrol #11, Electronics #24)
  console.log('[1/4] Verifying Farm rejects incompatible production (Crude Oil #2)...');
  const invalidProdRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farm.id}/queue/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 2, amount: 10 }) // Crude Oil is produced at Oil Rig 'O'
  });
  assert.equal(invalidProdRes.status, 400);
  const invalidProdData = await readJson(invalidProdRes);
  assert.match(invalidProdData.error || '', /cannot be produced in building type/i);
  console.log('  -> Incompatible production rejected as expected (400)');

  // 3. Reject incompatible retail in Grocery Store (e.g. Petrol #11, Laptops #25)
  console.log('[2/4] Verifying Grocery Store rejects incompatible retail product (Petrol #11)...');
  const invalidRetailRes = await fetch(`${baseUrl}/api/v2/sales-orders/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      building: store.id,
      resource: 11, // Petrol is sold at Gas Station 'S'
      units: 1,
      sellingPrice: 50.0
    })
  });
  assert.equal(invalidRetailRes.status, 400);
  const invalidRetailData = await readJson(invalidRetailRes);
  assert.match(invalidRetailData.error || '', /cannot be sold in retail building/i);
  console.log('  -> Incompatible retail product rejected as expected (400)');

  // 4. Reject unknown building kind construction
  console.log('[3/4] Verifying unknown building kind construction is rejected...');
  const initialAuth = await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers })).json();
  const initialMoney = initialAuth.authCompany.money;

  const invalidConstructRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'INVALID_XYZ_999', position: '15' })
  });
  assert.equal(invalidConstructRes.status, 400);
  console.log('  -> Unknown building kind rejected as expected (400)');

  // Verify money and inventory was not mutated
  const afterAuth = await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers })).json();
  assert.equal(afterAuth.authCompany.money, initialMoney, 'Money must not change on rejected construction');

  // 5. Verify valid production still works (e.g. Grain #3 or Seeds #1 in Farm)
  console.log('[4/4] Verifying valid production in Farm (Seeds #1 / Grain #3)...');
  const validProdRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farm.id}/queue/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 3, amount: 100 }) // Grain #3 is produced at Farm 'P'
  });
  assert.equal(validProdRes.status, 200);
  const validProdData = await readJson(validProdRes);
  assert.ok(validProdData.queueItem || validProdData.id, 'Queue item returned on success');
  console.log('  -> Valid production succeeded cleanly (200)');

  console.log('====================================================');
  console.log(' ✅ ISSUE #67 COMPATIBILITY GATES PASSED ALL CHECKS');
  console.log('====================================================');
}

runIssue67Tests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
