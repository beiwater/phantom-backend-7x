import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { createGameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { getEconomyPhase } from '../server/application/scheduler/daily-jobs.ts';
import { calculateProductionTime } from '../server/game-data/buildings.ts';
import { toSimCompaniesStartProductionDTO, toSimCompaniesQueueDTO } from '../server/compatibility/simcompanies/production-dto.ts';

const neutral = calculateProductionTime(3, 100, 1, 0);
const positive = calculateProductionTime(3, 100, 1, 0.25);
const negative = calculateProductionTime(3, 100, 1, -0.25);
assert.ok(positive < neutral, 'positive production bonus must shorten duration');
assert.ok(negative > neutral, 'negative production malus must lengthen duration');
assert.equal(calculateProductionTime(3, 100, 1, 20), calculateProductionTime(3, 100, 1, 3));
assert.equal(calculateProductionTime(3, 100, 1, -20), calculateProductionTime(3, 100, 1, -0.75));

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const { companyId, playerId } = registerPlayer(
  `issue190_${suffix}@test.local`,
  'password123',
  `Issue 190 production ${suffix}`
);
db.prepare('UPDATE companies SET money = 1000000, level = 30 WHERE company_id = ?').run(companyId);
warehouseRepository.addResource(companyId, 2, 0, 1_000);
warehouseRepository.addResource(companyId, 66, 0, 1_000);
const beforeSeeds = warehouseRepository.findByCompanyAndResource(companyId, 66)?.amount ?? 0;
const context = createGameContext(companyId, playerId, 0);
const farm = buildingRepository.findByCompany(companyId).find(building => building.kind === 'P');
assert.ok(farm);
const economy = getEconomyPhase(context.realmId);
const result = await startProductionUseCase(context, { buildingId: farm!.id, kind: 3, amount: 100 });
const expectedDuration = calculateProductionTime(
  3,
  100,
  farm!.size,
  0, // Original client: neutral company slider, with salary phase below (#199).
  { economyState: economy.state }
);
assert.equal(result.queueItem.durationSeconds, expectedDuration);

const started = toSimCompaniesStartProductionDTO(result);
assert.equal(started.id, result.queueItem.id);
assert.equal(started.duration, result.queueItem.durationSeconds);
assert.equal(started.startedAt, result.queueItem.startedAt);
assert.equal(started.finishesAt, result.queueItem.finishesAt);
assert.equal(started.queueItem.id, result.queueItem.id);
assert.equal(started.queueItem.duration, result.queueItem.durationSeconds);
assert.equal(started.queueItem.started, result.queueItem.startedAt);
assert.equal(started.queueItem.finishes, result.queueItem.finishesAt);

const refreshed = toSimCompaniesQueueDTO([result.queueItem])[0];
assert.equal(refreshed.duration, started.duration);
assert.equal(refreshed.started, started.startedAt);
assert.equal(refreshed.finishes, started.finishesAt);
assert.equal(
  Number((db.prepare('SELECT duration_seconds FROM production_queues WHERE id = ?').get(result.queueItem.id) as { duration_seconds: number }).duration_seconds),
  started.duration
);
assert.ok((warehouseRepository.findByCompanyAndResource(companyId, 66)?.amount ?? 0) < beforeSeeds);

// Product quality is on the Q0-Q12 scale; it must not be fed into the
// encyclopedia's separate 0-100 mining percentage. Otherwise Q0 collapses
// to the 60s zero-rate fallback and higher product quality distorts duration.
warehouseRepository.addResource(companyId, 1, 0, 100_000);
warehouseRepository.addResource(companyId, 2, 0, 10_000);
const miningBuilding = (position: string) => buildingRepository.create({
  companyId,
  position,
  kind: 'M',
  size: 1,
  name: `Issue 212 ${position}`,
  cost: 100_000,
  category: 'production',
  createdAt: new Date().toISOString()
});
const mineQ0 = miningBuilding('issue212-q0');
const mineQ12 = miningBuilding('issue212-q12');
const miningQ0 = await startProductionUseCase(context, {
  buildingId: mineQ0.id,
  kind: 42,
  amount: 1_000,
  quality: 0
});
const miningQ12 = await startProductionUseCase(context, {
  buildingId: mineQ12.id,
  kind: 42,
  amount: 1_000,
  quality: 12
});
assert.equal(
  miningQ0.queueItem.durationSeconds,
  miningQ12.queueItem.durationSeconds,
  'requested product quality must not change the mining-rate percentage'
);
assert.equal(
  miningQ0.queueItem.durationSeconds,
  calculateProductionTime(42, 1_000, 1, 0, { economyState: economy.state }),
  'mine duration uses the default 100% mining rate for all product quality levels'
);

console.log('PASS production preview/creation/queue DTOs share authoritative duration and timestamps (#190)');
