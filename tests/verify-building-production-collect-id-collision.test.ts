import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'phantom-building-collect-'));
process.env.DATA_DIR = dataDir;

async function runVerification(): Promise<void> {
  const [{ db }, { runMigrations }, { createGameContext }, { collectProductionUseCase }] = await Promise.all([
    import('../server/db/connection.ts'),
    import('../server/db/migrations/index.ts'),
    import('../server/context/game-context.ts'),
    import('../server/application/production/collect-production.ts')
  ]);
  try {
    runMigrations(db);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO companies (company_id, player_id, name, money, level, experience, created_at)
      VALUES (90001, 90001, 'Collision Test Company', 100000, 1, 0, ?)
    `).run(now);
    const companyId = 90_001;
    const buildingId = 40_000;

    db.prepare(`
      INSERT INTO buildings (id, company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, ?, 'collision-1', 'f', 1, 'Factory', 0, 'production', ?)
    `).run(buildingId, companyId, now);
    db.prepare(`
      INSERT INTO production_queues (id, building_id, company_id, kind, quality, amount, duration_seconds, started_at, finishes_at, resolved)
      VALUES (?, ?, ?, 2, 0, 11, 60, ?, ?, 1)
    `).run(buildingId, buildingId, companyId, now, now);
    db.prepare(`
      INSERT INTO production_queues (building_id, company_id, kind, quality, amount, duration_seconds, started_at, finishes_at, resolved)
      VALUES (?, ?, 2, 0, 7, 60, ?, ?, 0)
    `).run(buildingId, companyId, now, new Date(Date.now() - 1000).toISOString());

    const activeQueue = db.prepare(`
      SELECT id FROM production_queues WHERE building_id = ? AND company_id = ? AND resolved = 0
    `).get(buildingId, companyId) as { id: number };
    assert.notEqual(activeQueue.id, buildingId, 'active queue and historical queue IDs must differ from building ID');

    const result = await collectProductionUseCase(createGameContext(companyId, 90001), {
      buildingOrQueueId: buildingId,
      preferBuildingId: true
    });
    assert.equal(result.collectedItem.id, activeQueue.id, 'collect must resolve the active building order');
    assert.equal(result.collectedItem.amount, 7);
    assert.equal(
      (db.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(activeQueue.id) as { resolved: number }).resolved,
      1,
      'the active order should be resolved'
    );
    assert.equal(
      (db.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(buildingId) as { resolved: number }).resolved,
      1,
      'the colliding historical queue should remain unchanged'
    );
    assert.equal(
      Number((db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 2 AND quality = 0').get(companyId) as { amount: number }).amount),
      7,
      'the active order output should be persisted exactly once'
    );
    await assert.rejects(
      collectProductionUseCase(createGameContext(companyId, 90001), { buildingOrQueueId: buildingId }),
      /already been collected/,
      'queue-first internal callers must continue to reject an already-resolved queue ID'
    );
    console.log('PASS building collect resolves its active queue when its ID collides with historical queue history');
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

runVerification().catch(error => {
  console.error('Building production collect collision verification failed:', error);
  process.exit(1);
});
