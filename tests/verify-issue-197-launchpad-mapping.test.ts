import assert from 'node:assert/strict';
import { db } from '../server/db/connection.ts';
import { createGameContext } from '../server/context/game-context.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { productionRepository } from '../server/repositories/production-repository.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { toSimCompaniesBuildingDTO } from '../server/compatibility/simcompanies/building-dto.ts';
import { toSimCompaniesQueueDTO } from '../server/compatibility/simcompanies/production-dto.ts';

const company = db.prepare('SELECT company_id, realm_id FROM companies ORDER BY company_id LIMIT 1').get() as {
  company_id: number;
  realm_id: number;
};
const companyId = Number(company.company_id);
const context = createGameContext(companyId, companyId, Number(company.realm_id));
const now = new Date().toISOString();

const insertBuilding = (size: number, position: string): number => {
  const result = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, 'l', ?, 'Launch Pad', 124200, 'research', ?)
  `).run(companyId, position, size, now);
  return Number(result.lastInsertRowid);
};
const insertWarehouse = (kind: number, amount: number): void => {
  db.prepare(`
    INSERT INTO warehouse (
      company_id, kind, quality, amount, cost_workers, cost_admin,
      cost_material1, cost_material2, cost_market, updated_at
    ) VALUES (?, ?, 0, ?, 0, 0, 0, 0, 0, ?)
  `).run(companyId, kind, amount, now);
};

const launchPad = insertBuilding(3, 'issue-197-main');
insertWarehouse(91, 1);
const sor = await startProductionUseCase(context, { buildingId: launchPad, kind: 91, amount: 1 });
assert.equal(sor.queueItem.kind, 100, 'persistence may retain the legacy queue marker');
assert.deepEqual(sor.resourceTransactions.map(tx => ({ kind: tx.kind, amount: tx.amount })), [{ kind: 91, amount: -1 }]);
assert.equal(
  (db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM warehouse WHERE company_id = ? AND kind = 100').get(companyId) as { amount: number }).amount,
  0,
  'launching a product-kind card must not debit Aerospace Research'
);

const sorBuilding = buildingRepository.findById(launchPad);
assert.ok(sorBuilding);
const sorDto = toSimCompaniesBuildingDTO(sorBuilding!);
const sorBusy = sorDto.busy as { resource?: { kind?: number; name?: string; amount?: number; image?: string } };
assert.equal(sorBusy.resource?.kind, 91);
assert.equal(sorBusy.resource?.name, 'Sub-orbital rocket');
assert.equal(sorBusy.resource?.amount, 1);
assert.ok(sorBusy.resource?.image?.includes('sub-orbital-rocket'));

insertWarehouse(94, 1);
const bfr = await startProductionUseCase(context, { buildingId: launchPad, kind: 94, amount: 1 });
assert.deepEqual(bfr.resourceTransactions.map(tx => ({ kind: tx.kind, amount: tx.amount })), [{ kind: 94, amount: -1 }]);
const queue = toSimCompaniesQueueDTO(productionRepository.findActiveByBuilding(launchPad, companyId));
assert.deepEqual(queue.map(item => item.resource?.kind), [91, 94]);
assert.deepEqual(queue.map(item => item.resource?.name), ['Sub-orbital rocket', 'BFR']);

const researchOnlyPad = insertBuilding(1, 'issue-197-research-only');
insertWarehouse(100, 5000);
await assert.rejects(
  () => startProductionUseCase(context, { buildingId: researchOnlyPad, kind: 91, amount: 1 }),
  error => error instanceof Error && /Insufficient rocket inventory/i.test(error.message) && !/Aerospace Research/i.test(error.message)
);
console.log('PASS launchpad product-kind requirements, DTO mapping, and rocket-only shortage errors (#197)');
