import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { createGameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { demolishBuildingUseCase } from '../server/application/buildings/demolish-building.ts';
import { getAchievementStats } from '../server/game/achievements.ts';

const { companyId, playerId } = registerPlayer(
  `issue219-${Date.now()}@test.local`,
  'password123',
  `Issue 219 ${Date.now()}`
);

db.prepare('INSERT INTO research (company_id, discipline, points, patents) VALUES (?, ?, 0, ?)').run(companyId, 1, 12);
db.prepare('INSERT INTO research (company_id, discipline, points, patents) VALUES (?, ?, 0, ?)').run(companyId, 2, 12);
db.prepare(`
  INSERT INTO government_bid_contractors (bid_secret, company_id, fulfilled)
  VALUES ('issue219-completed-bid', ?, 1)
`).run(companyId);
const building = db.prepare('SELECT id FROM buildings WHERE company_id = ? LIMIT 1').get(companyId) as { id: number };
db.prepare(`
  INSERT INTO production_queues (building_id, company_id, kind, amount, started_at, resolved)
  VALUES (?, ?, 3, 1, ?, 1)
`).run(building.id, companyId, virtualClock.nowIso());
await demolishBuildingUseCase(createGameContext(companyId, playerId, 0), building.id);

const stats = getAchievementStats(companyId);
assert.equal(stats.maxResearchQuality, 1, 'Research quality is derived from patents');
assert.ok(stats.researchedQ1Count > 2, 'Q1 research counts products covered by researched disciplines');
assert.equal(stats.governmentOrdersCompleted, 1, 'Completed contractor shares count as government orders');
assert.equal(stats.prospectorCount, 1, 'Demolition activity is company-scoped through audits');
assert.ok(stats.todayActivity >= 1, 'Recent production reads production_queues.started_at');

console.log('Issue #219 achievement stats regression passed');
