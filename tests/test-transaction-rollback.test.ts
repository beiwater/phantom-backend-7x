import assert from 'node:assert';
import { db } from '../server/db/connection.ts';
import { runInTransaction } from '../server/db/transaction.ts';
import { eventBus } from '../server/events/event-bus.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { registerPlayer } from '../server/db/seed/index.ts';

async function testTransactionCommitAndRollback() {
  console.log('--- Testing Transaction Commit, Rollback, and Event Hooks ---');

  // Setup test company
  const randomEmail = `tx_test_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.local`;
  const { companyId } = registerPlayer(randomEmail, 'password123', 'TxTest Co');

  const initialCompany = companyRepository.findById(companyId);
  assert(initialCompany, 'Company must exist');
  const initialMoney = initialCompany.money;

  let eventEmittedCount = 0;
  const unsubscribe = eventBus.subscribe('BuildingConstructed', () => {
    eventEmittedCount++;
  });

  // 1. Test Successful Transaction Commit
  await runInTransaction(async txCtx => {
    companyRepository.debitMoney(companyId, 500);
    eventBus.publishCommitted(txCtx, 'BuildingConstructed', {
      companyId,
      buildingId: 999,
      kind: 'P',
      position: '99',
      cost: 500
    });
  });

  const afterCommitCompany = companyRepository.findById(companyId);
  assert.strictEqual(afterCommitCompany?.money, initialMoney - 500, 'Money must be debited after commit');
  assert.strictEqual(eventEmittedCount, 1, 'Event hook must fire exactly once after successful commit');

  // 2. Test Transaction Rollback
  let rollbackErrorCaught = false;
  try {
    await runInTransaction(async txCtx => {
      companyRepository.debitMoney(companyId, 1000);
      eventBus.publishCommitted(txCtx, 'BuildingConstructed', {
        companyId,
        buildingId: 998,
        kind: 'G',
        position: '98',
        cost: 1000
      });
      throw new Error('Simulated business failure mid-transaction');
    });
  } catch (err: unknown) {
    rollbackErrorCaught = true;
  }

  assert.strictEqual(rollbackErrorCaught, true, 'Error must be thrown out of transaction');
  const afterRollbackCompany = companyRepository.findById(companyId);
  assert.strictEqual(afterRollbackCompany?.money, initialMoney - 500, 'Money balance must be restored on rollback');
  assert.strictEqual(eventEmittedCount, 1, 'Event count must STILL be 1 because rollback discards all hooks');

  unsubscribe();
  console.log('✅ Transaction Commit, Rollback, and Event Hooks tests passed successfully!');
}

testTransactionCommitAndRollback().catch(err => {
  console.error('❌ Transaction test failed:', err);
  process.exit(1);
});
