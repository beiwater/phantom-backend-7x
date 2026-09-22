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
  warehouseRepository.addResource(companyId, 2, 2, 300);
  warehouseRepository.addResource(companyId, 66, 3, 100);

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
    { kind: 2, amount: 300 },
    { kind: 66, amount: 100 }
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
  assert.equal(amount(companyId, 2, 2), 0);
  assert.equal(amount(companyId, 66, 3), 0);
  await assert.rejects(
    cancelProductionUseCase(ctx, { buildingId: farm.id, queueId: started.queueItem.id }),
    /no active cancellable production order/i
  );
  assert.equal(amount(companyId, 2, 0), 300);
  assert.equal(amount(companyId, 66, 0), 100);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
