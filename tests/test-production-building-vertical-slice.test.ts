import assert from 'node:assert';
import { createGameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { constructBuildingUseCase } from '../server/application/buildings/construct-building.ts';
import { upgradeBuildingUseCase } from '../server/application/buildings/upgrade-building.ts';
import { renameBuildingUseCase } from '../server/application/buildings/rename-building.ts';
import { demolishBuildingUseCase } from '../server/application/buildings/demolish-building.ts';
import { getCompanyBuildingsUseCase } from '../server/application/buildings/get-buildings.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { cancelProductionUseCase } from '../server/application/production/cancel-production.ts';
import { collectProductionUseCase } from '../server/application/production/collect-production.ts';
import { getProductionQueueUseCase } from '../server/application/production/get-production-queue.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
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
  const { playerId, companyId } = registerPlayer(randomEmail, 'password123', 'SliceTest Co');
  const ctx = createGameContext(companyId, playerId, 0);

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
  assert.strictEqual(startProdRes.queueItem.amount, 1000);

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

  // Fast-forward completion time to simulate finished production
  productionRepository.finishImmediately(secondProdRes.queueItem.id, companyId, new Date(Date.now() - 1000).toISOString());

  const initialApples = warehouseRepository.findByCompanyAndResource(companyId, 3)?.amount ?? 0;
  const collectRes = await collectProductionUseCase(ctx, {
    buildingOrQueueId: constructRes.building.id
  });
  assert.strictEqual(collectRes.collectedItem.amount, 500);

  const collectDTO = toSimCompaniesCollectProductionDTO(collectRes);
  assert.strictEqual(collectDTO.success, true);
  assert.strictEqual(collectDTO.resource.kind, 3);
  assert.strictEqual(collectDTO.resource.amount, 500);

  const postApples = warehouseRepository.findByCompanyAndResource(companyId, 3)?.amount ?? 0;
  assert.strictEqual(postApples, initialApples + 500, 'Apples must be credited to warehouse upon collect');

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

  // 11. Test Demolish Building
  const demolishRes = await demolishBuildingUseCase(ctx, constructRes.building.id);
  assert.strictEqual(demolishRes.demolishedBuilding.id, constructRes.building.id);
  assert(demolishRes.refundMoney > 0, 'Demolition must refund money');

  console.log('✅ Production + Building Vertical Slice End-to-End tests passed successfully!');
}

testProductionBuildingVerticalSlice().catch(err => {
  console.error('❌ Vertical slice test failed:', err);
  process.exit(1);
});
