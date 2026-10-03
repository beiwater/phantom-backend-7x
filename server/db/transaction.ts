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

interface TxFrame {
  hooks: AfterCommitHook[];
}

/**
 * Open transaction frames per connection. Index 0 is the outermost
 * BEGIN/COMMIT; deeper frames are SAVEPOINTs.
 *
 * The work callback is synchronous, so a transaction can never stay open
 * across an `await`. node:sqlite is synchronous and JavaScript is
 * single-threaded, therefore no other request can observe or join an open
 * transaction, and no connection lock is needed.
 */
const openFrames = new WeakMap<DatabaseSync, TxFrame[]>();
let savepointSeq = 0;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && 'then' in value
    && typeof value.then === 'function';
}

function runAfterCommitHooks(hooks: AfterCommitHook[]): void {
  for (const hook of hooks) {
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

/**
 * Execute synchronous work inside an atomic database transaction.
 *
 * Guarantees:
 * 1. The outermost call issues BEGIN (or BEGIN IMMEDIATE) and COMMIT/ROLLBACK.
 * 2. A nested call runs inside a SAVEPOINT: if it throws, only its own writes
 *    are rolled back and the error propagates; the caller may catch it and
 *    continue the outer transaction.
 * 3. After-commit hooks run once, after the outermost COMMIT. Hooks registered
 *    by a nested call that rolled back are discarded.
 * 4. `work` MUST be synchronous. Returning a Promise/thenable rolls the
 *    transaction back and throws a TypeError: perform awaits before entering
 *    the transaction.
 */
export function runInTransaction<T>(
  work: (ctx: TransactionContext) => T,
  options: TransactionOptions = {}
): T {
  const targetDb = options.database || db;
  let frames = openFrames.get(targetDb);
  if (!frames) {
    frames = [];
    openFrames.set(targetDb, frames);
  }

  const nested = frames.length > 0;
  if (!nested && targetDb.isTransaction === true) {
    throw new Error('runInTransaction: connection already has a transaction not opened by runInTransaction (raw BEGIN)');
  }

  const savepoint = nested ? `tx_sp_${++savepointSeq}` : null;
  targetDb.exec(savepoint ? `SAVEPOINT ${savepoint}` : (options.immediate ? 'BEGIN IMMEDIATE' : 'BEGIN'));

  const frame: TxFrame = { hooks: [] };
  frames.push(frame);
  const context: TransactionContext = {
    db: targetDb,
    addAfterCommitHook(hook: AfterCommitHook) {
      frame.hooks.push(hook);
    }
  };

  let result: T;
  try {
    result = work(context);
    if (isThenable(result)) {
      // Keep a rejected orphan promise from becoming an unhandled rejection.
      Promise.resolve(result).catch(() => undefined);
      throw new TypeError('runInTransaction work must be synchronous; await before entering the transaction');
    }
    if (!savepoint) {
      targetDb.exec('COMMIT');
    }
  } catch (error) {
    frames.pop();
    try {
      targetDb.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
    } catch (rollbackErr) {
      console.error('[Transaction rollback error]:', rollbackErr);
    }
    throw error;
  }

  frames.pop();
  if (savepoint) {
    targetDb.exec(`RELEASE ${savepoint}`);
    frames[frames.length - 1].hooks.push(...frame.hooks);
    return result;
  }

  runAfterCommitHooks(frame.hooks);
  return result;
}
