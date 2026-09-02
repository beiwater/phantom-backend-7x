import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../server/db/database.ts';
import { addResource } from '../server/game/warehouse.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

const rootDir = path.resolve('/home/ubuntu/phantom-backend-7x');
const resPath = path.join(rootDir, 'server/data/constants/resources.json');
const bldPath = path.join(rootDir, 'server/data/constants/buildings.json');
const CANONICAL_RESOURCES = JSON.parse(fs.readFileSync(resPath, 'utf-8'));
const CANONICAL_BUILDINGS = JSON.parse(fs.readFileSync(bldPath, 'utf-8'));

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `all_bld_${label}_${Date.now()}@domain.local`,
      password: 'Password123!',
      company: `All Buildings Corp ${label} ${Date.now()}`
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
  const companyId = auth.authCompany.companyId;

  // Fund test company and seed materials
  db.prepare('UPDATE companies SET money = 10000000, extra_building_slots = 500 WHERE id = ?').run(companyId);
  db.prepare('UPDATE companies SET money = 10000000, extra_building_slots = 500 WHERE company_id = ?').run(companyId);

  // Seed construction materials (101: Planks, 102: Bricks, 108: Concrete, 111: Construction units)
  for (const m of [101, 102, 108, 111]) {
    addResource(companyId, m, 0, 50000);
  }

  return { cookie, companyId };
}

async function runAllBuildingsProductionAndRetailTest() {
  console.log('================================================================');
  console.log(' Starting Comprehensive Production & Retail Across ALL Buildings');
  console.log('================================================================');

  const user = await register('full_suite');
  // Lift the company above the L15+ queue-duration tier (48h) so every
  // production kind — including slow aerospace items (~33h for 10 units) —
  // fits the Issue #99 duration gate.
  db.prepare('UPDATE companies SET level = 20, experience = 999999999 WHERE company_id = ?').run(user.companyId);
  const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

  // Map resources by building kind
  const resourcesByBuilding: Record<string, Array<{ id: number; producedFrom?: Record<string, number> }>> = {};
  const allProducibleResources: Array<{ id: number; producedAt: string; producedFrom?: Record<string, number> }> = [];

  for (const [idStr, r] of Object.entries(CANONICAL_RESOURCES as Record<string, any>)) {
    if (r.producedAt) {
      if (!resourcesByBuilding[r.producedAt]) resourcesByBuilding[r.producedAt] = [];
      const item = { id: Number(idStr), producedAt: r.producedAt, producedFrom: r.producedFrom };
      resourcesByBuilding[r.producedAt].push(item);
      allProducibleResources.push(item);
    }
  }

  // ----------------------------------------------------------------
  // PART 1: Test Production Across ALL Production Building Types
  // ----------------------------------------------------------------
  console.log('\n--- PART 1: Testing Production Across ALL Production Building Kinds ---');
  const productionBuildingKinds = Object.keys(CANONICAL_BUILDINGS).filter(
    k => CANONICAL_BUILDINGS[k].category === 'production' && resourcesByBuilding[k]?.length > 0
  );

  console.log(`Found ${productionBuildingKinds.length} active production building kinds in canonical data.`);

  let prodPassedCount = 0;
  let prodRejectedCount = 0;

  for (let i = 0; i < productionBuildingKinds.length; i++) {
    const kind = productionBuildingKinds[i];
    const pos = String(100 + i);
    const validResources = resourcesByBuilding[kind];
    const targetResource = validResources[0];

    // Seed any needed input materials for targetResource
    if (targetResource.producedFrom) {
      for (const [reqKindStr, reqRatio] of Object.entries(targetResource.producedFrom)) {
        const reqKind = Number(reqKindStr);
        addResource(user.companyId, reqKind, 0, 5000);
      }
    }

    // Construct building
    const constructRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, position: pos })
    });

    if (constructRes.status !== 200) {
      console.warn(`  [Warning] Building "${kind}" construction returned ${constructRes.status}:`, (await constructRes.text()).slice(0, 100));
      continue;
    }
    const constructData = await readJson(constructRes);
    const buildingId = constructData.building?.id || constructData.id;
    assert.ok(buildingId, `Building ID returned for kind "${kind}"`);
    // Clear construction busy state to test production capability
    db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(buildingId);
    const validProdRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${buildingId}/queue/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: targetResource.id, amount: 10 })
    });

    if (validProdRes.status === 200) {
      prodPassedCount++;
    } else {
      const errText = await validProdRes.text();
      console.warn(`  [Notice] Building "${kind}" valid production of #${targetResource.id} returned ${validProdRes.status}: ${errText}`);
    }

    // 2. Test Incompatible Production Rejection
    const incompatible = allProducibleResources.find(r => r.producedAt !== kind);
    if (incompatible) {
      const invalidProdRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${buildingId}/queue/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: incompatible.id, amount: 10 })
      });

      if (invalidProdRes.status === 400 || invalidProdRes.status === 409) {
        prodRejectedCount++;
      } else {
        console.error(`  [FAIL] Building "${kind}" accepted incompatible resource #${incompatible.id} (producedAt: ${incompatible.producedAt}) -> status: ${invalidProdRes.status}`);
      }
    }
  }

  console.log(`\n  -> Production Buildings Verified: ${prodPassedCount}/${productionBuildingKinds.length} successfully queued valid production.`);
  console.log(`  -> Incompatible Production Rejections: ${prodRejectedCount}/${productionBuildingKinds.length} rejected incompatible resources.`);

  // ----------------------------------------------------------------
  // PART 2: Test Retail Across ALL Sales Building Types
  // ----------------------------------------------------------------
  console.log('\n--- PART 2: Testing Retail Sales Across ALL Sales Building Kinds ---');
  
  // Canonical retail building kinds + products (game-data/retail.ts is the
  // authoritative map — the old S/E/T/C/H/F letters predate the decompile).
  const RETAIL_MAP: Record<string, number[]> = {
    G: [3],   // Grocery store
    A: [11],  // Gas station
    C: [24],  // Electronics store
    '2': [53], // Car dealership
    H: [60],  // Fashion store
    d: [102], // Hardware store
    r: [117], // Restaurant
  };

  const salesBuildingKinds = Object.keys(RETAIL_MAP);
  console.log(`Testing ${salesBuildingKinds.length} retail building kinds: [${salesBuildingKinds.join(', ')}]`);

  let retailPassedCount = 0;
  let retailRejectedCount = 0;

  for (let i = 0; i < salesBuildingKinds.length; i++) {
    const kind = salesBuildingKinds[i];
    const pos = String(300 + i);
    const validProducts = RETAIL_MAP[kind];
    const targetProduct = validProducts[0];

    // Seed stock for targetProduct in warehouse
    addResource(user.companyId, targetProduct, 0, 5000);

    // Construct sales building
    const constructRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, position: pos })
    });

    if (constructRes.status !== 200) {
      console.warn(`  [Warning] Sales Building "${kind}" construction returned ${constructRes.status}:`, (await constructRes.text()).slice(0, 100));
      continue;
    }

    const constructData = await readJson(constructRes);
    const buildingId = constructData.building?.id || constructData.id;
    assert.ok(buildingId, `Sales building ID returned for kind "${kind}"`);
    // Clear construction busy state to test retail capability
    db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(buildingId);

    // 1. Test Incompatible Retail Rejection
    const incompatibleProduct = kind === 'G' ? 11 : (kind === 'S' ? 3 : 10);
    const invalidRetailRes = await fetch(`${baseUrl}/api/v2/sales-orders/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        building: buildingId,
        resource: incompatibleProduct,
        units: 5
      })
    });
    if (invalidRetailRes.status === 400) {
      retailRejectedCount++;
    } else {
      console.error(`  [FAIL] Sales building "${kind}" accepted unsupported product #${incompatibleProduct} (status: ${invalidRetailRes.status})`);
    }

    // 2. Test Supported Retail Product Acceptance
    const validRetailRes = await fetch(`${baseUrl}/api/v2/sales-orders/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        building: buildingId,
        resource: targetProduct,
        units: 5
      })
    });

    if (validRetailRes.status === 200) {
      retailPassedCount++;
      const orderData = await readJson(validRetailRes);
      assert.ok(orderData.id, 'Retail order created with valid ID');
    } else {
      console.warn(`  [Notice] Sales building "${kind}" retail of #${targetProduct} returned ${validRetailRes.status}:`, await validRetailRes.text());
    }
  }

  console.log(`\n  -> Retail Buildings Verified: ${retailPassedCount}/${salesBuildingKinds.length} successfully created valid retail orders.`);
  console.log(`  -> Incompatible Retail Rejections: ${retailRejectedCount}/${salesBuildingKinds.length} rejected unsupported retail products.`);

  assert.equal(prodPassedCount, productionBuildingKinds.length, `All ${productionBuildingKinds.length} production building kinds must succeed valid production`);
  assert.equal(prodRejectedCount, productionBuildingKinds.length, `All ${productionBuildingKinds.length} production building kinds must reject incompatible resources`);
  assert.equal(retailPassedCount, salesBuildingKinds.length, `All ${salesBuildingKinds.length} sales building kinds must succeed valid retail orders`);
  assert.equal(retailRejectedCount, salesBuildingKinds.length, `All ${salesBuildingKinds.length} sales building kinds must reject unsupported products`);

  console.log('\n================================================================');
  console.log(' ✅ ALL 35 PRODUCTION & RETAIL BUILDING KINDS FULLY VERIFIED!');
  console.log('================================================================\n');
}

runAllBuildingsProductionAndRetailTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
