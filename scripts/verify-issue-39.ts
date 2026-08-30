// Verify #39: research quality cap drives production quality, legacy DB compat.
import assert from 'node:assert/strict';

const { applyResearch, getProductionQualityCap } = await import('../server/game/research.ts');
const { queueProduction, resolveFinishedProduction } = await import('../server/game/production.ts');
const { db } = await import('../server/db/database.ts');

const COMPANY = 4259175; // exists in legacy DB / seeded
const KIND = 1;           // produced at E (Electronics factory) -> discipline 4

// Self-contained baseline: clear pre-existing research for the test company.
db.prepare('DELETE FROM research WHERE company_id = ?').run(COMPANY);

// 1. No research rows -> cap 0
assert.equal(getProductionQualityCap(COMPANY, KIND), 0, 'no research rows -> cap 0');

// 2. applyResearch validation: non-positive / non-finite rejected
for (const bad of [0, -5, NaN, Infinity, 'x']) {
  assert.throws(() => applyResearch(COMPANY, 4, bad), /finite positive/, `rejects ${bad}`);
}

// 3. applyResearch then cap
const after = applyResearch(COMPANY, 4, 100); // 100 pts -> 2 patents -> cap 2
assert.equal(after.research[4].patents, 2);
assert.equal(getProductionQualityCap(COMPANY, KIND), 2);

applyResearch(COMPANY, 4, 500); // total 600 pts -> 12 patents -> cap 7
assert.equal(getProductionQualityCap(COMPANY, KIND), 7);

applyResearch(COMPANY, 4, 2000); // patents 52 -> floor(52/2)+1 = 27 -> cap 12
assert.equal(getProductionQualityCap(COMPANY, KIND), 12, 'cap clamped to 12');

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
db.prepare('DELETE FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 12').run(COMPANY, KIND);

// Queue via queueProduction, then fast-forward finishes_at so resolve picks it up.
const q = queueProduction(COMPANY, buildingId, KIND, 10);
db.prepare('UPDATE production_queues SET finishes_at = ? WHERE id = ?')
  .run(new Date(Date.now() - 1000).toISOString(), q.queue[0].id);

resolveFinishedProduction(COMPANY);

const wh = db.prepare(`
  SELECT amount, quality FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 12
`).get(COMPANY, KIND);
assert.ok(wh && wh.amount >= 10, 'warehouse row at quality 12 exists with produced amount');
console.log('produced warehouse row:', JSON.stringify(wh));

// 5. Legacy compat: queue row inserted WITHOUT the quality column resolves into quality 0.
db.prepare('DELETE FROM production_queues').run();
db.prepare(`
  INSERT INTO production_queues (building_id, company_id, kind, amount, duration_seconds, started_at, finishes_at, resolved)
  VALUES (?, ?, ?, 5, 60, ?, ?, 0)
`).run(buildingId, COMPANY, KIND, new Date().toISOString(), new Date(Date.now() - 1000).toISOString());
resolveFinishedProduction(COMPANY);
const wh0 = db.prepare(`
  SELECT amount, quality FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 0
`).get(COMPANY, KIND);
assert.ok(wh0 && wh0.amount >= 5, 'legacy queue row (no quality col at insert) resolves into quality 0');
console.log('legacy-style queue resolved into quality 0 row:', JSON.stringify(wh0));

console.log('ALL CHECKS PASSED');
process.exit(0);
