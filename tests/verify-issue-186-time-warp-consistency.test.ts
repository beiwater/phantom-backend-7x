import assert from 'node:assert/strict';
import { db } from '../server/db/connection.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { createGameContext } from '../server/context/game-context.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { retailRepository } from '../server/repositories/retail-repository.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { collectProductionUseCase } from '../server/application/production/collect-production.ts';
import { collectRetailOrderUseCase } from '../server/application/retail/retail-use-cases.ts';
import { toSimCompaniesBuildingDTO } from '../server/compatibility/simcompanies/building-dto.ts';
import { getRestaurantBusy } from '../server/game/restaurant.ts';
import { settleDueAuctions } from '../server/game/building-auctions.ts';

const company = db.prepare('SELECT company_id, realm_id FROM companies ORDER BY company_id LIMIT 1').get() as {
  company_id: number;
  realm_id: number;
};
const companyId = Number(company.company_id);
const realmId = Number(company.realm_id);
const context = createGameContext(companyId, companyId, realmId);
const otherRealmContext = createGameContext(companyId, companyId, realmId + 1);
const now = (): Date => virtualClock.now();
const iso = (): string => virtualClock.nowIso();

virtualClock.reset();
const baseMs = virtualClock.nowMs();
const initialOffset = virtualClock.getOffsetMs();
assert.equal(initialOffset, 0);
assert.equal(otherRealmContext.realmId, realmId + 1);

const insertBuilding = (kind: string, category: string, position: string, busyUntil: string | null = null): number => {
  const result = db.prepare(`
    INSERT INTO buildings (
      company_id, position, kind, size, name, cost, category, busy_until, created_at
    ) VALUES (?, ?, ?, 1, ?, 6900, ?, ?, ?)
  `).run(companyId, position, kind, kind === 'r' ? 'Restaurant' : 'Test building', category, busyUntil, iso());
  return Number(result.lastInsertRowid);
};

// Production completion reads the virtual clock, not Date.now().
const productionBuildingId = insertBuilding('P', 'production', 'issue-186-production');
const productionNow = now();
const productionQueue = db.prepare(`
  INSERT INTO production_queues (
    building_id, company_id, kind, quality, cost, amount, duration_seconds,
    started_at, finishes_at, resolved
  ) VALUES (?, ?, 3, 0, 0, 100, 3600, ?, ?, 0)
`).run(
  productionBuildingId,
  companyId,
  productionNow.toISOString(),
  new Date(productionNow.getTime() + 3600000).toISOString()
);
await assert.rejects(
  () => collectProductionUseCase(context, { buildingOrQueueId: Number(productionQueue.lastInsertRowid) }),
  /not finished/i
);
virtualClock.advance({ hours: 2 });
const collected = await collectProductionUseCase(context, { buildingOrQueueId: Number(productionQueue.lastInsertRowid) });
assert.equal(
  (db.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(Number(productionQueue.lastInsertRowid)) as { resolved: number }).resolved,
  1
);
assert.ok(virtualClock.nowMs() >= baseMs + 2 * 3600000);

// Construction DTO state flips only when the shared virtual clock passes busy_until.
const constructionBuildingId = insertBuilding(
  'P',
  'production',
  'issue-186-construction',
  new Date(virtualClock.nowMs() + 2 * 3600000).toISOString()
);
const constructionBuilding = buildingRepository.findById(constructionBuildingId);
assert.ok(constructionBuilding);
assert.equal(toSimCompaniesBuildingDTO(constructionBuilding!).isUnderConstruction, true);
virtualClock.advance({ hours: 3 });
const completedBuilding = buildingRepository.findById(constructionBuildingId);
assert.equal(toSimCompaniesBuildingDTO(completedBuilding!).isUnderConstruction, false);

// Retail fulfillment and restaurant reconstruction use the same warped now.
const salesBuildingId = insertBuilding('G', 'sales', 'issue-186-retail');
const retailStart = now();
db.prepare(`
  INSERT INTO warehouse (
    company_id, kind, quality, amount, cost_workers, cost_admin,
    cost_material1, cost_material2, cost_market, updated_at
  ) VALUES (?, 3, 0, 1, 0, 0, 0, 0, 1, ?)
`).run(companyId, iso());
const retailOrder = retailRepository.insert({
  buildingId: salesBuildingId,
  companyId,
  resourceKind: 3,
  quality: 0,
  units: 1,
  unitPrice: 2,
  cost: 1.5,
  createdAt: retailStart.toISOString(),
  finishedAt: new Date(retailStart.getTime() + 3600000).toISOString()
});
await assert.rejects(() => collectRetailOrderUseCase(context, retailOrder.id), /still in progress/i);
virtualClock.advance({ hours: 2 });
const retailResult = await collectRetailOrderUseCase(context, retailOrder.id);
assert.equal(retailResult.success, true);

const restaurantBuildingId = insertBuilding('r', 'sales', 'issue-186-restaurant');
db.prepare(`
  INSERT OR REPLACE INTO restaurant_properties (
    building_id, company_id, keep_open, menu_json, menu_price,
    reconstruction_started_at, reconstruction_until, updated_at
  ) VALUES (?, ?, 1, '[]', 60, ?, ?, ?)
`).run(
  restaurantBuildingId,
  companyId,
  iso(),
  new Date(virtualClock.nowMs() + 3600000).toISOString(),
  iso()
);
assert.ok(getRestaurantBusy(restaurantBuildingId));
virtualClock.advance({ hours: 2 });
assert.equal(getRestaurantBusy(restaurantBuildingId), null);

// Auction settlement's omitted timestamp argument is also virtual-clock based.
assert.deepEqual(await settleDueAuctions(), []);
assert.equal(virtualClock.nowMs() > baseMs, true);

virtualClock.reset();
console.log('PASS shared virtual time across production, construction, retail, restaurant, auction, and realms (#186)');
