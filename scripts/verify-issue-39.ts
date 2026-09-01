// Verify #39: research quality cap drives production quality, legacy DB compat.
import assert from 'node:assert/strict';

const { applyResearch, getProductionQualityCap } = await import('../server/game/research.ts');
const { db } = await import('../server/db/database.ts');
const { startProductionUseCase } = await import('../server/application/production/start-production.ts');
const { collectProductionUseCase } = await import('../server/application/production/collect-production.ts');
const { createGameContext } = await import('../server/context/game-context.ts');
const COMPANY = 4259175; // exists in legacy DB / seeded
const KIND = 1;           // produced at E (Electronics factory) -> discipline 4
const ctx = createGameContext(COMPANY, COMPANY, 0);

// Self-contained baseline: clear pre-existing research for the test company.
db.prepare('DELETE FROM research WHERE company_id = ?').run(COMPANY);

// 1. No research rows -> cap 0
assert.equal(getProductionQualityCap(COMPANY, KIND), 0, 'no research rows -> cap 0');

// 2. applyResearch validation: non-positive / non-finite rejected
for (const bad of [0, -5, NaN, Infinity, 'x']) {
  await assert.rejects(() => applyResearch(COMPANY, 2, bad), /positive integer/, `rejects ${bad}`);
}

// 3. applyResearch then cap (kind 1 → discipline 2 → resource #30)
// Seed research stock so points can be applied (discipline 2 (Energy) consumes
// research resource #30 from the warehouse).
db.prepare(`
  INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
  VALUES (?, 30, 0, 100000, 0, 0, 0, 0, 1, ?)
  ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = 100000
`).run(COMPANY, new Date().toISOString());

const after = await applyResearch(COMPANY, 2, 100); // 100 pts -> 2 patents
assert.equal(after.research[2].patents, 2);
assert.equal(getProductionQualityCap(COMPANY, KIND), 0, '2 patents < first threshold (12) -> cap 0');

await applyResearch(COMPANY, 2, 500); // total 600 pts -> 12 patents -> cap 1
assert.equal(getProductionQualityCap(COMPANY, KIND), 1);

await applyResearch(COMPANY, 2, 5600); // total 6200 pts -> 124 patents -> cap 2
assert.equal(getProductionQualityCap(COMPANY, KIND), 2, 'cap follows cumulative patent thresholds');

// 4. queue + finish production: warehouse row quality == stored queue quality
const existing = db.prepare(`
  SELECT id FROM buildings WHERE company_id = ? AND kind = 'E' LIMIT 1
`).get(COMPANY);

let buildingId;
if (existing) {
  buildingId = existing.id;
} else {
  buildingId = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, 'q39', 'E', 1, 'QA39', 0, 'production', ?)
  `).run(COMPANY, new Date().toISOString()).lastInsertRowid;
}
db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(buildingId);
db.prepare('DELETE FROM production_queues WHERE company_id = ? AND kind = ?').run(COMPANY, KIND);
db.prepare('DELETE FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 2').run(COMPANY, KIND);

// Queue via the production use case, then fast-forward finishes_at so the
// collect use case picks it up.
// Requested quality is clamped by the research cap (Q2 after the research above).
const started = await startProductionUseCase(ctx, { buildingId, kind: KIND, amount: 10, quality: 12 });
db.prepare('UPDATE production_queues SET finishes_at = ? WHERE id = ?')
  .run(new Date(Date.now() - 1000).toISOString(), started.queueItem.id);

await collectProductionUseCase(ctx, { buildingOrQueueId: started.queueItem.id });

const wh = db.prepare(`
  SELECT amount, quality FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 2
`).get(COMPANY, KIND);
assert.ok(wh && wh.amount >= 10, 'warehouse row at the research-capped quality 2 exists with produced amount');
console.log('produced warehouse row:', JSON.stringify(wh));

// 5. Legacy compat: queue row inserted WITHOUT the quality column resolves into quality 0.
db.prepare('DELETE FROM production_queues').run();
db.prepare(`
  INSERT INTO production_queues (building_id, company_id, kind, amount, duration_seconds, started_at, finishes_at, resolved)
  VALUES (?, ?, ?, 5, 60, ?, ?, 0)
`).run(buildingId, COMPANY, KIND, new Date().toISOString(), new Date(Date.now() - 1000).toISOString());
const legacyQueueId = Number(db.prepare('SELECT id FROM production_queues ORDER BY id DESC LIMIT 1').get().id);
await collectProductionUseCase(ctx, { buildingOrQueueId: legacyQueueId });
const wh0 = db.prepare(`
  SELECT amount, quality FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 0
`).get(COMPANY, KIND);
assert.ok(wh0 && wh0.amount >= 5, 'legacy queue row (no quality col at insert) resolves into quality 0');
console.log('legacy-style queue resolved into quality 0 row:', JSON.stringify(wh0));

console.log('ALL CHECKS PASSED');
process.exit(0);
