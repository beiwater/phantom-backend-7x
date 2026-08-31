import type { DatabaseSync } from 'node:sqlite';
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

let transactionDepth = 0;
let activeHooks: AfterCommitHook[] = [];

/**
 * Execute work inside an atomic database transaction.
 *
 * Guarantees:
 * 1. Synchronous atomic commit/rollback on SQLite database.
 * 2. Nested transactions reuse the existing transaction boundary.
 * 3. After-commit hooks run ONLY when the outermost transaction commits successfully.
 * 4. If transaction rolls back, all registered hooks are discarded without running.
 */
export async function runInTransaction<T>(
  work: (ctx: TransactionContext) => T | Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const targetDb = options.database || db;
  const isOuter = transactionDepth === 0;

  if (isOuter) {
    activeHooks = [];
    if (options.immediate) {
      targetDb.exec('BEGIN IMMEDIATE');
    } else {
      targetDb.exec('BEGIN');
    }
  }

  transactionDepth++;

  const context: TransactionContext = {
    db: targetDb,
    addAfterCommitHook(hook: AfterCommitHook) {
      activeHooks.push(hook);
    }
  };

  let result: T;
  try {
    result = await work(context);
    transactionDepth--;

    if (isOuter) {
      targetDb.exec('COMMIT');
      const hooksToRun = [...activeHooks];
      activeHooks = [];

      // Execute afterCommit hooks safely outside the SQL transaction boundary
      for (const hook of hooksToRun) {
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
    }

    return result;
  } catch (error) {
    transactionDepth--;
    if (isOuter) {
      try {
        targetDb.exec('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[Transaction rollback error]:', rollbackErr);
      }
      // Discard all registered hooks on rollback
      activeHooks = [];
    }
    throw error;
  }
}
