import assert from 'node:assert/strict';
import { createGameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { db } from '../server/db/database.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { cancelProductionUseCase } from '../server/application/production/cancel-production.ts';
import { upgradeBuildingUseCase } from '../server/application/buildings/upgrade-building.ts';
import { downgradeBuildingUseCase } from '../server/application/buildings/downgrade-building.ts';

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
  const other = registerPlayer(
    `production_refund_other_${Date.now()}@test.local`,
    'password123',
    'Production Refund Other Test'
  );
  const otherCtx = createGameContext(other.companyId, other.playerId, 0);
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

  await assert.rejects(
    cancelProductionUseCase(otherCtx, { buildingId: farm.id, queueId: started.queueItem.id }),
    /do not own|not found/i
  );
  assert.equal(amount(companyId, 2, 2), 0, 'foreign cancellation cannot refund another company\'s inputs');
  assert.equal(amount(companyId, 66, 3), 0);

  db.exec(`
    CREATE TRIGGER issue_227_abort_seed_refund
    BEFORE UPDATE OF amount ON warehouse
    WHEN NEW.company_id = ${companyId} AND NEW.kind = 66 AND NEW.quality = 0
    BEGIN SELECT RAISE(ABORT, 'issue 227 refund rollback probe'); END;
  `);
  try {
    await assert.rejects(
      cancelProductionUseCase(ctx, { buildingId: farm.id, queueId: started.queueItem.id }),
      /issue 227 refund rollback probe/
    );
  } finally {
    db.exec('DROP TRIGGER issue_227_abort_seed_refund');
  }
  assert.equal(amount(companyId, 2, 0), 0, 'partial input refund rolls back with the failed ingredient write');
  assert.equal(amount(companyId, 66, 0), 0);
  assert.equal(
    (db.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(started.queueItem.id) as { resolved: number }).resolved,
    0,
    'failed refund leaves the queue cancellable'
  );

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
  assert.equal(
    300 * waterCost.market + 100 * seedCost.market,
    1425,
    'returned Q0 inventory preserves the finance snapshot valuation of consumed inputs'
  );
  assert.equal(
    db.prepare(`SELECT SUM(amount * cost_market) AS value FROM warehouse
      WHERE company_id = ? AND (kind, quality) IN ((2, 0), (66, 0))`).get(companyId)?.value,
    1425
  );
  assert.equal(amount(companyId, 2, 2), 0);
  assert.equal(amount(companyId, 66, 3), 0);
  await assert.rejects(
    cancelProductionUseCase(ctx, { buildingId: farm.id, queueId: started.queueItem.id }),
    /no active cancellable production order/i
  );
  assert.equal(amount(companyId, 2, 0), 300);
  assert.equal(amount(companyId, 66, 0), 100);

  // A partial downgrade refunds half of the exact construction-material cost
  // snapshot. Inject a failure after the first refund to prove transaction
  // rollback, then verify quantities, all cost buckets, and market valuation.
  const constructionCosts = new Map([
    [101, { workers: 1, admin: 2, material1: 3, material2: 4, market: 5 }],
    [102, { workers: 6, admin: 7, material1: 8, material2: 9, market: 10 }],
    [108, { workers: 11, admin: 12, material1: 13, material2: 14, market: 15 }],
    [111, { workers: 16, admin: 17, material1: 18, material2: 19, market: 20 }]
  ]);
  const upgradeInputs = new Map([[101, 8], [102, 110], [108, 32], [111, 2]]);
  for (const [kind, costs] of constructionCosts) {
    const changed = db.prepare(`
      UPDATE warehouse SET amount = ?, cost_workers = ?, cost_admin = ?,
        cost_material1 = ?, cost_material2 = ?, cost_market = ?
      WHERE company_id = ? AND kind = ? AND quality = 0
    `).run(upgradeInputs.get(kind), costs.workers, costs.admin, costs.material1, costs.material2, costs.market, companyId, kind);
    assert.equal(changed.changes, 1, `seeded construction input ${kind} exists`);
  }
  buildingRepository.updateBusyUntil(farm.id, companyId, null);
  const upgraded = await upgradeBuildingUseCase(ctx, { buildingId: farm.id, sizeDelta: 1 });
  assert.equal(upgraded.building.size, 2);
  buildingRepository.updateBusyUntil(farm.id, companyId, null);

  const beforeForeignDowngrade = warehouseRepository.findByCompany(companyId)
    .filter(item => constructionCosts.has(item.kind));
  const beforeFailedDowngrade = new Map([...constructionCosts.keys()].map(kind => [
    kind,
    warehouseRepository.findByCompanyAndResource(companyId, kind, 0)
  ]));
  await assert.rejects(
    downgradeBuildingUseCase(otherCtx, { buildingId: farm.id, sizeReduction: 1 }),
    /do not own/i
  );
  assert.equal(buildingRepository.findById(farm.id)?.size, 2);
  assert.deepEqual(
    warehouseRepository.findByCompany(companyId).filter(item => constructionCosts.has(item.kind)),
    beforeForeignDowngrade
  );

  db.exec(`
    CREATE TRIGGER issue_227_abort_brick_refund
    BEFORE UPDATE OF amount ON warehouse
    WHEN NEW.company_id = ${companyId} AND NEW.kind = 102 AND NEW.quality = 0
    BEGIN SELECT RAISE(ABORT, 'issue 227 downgrade rollback probe'); END;
  `);
  try {
    await assert.rejects(
      downgradeBuildingUseCase(ctx, { buildingId: farm.id, sizeReduction: 1 }),
      /issue 227 downgrade rollback probe/
    );
  } finally {
    db.exec('DROP TRIGGER issue_227_abort_brick_refund');
  }
  assert.equal(buildingRepository.findById(farm.id)?.size, 2, 'failed refund leaves the building level unchanged');
  for (const kind of constructionCosts.keys()) {
    assert.deepEqual(
      warehouseRepository.findByCompanyAndResource(companyId, kind, 0),
      beforeFailedDowngrade.get(kind),
      `failed refund preserves resource ${kind} quantity and all five cost buckets`
    );
  }

  const downgraded = await downgradeBuildingUseCase(ctx, { buildingId: farm.id, sizeReduction: 1 });
  assert.equal(downgraded.building.size, 1);
  assert.deepEqual(downgraded.refundMaterials, [
    { kind: 101, amount: 4 },
    { kind: 102, amount: 55 },
    { kind: 108, amount: 16 },
    { kind: 111, amount: 1 }
  ]);
  for (const [kind, costs] of constructionCosts) {
    const refunded = warehouseRepository.findByCompanyAndResource(companyId, kind, 0);
    assert.equal(refunded?.amount, upgradeInputs.get(kind) / 2);
    assert.equal(refunded?.costWorkers, costs.workers);
    assert.equal(refunded?.costAdmin, costs.admin);
    assert.equal(refunded?.costMaterial1, costs.material1);
    assert.equal(refunded?.costMaterial2, costs.material2);
    assert.equal(refunded?.costMarket, costs.market);
  }
  assert.equal(
    db.prepare(`SELECT SUM(amount * cost_market) AS value FROM warehouse
      WHERE company_id = ? AND kind IN (101, 102, 108, 111) AND quality = 0`).get(companyId)?.value,
    830,
    'downgrade refunds restore original warehouse market valuation'
  );

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
