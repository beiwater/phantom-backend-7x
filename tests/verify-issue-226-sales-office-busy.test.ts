import assert from 'node:assert/strict';
import { createGameContext } from '../server/context/game-context.ts';
import { db } from '../server/db/database.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { findSalesOfficeCustomerUseCase, getSalesOfficeSearchFee } from '../server/application/retail/retail-use-cases.ts';

async function verifySalesOfficeBusyReservation() {
  const { playerId, companyId } = registerPlayer(
    `issue226-${Date.now()}@test.local`,
    'password123',
    `Issue 226 ${Date.now()}`
  );
  const ctx = createGameContext(companyId, playerId);
  const office = buildingRepository.create({
    companyId,
    position: '2',
    kind: 'B',
    size: 1,
    name: 'Sales Office',
    cost: 69000,
    category: 'sales',
    createdAt: virtualClock.nowIso()
  });
  const startingMoney = companyRepository.findById(companyId)?.money;

  // Both calls observe the initially idle office before SQLite serializes the
  // transactions. Only the first transaction may reserve it and charge the fee.
  const results = await Promise.allSettled([
    findSalesOfficeCustomerUseCase(ctx, office.id),
    findSalesOfficeCustomerUseCase(ctx, office.id)
  ]);
  const successful = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(successful.length, 1, 'Exactly one concurrent customer search succeeds');
  assert.equal(rejected.length, 1, 'The other concurrent customer search sees the busy reservation');

  const orderCount = (db.prepare('SELECT COUNT(*) AS count FROM retail_orders WHERE company_id = ? AND building_id = ?')
    .get(companyId, office.id) as { count: number }).count;
  const feeCount = (db.prepare("SELECT COUNT(*) AS count FROM cash_ledger WHERE company_id = ? AND description = 'Customer search'")
    .get(companyId) as { count: number }).count;
  const updatedOffice = buildingRepository.findById(office.id);
  assert.equal(orderCount, 1, 'A single search order is persisted');
  assert.equal(feeCount, 1, 'The search fee is charged exactly once');
  assert.ok(updatedOffice?.busyUntil, 'The office has a persisted busy_until after search starts');
  assert.ok(Date.parse(updatedOffice.busyUntil) > virtualClock.nowMs(), 'The busy reservation lasts until the search completes');
  assert.equal(
    companyRepository.findById(companyId)?.money,
    Number(startingMoney) - getSalesOfficeSearchFee(office.size),
    'The single successful search charges one size-based fee'
  );
}

verifySalesOfficeBusyReservation().then(() => {
  console.log('Issue #226 sales-office busy reservation regression passed');
}).catch(error => {
  console.error('Issue #226 sales-office busy reservation regression failed:', error);
  process.exitCode = 1;
});
