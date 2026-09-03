import assert from 'node:assert/strict';
import { db } from '../server/db/connection.ts';
import {
  computeEconomyProductionModifier,
  getEconomyPhaseHistory,
  setEconomyPhase
} from '../server/application/scheduler/daily-jobs.ts';
import { calculateProductionTime } from '../server/game-data/buildings.ts';
import { productionRepository } from '../server/repositories/production-repository.ts';

const realmId = 183;
const companyId = 183;
const buildingId = 183;
const recessionStart = new Date('2036-01-04T15:00:00.000Z');
const normalStart = new Date('2036-01-11T15:00:00.000Z');
const boomStart = new Date('2036-01-18T15:00:00.000Z');

db.prepare('DELETE FROM production_queues WHERE company_id = ?').run(companyId);
db.prepare('DELETE FROM economy_phase_history WHERE realm_id = ?').run(realmId);
db.prepare('DELETE FROM economy_state WHERE realm_id = ?').run(realmId);

setEconomyPhase(realmId, 0, recessionStart, 'test');
setEconomyPhase(realmId, 1, normalStart, 'test');
setEconomyPhase(realmId, 2, boomStart, 'test');

const history = getEconomyPhaseHistory(realmId, 20, 0);
assert.equal(history.length, 3);
assert.ok(history.every(entry => entry.modifierSeed > 0), 'each cycle stores a reproducible seed');
assert.ok(history.every(entry => entry.modifierKind === 'bonus' || entry.modifierKind === 'malus' || entry.modifierKind === 'neutral'));
for (const entry of history) {
  const expected = computeEconomyProductionModifier(realmId, entry.state, entry.startAt);
  assert.equal(entry.modifierSeed, expected.seed);
  assert.equal(entry.productionModifier, expected.value);
}

const neutralDuration = calculateProductionTime(11, 100, 1, 0);
const bonusDuration = calculateProductionTime(11, 100, 1, 0.1);
const malusDuration = calculateProductionTime(11, 100, 1, -0.1);
assert.ok(bonusDuration < neutralDuration, 'positive production modifier shortens production');
assert.ok(malusDuration > neutralDuration, 'negative production modifier lengthens production');
assert.equal(calculateProductionTime(11, 100, 1, 20), calculateProductionTime(11, 100, 1, 3));
assert.equal(calculateProductionTime(11, 100, 1, -20), calculateProductionTime(11, 100, 1, -0.75));

const queue = productionRepository.create({
  buildingId,
  companyId,
  kind: 11,
  quality: 0,
  cost: 12.5,
  amount: 110,
  durationSeconds: bonusDuration,
  startedAt: boomStart.toISOString(),
  finishesAt: new Date(boomStart.getTime() + bonusDuration * 1000).toISOString(),
  economyPhase: 2,
  economyPhaseStartedAt: boomStart.toISOString(),
  economySource: 'test',
  productionModifier: 0.1,
  productionOutputMultiplier: 1.1
});
assert.equal(queue.economyPhase, 2);
assert.equal(queue.economyPhaseStartedAt, boomStart.toISOString());
assert.equal(queue.productionModifier, 0.1);
assert.equal(queue.productionOutputMultiplier, 1.1);
assert.equal(queue.amount, 110);
console.log('PASS deterministic economy modifiers, production timing, and queue snapshots (#183)');
