import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import { runInTransaction } from '../server/db/transaction.ts';
import { registerPlayer } from '../server/db/seed/index.ts';

/**
 * Transaction manager contract: synchronous work, SAVEPOINT nesting,
 * after-commit hooks only on the outermost commit.
 */

function money(companyId: number): number {
  const row = db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number };
  return row.money;
}

function testAsyncWorkIsRejectedAndRolledBack() {
  const { companyId } = registerPlayer(`tx_async_${Date.now()}@test.local`, 'password123', `TxAsync ${Date.now()}`);
  const before = money(companyId);
  assert.throws(
    () => runInTransaction(async () => {
      db.prepare('UPDATE companies SET money = money - 100 WHERE company_id = ?').run(companyId);
    }),
    /must be synchronous/
  );
  assert.strictEqual(money(companyId), before, 'Writes made before the first await are rolled back');
  assert.strictEqual(db.isTransaction, false, 'No transaction is left open');
}

function testCaughtNestedFailureRollsBackOnlyItsSavepoint() {
  const { companyId } = registerPlayer(`tx_sp_${Date.now()}@test.local`, 'password123', `TxSp ${Date.now()}`);
  const before = money(companyId);
  const fired: string[] = [];

  runInTransaction(outer => {
    db.prepare('UPDATE companies SET money = money - 100 WHERE company_id = ?').run(companyId);
    outer.addAfterCommitHook(() => fired.push('outer'));
    try {
      runInTransaction(inner => {
        db.prepare('UPDATE companies SET money = money - 300 WHERE company_id = ?').run(companyId);
        inner.addAfterCommitHook(() => fired.push('failed-inner'));
        throw new Error('inner failure');
      });
    } catch {
      // Caller recovers; the outer transaction continues.
    }
    runInTransaction(inner => {
      db.prepare('UPDATE companies SET money = money - 50 WHERE company_id = ?').run(companyId);
      inner.addAfterCommitHook(() => fired.push('inner'));
    });
    assert.deepStrictEqual(fired, [], 'Hooks wait for the outermost commit');
  });

  assert.strictEqual(before - money(companyId), 150, 'Only the failed savepoint is undone');
  assert.deepStrictEqual(fired, ['outer', 'inner'], 'Hooks of the rolled-back savepoint are discarded');
}

function testUncaughtNestedFailureAbortsOuter() {
  const { companyId } = registerPlayer(`tx_nrb_${Date.now()}@test.local`, 'password123', `TxNrb ${Date.now()}`);
  const before = money(companyId);
  assert.throws(() => runInTransaction(() => {
    db.prepare('UPDATE companies SET money = money - 200 WHERE company_id = ?').run(companyId);
    runInTransaction(() => {
      db.prepare('UPDATE companies SET money = money - 300 WHERE company_id = ?').run(companyId);
      throw new Error('inner failure');
    });
  }), /inner failure/);
  assert.strictEqual(money(companyId), before, 'Outer rollback undoes all work');
}

function testRawTransactionIsDetected() {
  db.exec('BEGIN');
  try {
    assert.throws(() => runInTransaction(() => 1), /raw BEGIN/);
  } finally {
    db.exec('ROLLBACK');
  }
}

testAsyncWorkIsRejectedAndRolledBack();
console.log('PASS async work rejected and rolled back');
testCaughtNestedFailureRollsBackOnlyItsSavepoint();
console.log('PASS caught nested failure rolls back only its savepoint');
testUncaughtNestedFailureAbortsOuter();
console.log('PASS uncaught nested failure aborts outer');
testRawTransactionIsDetected();
console.log('PASS raw transaction detected');
process.exit(0);
