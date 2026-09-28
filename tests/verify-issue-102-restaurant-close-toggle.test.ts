import assert from 'node:assert/strict';
import { withTestServer } from './support/test-server.ts';

interface BuildingListItem {
  id: number;
  busy: {
    id?: number;
    restaurant_open?: boolean;
  } | null;
  restaurantProperties?: {
    keepOpen?: boolean;
  };
}

async function runIssue102Verification() {
  await withTestServer(async server => {
    const baseUrl = server.baseUrl;
    const db = server.db;
    const player = await server.registerCompany('restaurant-close-toggle');
    console.log('\n--- Scenario 1: Setup Restaurant and Menu ---');
    // Build restaurant (kind 'r')
    const constructRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
      method: 'POST',
      headers: { Cookie: player.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'r', position: '3' })
    });
    assert.equal(constructRes.status, 200);
    const constructData = await constructRes.json() as Record<string, unknown>;
    const restaurantId = Number(constructData.id || (constructData.building as { id?: number } | undefined)?.id);
    // Finish construction immediately
    db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(restaurantId);
    server.setStock(player.companyId, 117, 10000, 10, 1);
    server.setStock(player.companyId, 129, 10000, 15, 1);
    server.setStock(player.companyId, 132, 10000, 5, 1);

    // Configure menu (salad, main, drink) and price
    const configRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-properties/`, {
      method: 'PATCH',
      headers: { Cookie: player.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menuPrice: 120,
        saladBar: [{ kind: 117, serving: 'TOP', quality: 1 }],
        mains: [{ kind: 129, serving: 'TOP', quality: 1 }],
        drinks: [{ kind: 132, serving: 'TOP', quality: 1 }]
      })
    });
    assert.equal(configRes.status, 200);

    console.log('\n--- Scenario 2: Start Restaurant Cycle ---');
    const startRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-runs/`, {
      method: 'POST',
      headers: { Cookie: player.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (startRes.status !== 200) {
      console.log('startRes status:', startRes.status, 'body:', await startRes.text());
    }
    assert.equal(startRes.status, 200);
    const startData = await startRes.json() as { run?: { id: number } };
    const initialRunId = Number(startData.run?.id);
    assert.ok(initialRunId > 0);
    const buildingsBefore = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
      headers: { Cookie: player.cookie }
    });
    const buildingsList = await buildingsBefore.json() as BuildingListItem[] | { buildings: BuildingListItem[] };
    const items = Array.isArray(buildingsList) ? buildingsList : buildingsList.buildings || [];
    const rBuilding = items.find(b => b.id === restaurantId);
    assert.ok(rBuilding);
    assert.ok(rBuilding.busy);
    assert.equal(rBuilding.busy.restaurant_open, true);

    console.log('\n--- Scenario 3: Schedule Stop Operating After Cycle (keepOpen: false) ---');
    const stopRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-properties/`, {
      method: 'PATCH',
      headers: { Cookie: player.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepOpen: false })
    });
    assert.equal(stopRes.status, 200);
    const stopData = await stopRes.json() as { building?: { restaurantProperties?: { keepOpen?: boolean } } };
    assert.equal(stopData.building?.restaurantProperties?.keepOpen, false);

    // Verify active cycle is still running and not interrupted
    const runsRes1 = await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-runs/`, {
      headers: { Cookie: player.cookie }
    });
    const runs1 = await runsRes1.json() as Array<{ id: number; resolved: boolean }>;
    assert.equal(runs1[0].id, initialRunId);
    assert.equal(runs1[0].resolved, false);

    console.log('\n--- Scenario 4: Resume Auto-Continuous Operation (keepOpen: true) while Active ---');
    // Issue #102 core bug: this used to throw "Restaurant already has an active cycle" (400)
    const resumeRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-properties/`, {
      method: 'PATCH',
      headers: { Cookie: player.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepOpen: true })
    });
    assert.equal(resumeRes.status, 200, `Expected 200 OK on resume keepOpen, got ${resumeRes.status}`);
    const resumeData = await resumeRes.json() as { building?: { restaurantProperties?: { keepOpen?: boolean } } };
    assert.equal(resumeData.building?.restaurantProperties?.keepOpen, true);

    // Verify still running the SAME active cycle, no duplicate cycle spawned
    const runsRes2 = await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-runs/`, {
      headers: { Cookie: player.cookie }
    });
    const runs2 = await runsRes2.json() as Array<{ id: number; resolved: boolean }>;
    assert.equal(runs2.length, 1);
    assert.equal(runs2[0].id, initialRunId);
    assert.equal(runs2[0].resolved, false);

    console.log('\n--- Scenario 5: Fast-Forward 12h & Map/Detail State Consistency ---');
    // Fast forward the cycle_end to the past
    db.prepare('UPDATE restaurant_runs SET cycle_end = ? WHERE id = ?')
      .run(new Date(Date.now() - 5000).toISOString(), initialRunId);

    // Fetch buildings list (simulates viewing the map)
    const mapRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
      headers: { Cookie: player.cookie }
    });
    assert.equal(mapRes.status, 200);
    const mapBuildings = await mapRes.json() as BuildingListItem[] | { buildings: BuildingListItem[] };
    const mapItems = Array.isArray(mapBuildings) ? mapBuildings : mapBuildings.buildings || [];
    const mapRBuilding = mapItems.find(b => b.id === restaurantId);
    assert.ok(mapRBuilding);

    // Since keepOpen was true and warehouse has stock, next cycle should have started automatically
    assert.ok(mapRBuilding.busy);
    assert.equal(mapRBuilding.busy.restaurant_open, true);
    assert.notEqual(mapRBuilding.busy.id, initialRunId);

    // Detail view matches map
    const detailRuns = await (await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-runs/`, {
      headers: { Cookie: player.cookie }
    })).json() as Array<{ id: number; resolved: boolean }>;
    assert.equal(detailRuns.length, 2);
    assert.equal(detailRuns[1].id, initialRunId);
    assert.equal(detailRuns[1].resolved, true);
    assert.equal(detailRuns[0].resolved, false);
    assert.equal(detailRuns[0].id, mapRBuilding.busy.id);

    console.log('\n--- Scenario 6: Stop Operating and Settle -> Map Shows Idle (busy: null) ---');
    // Now schedule stop operating on cycle 2
    await fetch(`${baseUrl}/api/v2/companies/buildings/${restaurantId}/restaurant-properties/`, {
      method: 'PATCH',
      headers: { Cookie: player.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepOpen: false })
    });
    // Fast forward cycle 2 to the past
    db.prepare('UPDATE restaurant_runs SET cycle_end = ? WHERE id = ?')
      .run(new Date(Date.now() - 5000).toISOString(), detailRuns[0].id);

    // Fetch map buildings
    const mapRes2 = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
      headers: { Cookie: player.cookie }
    });
    const mapBuildings2 = await mapRes2.json() as BuildingListItem[] | { buildings: BuildingListItem[] };
    const mapItems2 = Array.isArray(mapBuildings2) ? mapBuildings2 : mapBuildings2.buildings || [];
    const mapRBuilding2 = mapItems2.find(b => b.id === restaurantId);
    assert.ok(mapRBuilding2);
    // Cycle 2 settled and keepOpen is false -> restaurant is closed/idle -> busy must be null
    assert.equal(mapRBuilding2.busy, null, 'Expected busy to be null on closed restaurant');

    console.log('\nALL ISSUE #102 RESTAURANT CLOSE TOGGLE CHECKS PASSED (0 ERRORS)');
  }, { env: { SPEED_MULTIPLIER: '1.0' } });
}

runIssue102Verification().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
