import assert from 'node:assert/strict';
import { createGameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { db } from '../server/db/database.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { cancelProductionUseCase } from '../server/application/production/cancel-production.ts';

function amount(companyId: number, kind: number, quality: number): number {
  return warehouseRepository.findByCompanyAndResource(companyId, kind, quality)?.amount ?? 0;
}

async function run(): Promise<void> {
  const { playerId, companyId } = registerPlayer(
    `production_refund_${Date.now()}@test.local`,
    'password123',
    'Production Refund Test'
  );
  const ctx = createGameContext(companyId, playerId, 0);
  const farm = buildingRepository.findByCompany(companyId).find(building => building.kind === 'P');
  assert.ok(farm, 'Starter farm is required');

  // The recipe for 100 apples consumes 300 water and 100 seeds. The original
  // client promises a Q0 refund even if those inputs came from higher quality.
  db.prepare('UPDATE warehouse SET amount = 0 WHERE company_id = ? AND kind IN (2, 66)').run(companyId);
  const waterCost = { workers: 0.5, admin: 0.25, material1: 0.1, material2: 0.05, market: 2.25 };
  const seedCost = { workers: 4.5, admin: 0.75, material1: 0.25, material2: 0.1, market: 7.5 };
  warehouseRepository.addResource(companyId, 2, 2, 300, waterCost);
  warehouseRepository.addResource(companyId, 66, 3, 100, seedCost);

  const started = await startProductionUseCase(ctx, {
    buildingId: farm.id,
    kind: 3,
    amount: 100
  });
  assert.equal(amount(companyId, 2, 2), 0);
  assert.equal(amount(companyId, 66, 3), 0);
  const snapshot = db.prepare('SELECT input_ingredients_json FROM production_queues WHERE id = ?')
    .get(started.queueItem.id) as { input_ingredients_json: string };
  assert.deepEqual(JSON.parse(snapshot.input_ingredients_json), [
    { kind: 2, amount: 300, cost: waterCost },
    { kind: 66, amount: 100, cost: seedCost }
  ]);

  // Extractor abundance and economy phases can change queued output without
  // changing inputs. Simulate a 50% output so cancellation cannot infer inputs
  // from the queue's output amount.
  db.prepare('UPDATE production_queues SET amount = 50 WHERE id = ?').run(started.queueItem.id);

  const cancelled = await cancelProductionUseCase(ctx, {
    buildingId: farm.id,
    queueId: started.queueItem.id
  });
  assert.deepEqual(
    cancelled.refundedIngredients.map(({ kind, quality, amount }) => ({ kind, quality, amount })),
    [
      { kind: 2, quality: 0, amount: 300 },
      { kind: 66, quality: 0, amount: 100 }
    ]
  );
  assert.equal(amount(companyId, 2, 0), 300);
  assert.equal(amount(companyId, 66, 0), 100);
  const refundedWater = warehouseRepository.findByCompanyAndResource(companyId, 2, 0);
  const refundedSeeds = warehouseRepository.findByCompanyAndResource(companyId, 66, 0);
  assert.equal(refundedWater?.costWorkers, waterCost.workers);
  assert.equal(refundedWater?.costAdmin, waterCost.admin);
  assert.equal(refundedWater?.costMaterial1, waterCost.material1);
  assert.equal(refundedWater?.costMaterial2, waterCost.material2);
  assert.equal(refundedWater?.costMarket, waterCost.market);
  assert.equal(refundedSeeds?.costWorkers, seedCost.workers);
  assert.equal(refundedSeeds?.costAdmin, seedCost.admin);
  assert.equal(refundedSeeds?.costMaterial1, seedCost.material1);
  assert.equal(refundedSeeds?.costMaterial2, seedCost.material2);
  assert.equal(refundedSeeds?.costMarket, seedCost.market);
  assert.equal(amount(companyId, 2, 2), 0);
  assert.equal(amount(companyId, 66, 3), 0);
  await assert.rejects(
    cancelProductionUseCase(ctx, { buildingId: farm.id, queueId: started.queueItem.id }),
    /no active cancellable production order/i
  );
  assert.equal(amount(companyId, 2, 0), 300);
  assert.equal(amount(companyId, 66, 0), 100);

  // Missing cost uses the same historical $1 market basis on insert and
  // merge; explicit zero remains a valid free-resource basis.
  db.prepare('DELETE FROM warehouse WHERE company_id = ? AND kind = 114 AND quality = 12').run(companyId);
  warehouseRepository.addResource(companyId, 114, 12, 100, { market: 50 });
  const mergedDefault = warehouseRepository.addResource(companyId, 114, 12, 100);
  assert.equal(mergedDefault.amount, 200);
  assert.equal(mergedDefault.costMarket, 25.5, '100 @ $50 plus 100 without cost averages to $25.50');
  const insertedDefault = warehouseRepository.addResource(companyId, 114, 11, 100);
  assert.equal(insertedDefault.costMarket, 1, 'new row without cost uses the same $1 default');
  const explicitFree = warehouseRepository.addResource(companyId, 114, 10, 100, { market: 0 });
  assert.equal(explicitFree.costMarket, 0, 'an explicit zero market basis is preserved');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
