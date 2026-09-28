import assert from 'node:assert/strict';
import { createGameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { getAuthoritativeRetailPrice, calculateRetailDuration } from '../server/game-data/retail.ts';
import { getEconomyPhase } from '../server/application/scheduler/daily-jobs.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { startRetailOrderUseCase } from '../server/application/retail/retail-use-cases.ts';

async function verifyRetailPriceAndQualityAffectDuration() {
  const { playerId, companyId } = registerPlayer(
    `issue217-${Date.now()}@test.local`,
    'password123',
    `Issue 217 ${Date.now()}`
  );
  const ctx = createGameContext(companyId, playerId);
  const groceryStore = buildingRepository.findByCompany(companyId).find(building => building.kind === 'G');
  assert.ok(groceryStore, 'The company has its seeded grocery store');

  warehouseRepository.addResource(companyId, 3, 0, 100, { market: 1 });
  warehouseRepository.addResource(companyId, 3, 5, 100, { market: 1 });
  const economyState = getEconomyPhase(ctx.realmId).state;
  const lowPrice = getAuthoritativeRetailPrice(3, 0, undefined, 0.5, economyState).minPrice;
  const highPrice = getAuthoritativeRetailPrice(3, 5, undefined, 0.5, economyState).maxPrice;

  const lowOrder = await startRetailOrderUseCase(ctx, {
    buildingId: groceryStore.id,
    resource: 3,
    quality: 0,
    units: 100,
    sellingPrice: lowPrice
  });
  const highOrder = await startRetailOrderUseCase(ctx, {
    buildingId: groceryStore.id,
    resource: 3,
    quality: 5,
    units: 100,
    sellingPrice: highPrice
  });

  const lowDuration = Date.parse(lowOrder.salesOrder.finishedAt) - Date.parse(lowOrder.salesOrder.createdAt);
  const highDuration = Date.parse(highOrder.salesOrder.finishedAt) - Date.parse(highOrder.salesOrder.createdAt);
  const lowExpected = calculateRetailDuration(3, 100, groceryStore.size, {
    quality: 0, price: lowPrice, saturation: 0.5, buildingKind: groceryStore.kind, economyState
  });
  const highExpected = calculateRetailDuration(3, 100, groceryStore.size, {
    quality: 5, price: highPrice, saturation: 0.5, buildingKind: groceryStore.kind, economyState
  });

  assert.ok(Math.abs(lowDuration / 1000 - lowExpected) <= 1, 'Persisted low-price order uses the quality/price-aware duration');
  assert.ok(Math.abs(highDuration / 1000 - highExpected) <= 1, 'Persisted high-price order uses the quality/price-aware duration');
  assert.ok(highDuration > lowDuration, 'High quality at maximum price takes longer than Q0 at minimum price');
}

verifyRetailPriceAndQualityAffectDuration().then(() => {
  console.log('Issue #217 retail price and quality duration regression passed');
}).catch(error => {
  console.error('Issue #217 retail duration regression failed:', error);
  process.exitCode = 1;
});
