import assert from 'node:assert';
import { db } from '../server/db/connection.ts';
import { runInTransaction } from '../server/db/transaction.ts';
import { registerPlayer } from '../server/db/seed/index.ts';

/**
 * Issue #176: transaction manager isolation under async concurrency.
 *
 * Deterministically manufactures await overlap between two concurrent
 * runInTransaction calls and asserts they are NOT merged into one nested
 * transaction, and that their after-commit hooks stay isolated.
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function countTxRows(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='__tx_probe__'").get() as { n: number };
  return row.n;
}

async function testConcurrentTransactionsAreIsolated() {
  const { companyId } = registerPlayer(`tx_iso_${Date.now()}@test.local`, 'password123', `TxIso ${Date.now()}`);
  db.exec('CREATE TABLE IF NOT EXISTS __tx_probe__ (id INTEGER PRIMARY KEY, label TEXT)');

  const order: string[] = [];
  const hooks: string[] = [];

  // A opens the transaction, registers a hook, then awaits INSIDE the work
  // callback — the exact overlap window that used to merge B into A.
  const pA = runInTransaction(async () => {
    order.push('A-begin');
    db.prepare("INSERT INTO __tx_probe__ (label) VALUES ('a')").run();
    runInTransaction(() => {
      order.push('A-hook-registered');
    }).then(() => undefined).catch(() => undefined);
    // eslint-disable-next-line require-atomic-updates
    await sleep(30);
    order.push('A-end');
    return 'a';
  }, { immediate: true }).then(result => {
    hooks.push('A-committed');
    return result;
  });

  // B starts while A is awaiting inside its transaction. With the old global
  // depth counter B saw transactionDepth > 0 and skipped its own BEGIN/COMMIT.
  const pB = (async () => {
    await sleep(5); // land squarely inside A's await window
    return runInTransaction(() => {
      order.push('B-begin');
      db.prepare("INSERT INTO __tx_probe__ (label) VALUES ('b')").run();
      order.push('B-end');
      return 'b';
    }, { immediate: true });
  })();

  const [ra, rb] = await Promise.all([pA, pB]);
  assert.strictEqual(ra, 'a');
  assert.strictEqual(rb, 'b');

  // B must have executed strictly AFTER A's transaction closed.
  assert.strictEqual(order[0], 'A-begin', 'A starts first');
  assert.strictEqual(order.indexOf('A-end') < order.indexOf('B-begin'), true,
    `B must not interleave inside A's open transaction: ${order.join(',')}`);

  const rows = db.prepare('SELECT COUNT(*) AS n FROM __tx_probe__').get() as { n: number };
  assert.strictEqual(rows.n, 2, 'Both transactions must have committed their own row');
}

async function testHookIsolationAcrossChains() {
  db.exec('CREATE TABLE IF NOT EXISTS __tx_probe__ (id INTEGER PRIMARY KEY, label TEXT)');
  const fired: string[] = [];

  const pA = runInTransaction(async tx => {
    tx.addAfterCommitHook(() => fired.push('A-hook'));
    await sleep(20); // overlap window
    return 'a';
  });

  const pB = (async () => {
    await sleep(5);
    return runInTransaction(async tx => {
      tx.addAfterCommitHook(() => fired.push('B-hook'));
      throw new Error('B rolls back');
    });
  })().catch(() => 'rolled-back');

  const [ra, rb] = await Promise.all([pA, pB]);
  assert.strictEqual(ra, 'a');
  assert.strictEqual(rb, 'rolled-back');

  // A committed → A's hook fires. B rolled back → B's hook must NEVER run,
  // and A's rollback must not have discarded it (old global activeHooks bug).
  assert.deepStrictEqual(fired.sort(), ['A-hook'],
    `A's hook fires once, B's hook never: ${JSON.stringify(fired)}`);
}

async function testNestedSameChainReusesOuterTransaction() {
  const { companyId } = registerPlayer(`tx_nested_${Date.now()}@test.local`, 'password123', `TxNested ${Date.now()}`);
  const fired: string[] = [];
  const moneyBefore = (db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money;

  await runInTransaction(async outerCtx => {
    db.prepare('UPDATE companies SET money = money - 100 WHERE company_id = ?').run(companyId);
    outerCtx.addAfterCommitHook(() => fired.push('outer-hook'));
    // Inner call on the same chain: no second BEGIN, hooks merge outward.
    await runInTransaction(async innerCtx => {
      db.prepare('UPDATE companies SET money = money - 50 WHERE company_id = ?').run(companyId);
      innerCtx.addAfterCommitHook(() => fired.push('inner-hook'));
    });
  });

  const moneyAfter = (db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money;
  assert.strictEqual(moneyBefore - moneyAfter, 150, 'Nested work commits with the outer transaction');
  assert.deepStrictEqual(fired.sort(), ['inner-hook', 'outer-hook'],
    'Both hooks run once on outer commit');
}

async function testNestedRollbackAbortsOuter() {
  const { companyId } = registerPlayer(`tx_nrb_${Date.now()}@test.local`, 'password123', `TxNrb ${Date.now()}`);
  const moneyBefore = (db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money;
  let caught = false;
  try {
    await runInTransaction(async () => {
      db.prepare('UPDATE companies SET money = money - 200 WHERE company_id = ?').run(companyId);
      await runInTransaction(async () => {
        db.prepare('UPDATE companies SET money = money - 300 WHERE company_id = ?').run(companyId);
        throw new Error('inner failure');
      });
    });
  } catch {
    caught = true;
  }
  assert.strictEqual(caught, true, 'Inner error propagates');
  const moneyAfter = (db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money;
  assert.strictEqual(moneyAfter, moneyBefore, 'Outer rollback undoes nested work');
}

async function main() {
  await testConcurrentTransactionsAreIsolated();
  console.log('PASS concurrent transactions isolated');
  await testHookIsolationAcrossChains();
  console.log('PASS hook isolation across chains');
  await testNestedSameChainReusesOuterTransaction();
  console.log('PASS same-chain nesting reuses outer transaction');
  await testNestedRollbackAbortsOuter();
  console.log('PASS nested rollback aborts outer');
}

main().then(() => {
  console.log('Issue #176 transaction isolation: ALL PASS');
  process.exit(0);
}).catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
