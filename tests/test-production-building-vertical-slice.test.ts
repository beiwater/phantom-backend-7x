import assert from 'node:assert';
import { createGameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { constructBuildingUseCase } from '../server/application/buildings/construct-building.ts';
import { upgradeBuildingUseCase } from '../server/application/buildings/upgrade-building.ts';
import { renameBuildingUseCase } from '../server/application/buildings/rename-building.ts';
import { demolishBuildingUseCase } from '../server/application/buildings/demolish-building.ts';
import { installRobotsUseCase } from '../server/application/buildings/install-robots.ts';
import { uninstallRobotsUseCase } from '../server/application/buildings/uninstall-robots.ts';
import { rushBuildingConstructionUseCase } from '../server/application/buildings/rush-construction.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { getCompanyBuildingsUseCase } from '../server/application/buildings/get-buildings.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { cancelProductionUseCase } from '../server/application/production/cancel-production.ts';
import { collectProductionUseCase } from '../server/application/production/collect-production.ts';
import { getProductionQueueUseCase } from '../server/application/production/get-production-queue.ts';
import { db } from '../server/db/database.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { productionRepository } from '../server/repositories/production-repository.ts';
import { toSimCompaniesBuildingDTO } from '../server/compatibility/simcompanies/building-dto.ts';
import {
  toSimCompaniesStartProductionDTO,
  toSimCompaniesCollectProductionDTO
} from '../server/compatibility/simcompanies/production-dto.ts';

async function testProductionBuildingVerticalSlice() {
  console.log('--- Testing Production + Building Vertical Slice End-to-End ---');

  // 1. Setup fresh test player and context
  const randomEmail = `slice_test_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.local`;
  const { playerId, companyId } = registerPlayer(randomEmail, 'password123', `SliceTest Co ${Date.now()}`);
  const ctx = createGameContext(companyId, playerId, 0);
  // Issue #99: queue durations are tier-capped (2h/24h/48h) and this slice
  // starts a 14400s apple queue, which requires the level-5 band. Pin level 10.
  db.prepare('UPDATE companies SET level = ? WHERE company_id = ?').run(10, companyId);

  // 2. Test Get Buildings List
  const initialBuildings = await getCompanyBuildingsUseCase(ctx);
  assert(initialBuildings.length >= 2, 'Initial company should have seeded buildings');

  // 3. Test Construct Building
  const constructRes = await constructBuildingUseCase(ctx, {
    kind: 'P', // Farm
    position: '2'
  });
  assert.strictEqual(constructRes.building.kind, 'P');
  assert.strictEqual(constructRes.building.position, '2');
  assert(constructRes.cost > 0, 'Construction must have positive cost');

  // Both construction rush endpoints must charge the canonical remaining-time
  // price, rather than the v2 flat-five fallback.
  db.prepare('UPDATE companies SET simboosts = 1000 WHERE company_id = ?').run(companyId);
  buildingRepository.updateBusyUntil(constructRes.building.id, companyId,
    new Date(virtualClock.nowMs() + 48 * 3600 * 1000).toISOString());
  const rushedConstruction = await rushBuildingConstructionUseCase(ctx, { buildingId: constructRes.building.id });
  assert.equal(rushedConstruction.simboostsRemaining, 520, '48h construction costs 480 SimBoosts');
  assert.equal(rushedConstruction.building.busyUntil, null);
  await assert.rejects(rushBuildingConstructionUseCase(ctx, { buildingId: constructRes.building.id }), /not under construction/);
  assert.equal((db.prepare('SELECT simboosts FROM companies WHERE company_id = ?')
    .get(companyId) as { simboosts: number }).simboosts, 520, 'repeat rush cannot charge again');

  // Issue #213: reject an upgrade past level 15 before charging cash or
  // consuming construction materials.
  buildingRepository.updateSize(constructRes.building.id, companyId, 15);
  buildingRepository.updateBusyUntil(constructRes.building.id, companyId, null);
  await assert.rejects(
    upgradeBuildingUseCase(ctx, { buildingId: constructRes.building.id, sizeDelta: 1 }),
    /between 1 and 15/
  );
  buildingRepository.updateSize(constructRes.building.id, companyId, 1);

  // A robotized building cannot be demolished, and uninstall refunds retain
  // the install-time inventory cost basis in their Q0 warehouse return.
  buildingRepository.updateSize(constructRes.building.id, companyId, 4);
  buildingRepository.updateBusyUntil(constructRes.building.id, companyId, null);
  db.prepare('DELETE FROM warehouse WHERE company_id = ? AND kind = 114').run(companyId);
  warehouseRepository.addResource(companyId, 114, 1, 4, {
    workers: 3,
    admin: 4,
    material1: 5,
    material2: 6,
    market: 42.5
  });
  const installedRobots = await installRobotsUseCase(ctx, {
    buildingId: constructRes.building.id,
    kind: 3
  });
  assert.equal(installedRobots.building.robotInstallCostSnapshots?.length, 1);
  const auditCountBeforeRejectedDemolish = (db.prepare(`
    SELECT COUNT(*) AS count FROM audits WHERE actor_company_id = ? AND action = 'demolish_building'
  `).get(companyId) as { count: number }).count;
  await assert.rejects(
    demolishBuildingUseCase(ctx, constructRes.building.id),
    /robots installed/i
  );
  assert.ok(buildingRepository.findById(constructRes.building.id), 'Rejected demolition preserves the robotized building');
  assert.equal((db.prepare(`
    SELECT COUNT(*) AS count FROM audits WHERE actor_company_id = ? AND action = 'demolish_building'
  `).get(companyId) as { count: number }).count, auditCountBeforeRejectedDemolish);
  const uninstall = await uninstallRobotsUseCase(ctx, constructRes.building.id);
  assert.equal(uninstall.returnedRobots, 2);
  const returnedRobotStock = warehouseRepository.findByCompanyAndResource(companyId, 114, 0);
  assert.equal(returnedRobotStock?.amount, 2);
  assert.equal(returnedRobotStock?.costWorkers, 3);
  assert.equal(returnedRobotStock?.costAdmin, 4);
  assert.equal(returnedRobotStock?.costMaterial1, 5);
  assert.equal(returnedRobotStock?.costMaterial2, 6);
  assert.equal(returnedRobotStock?.costMarket, 42.5);
  assert.equal(uninstall.building.robotInstallCostSnapshots, null);
  buildingRepository.updateSize(constructRes.building.id, companyId, 1);

  const buildingDTO = toSimCompaniesBuildingDTO(constructRes.building);
  assert.strictEqual(buildingDTO.position, '2');
  assert.strictEqual(buildingDTO.level, 1);

  // 4. Test Upgrade Building (clear construction busy state for test progression)
  buildingRepository.updateBusyUntil(constructRes.building.id, companyId, null);
  const upgradeRes = await upgradeBuildingUseCase(ctx, {
    buildingId: constructRes.building.id,
    sizeDelta: 2
  });
  assert.strictEqual(upgradeRes.building.size, 3, 'Building size should now be 3');

  // 5. Test Start Production (clear upgrade busy state for test progression)
  buildingRepository.updateBusyUntil(constructRes.building.id, companyId, null);
  assert.strictEqual(upgradeRes.building.size, 3, 'Building size should now be 3');

  // 5. Test Start Production (e.g. Apples: kind 3 requires Power: kind 2 & Seeds: kind 66)
  const initialSeeds = warehouseRepository.findByCompanyAndResource(companyId, 66)?.amount ?? 0;
  const startProdRes = await startProductionUseCase(ctx, {
    buildingId: constructRes.building.id,
    kind: 3, // Apples
    amount: 1000
  });
  assert.strictEqual(startProdRes.queueItem.kind, 3);
  await assert.rejects(rushBuildingConstructionUseCase(ctx, { buildingId: constructRes.building.id }), /Use production rush/);
  assert.equal((db.prepare('SELECT simboosts FROM companies WHERE company_id = ?')
    .get(companyId) as { simboosts: number }).simboosts, 520, 'construction rush cannot bypass a production queue');
  assert(Number.isFinite(startProdRes.queueItem.productionOutputMultiplier));
  assert.strictEqual(
    startProdRes.queueItem.amount,
    Math.round(1000 * startProdRes.queueItem.productionOutputMultiplier),
    'queued output must persist the amount adjusted by its captured production multiplier'
  );

  const startDTO = toSimCompaniesStartProductionDTO(startProdRes);
  assert.strictEqual(startDTO.message, 'Production started successfully');
  assert(startDTO.resourceTransactions.length > 0, 'Must record ingredient consumption transactions');

  const postSeeds = warehouseRepository.findByCompanyAndResource(companyId, 66)?.amount ?? 0;
  assert(postSeeds < initialSeeds, 'Seeds must be consumed for apple production');

  // 6. Test Query Production Queue
  const queue = await getProductionQueueUseCase(ctx, constructRes.building.id);
  assert.strictEqual(queue.length, 1, 'Building must have 1 active queue item');

  // 7. Test Cancel Production -> refunds seeds
  const cancelRes = await cancelProductionUseCase(ctx, {
    buildingId: constructRes.building.id,
    queueId: startProdRes.queueItem.id
  });
  assert.strictEqual(cancelRes.cancelledItem.id, startProdRes.queueItem.id);

  const refundedSeeds = warehouseRepository.findByCompanyAndResource(companyId, 66)?.amount ?? 0;
  assert.strictEqual(refundedSeeds, initialSeeds, 'Seeds must be fully refunded upon cancelling production');

  // 8. Test Start Production & Collect Finished Order
  const secondProdRes = await startProductionUseCase(ctx, {
    buildingId: constructRes.building.id,
    kind: 3,
    amount: 500
  });
  const expectedOutput = Math.max(1, Math.round(500 * secondProdRes.queueItem.productionOutputMultiplier));
  assert.strictEqual(secondProdRes.queueItem.amount, expectedOutput, 'queued output reflects its persisted production multiplier');

  // Fast-forward completion time to simulate finished production
  productionRepository.finishImmediately(secondProdRes.queueItem.id, companyId, new Date(Date.now() - 1000).toISOString());

  const initialApples = warehouseRepository.findByCompanyAndResource(companyId, 3)?.amount ?? 0;
  const collectRes = await collectProductionUseCase(ctx, {
    buildingOrQueueId: constructRes.building.id
  });
  assert.strictEqual(collectRes.collectedItem.amount, expectedOutput);

  const collectDTO = toSimCompaniesCollectProductionDTO(collectRes);
  assert.strictEqual(collectDTO.success, true);
  assert.strictEqual(collectDTO.resource.kind, 3);
  assert.strictEqual(collectDTO.resource.amount, expectedOutput);

  const postApples = warehouseRepository.findByCompanyAndResource(companyId, 3)?.amount ?? 0;
  assert.strictEqual(postApples, initialApples + expectedOutput, 'Apples must be credited to warehouse upon collect');

  // 9. Test Idempotency: Duplicate collect must throw error
  let duplicateCollectCaught = false;
  try {
    await collectProductionUseCase(ctx, {
      buildingOrQueueId: constructRes.building.id
    });
  } catch (err: unknown) {
    duplicateCollectCaught = true;
  }
  assert.strictEqual(duplicateCollectCaught, true, 'Duplicate collection attempt must be rejected');

  // 10. Test Rename Building
  const renameRes = await renameBuildingUseCase(ctx, constructRes.building.id, 'My Orchard');
  assert.strictEqual(renameRes.name, 'My Orchard');

  // 11. Test Demolish Building (Issue #94: refund is materials, not cash)
  const demolishRes = await demolishBuildingUseCase(ctx, constructRes.building.id);
  assert.strictEqual(demolishRes.demolishedBuilding.id, constructRes.building.id);
  assert.strictEqual(demolishRes.scrapValue, Math.floor(6900 * 3 * 0.5), 'Scrap value must be baseCost * size * 0.5');
  assert.strictEqual(demolishRes.refundMoney, undefined, 'Demolition must not refund cash');
  const farmScrap = demolishRes.refundMaterials.find(m => m.kind === 101);
  assert.strictEqual(farmScrap?.amount, Math.floor(4 * 2 * 3 * 0.5), 'Farm size-3 scrap must return 50% of qp * costUnits * size planks');
  const auditCountAfterDemolish = (db.prepare(`
    SELECT COUNT(*) AS count FROM audits WHERE actor_company_id = ? AND action = 'demolish_building'
  `).get(companyId) as { count: number }).count;
  assert.equal(auditCountAfterDemolish, auditCountBeforeRejectedDemolish + 1, 'A successful demolition records company-scoped achievement activity');

  console.log('✅ Production + Building Vertical Slice End-to-End tests passed successfully!');
}

testProductionBuildingVerticalSlice().catch(err => {
  console.error('❌ Vertical slice test failed:', err);
  process.exit(1);
});
