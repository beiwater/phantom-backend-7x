import type { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './connection.ts';

export type AfterCommitHook = () => void | Promise<void>;

export interface TransactionContext {
  db: DatabaseSync;
  addAfterCommitHook(hook: AfterCommitHook): void;
}

export interface TransactionOptions {
  immediate?: boolean;
  database?: DatabaseSync;
}

/**
 * Per-async-execution-context transaction state (#176).
 *
 * Each call chain gets its own depth counter and after-commit hook list, so
 * two concurrent requests that await across each other can never see each
 * other's transaction as "nested" or share hook ownership.
 */
interface TxState {
  db: DatabaseSync;
  depth: number;
  hooks: AfterCommitHook[];
}

const txStorage = new AsyncLocalStorage<TxState>();

/**
 * Serialization for the single SQLite connection (#176).
 *
 * SQLite allows only one open transaction per connection. While transaction A
 * is open, transaction B from a different async context must WAIT instead of
 * being mis-detected as nested. The lock is a promise queue keyed by database
 * instance; same-call-chain nesting never re-enters it (the ALS store marks
 * the chain as already inside a transaction).
 */
const connectionLocks = new WeakMap<DatabaseSync, Promise<void>>();

function withConnectionLock<T>(database: DatabaseSync, fn: () => Promise<T>): Promise<T> {
  const prev = connectionLocks.get(database) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  connectionLocks.set(database, gate);
  return prev.then(() => fn()).finally(release);
}

/**
 * Execute work inside an atomic database transaction.
 *
 * Guarantees:
 * 1. Synchronous atomic commit/rollback on SQLite.
 * 2. Same-call-chain nesting reuses the outermost transaction boundary.
 * 3. Transactions from different async contexts are fully isolated: their own
 *    BEGIN/COMMIT, serialized on the connection, and disjoint after-commit
 *    hooks (#176). Overlapping awaits no longer merge transactions.
 * 4. After-commit hooks run ONLY when the outermost transaction of their own
 *    call chain commits; a rollback in another chain never touches them.
 */
export async function runInTransaction<T>(
  work: (ctx: TransactionContext) => T | Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const targetDb = options.database || db;
  const outer = txStorage.getStore();

  // Same async call chain: reuse the outer transaction boundary. Hooks append
  // to the outermost state and run once, when it commits.
  if (outer && outer.db === targetDb) {
    outer.depth++;
    const context: TransactionContext = {
      db: targetDb,
      addAfterCommitHook(hook: AfterCommitHook) {
        outer.hooks.push(hook);
      }
    };
    try {
      return await work(context);
    } finally {
      outer.depth--;
    }
  }

  return withConnectionLock(targetDb, async () => {
    const state: TxState = { db: targetDb, depth: 1, hooks: [] };
    return txStorage.run(state, async () => {
      const context: TransactionContext = {
        db: targetDb,
        addAfterCommitHook(hook: AfterCommitHook) {
          state.hooks.push(hook);
        }
      };

      targetDb.exec(options.immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');

      let result: T;
      try {
        result = await work(context);
        targetDb.exec('COMMIT');
      } catch (error) {
        try {
          targetDb.exec('ROLLBACK');
        } catch (rollbackErr) {
          console.error('[Transaction rollback error]:', rollbackErr);
        }
        // Discard this chain's hooks on rollback.
        state.hooks.length = 0;
        throw error;
      }

      // Execute afterCommit hooks safely outside the SQL transaction boundary.
      for (const hook of state.hooks.splice(0)) {
        try {
          const outcome = hook();
          if (outcome instanceof Promise) {
            outcome.catch(err => {
              console.error('[Transaction afterCommit async error]:', err);
            });
          }
        } catch (err) {
          console.error('[Transaction afterCommit sync error]:', err);
        }
      }

      return result;
    });
  });
}
