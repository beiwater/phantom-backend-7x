/**
 * Gift-basket persistence (Issue #201).
 * Compatibility DTOs stay in game-data/gift-baskets.ts; this repository owns
 * the durable outgoing deletion predicate and its affected-row result.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export class GiftBasketRepository {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  /**
   * Deletes one sent basket only when it belongs to the sender and year.
   * A false result deliberately covers unknown, foreign, wrong-year, and
   * already-deleted baskets without exposing another company's records.
   */
  deleteOutgoingOwned(basketId: number, companyId: number, year: number): boolean {
    const result = this.database.prepare(`
      DELETE FROM gift_baskets
      WHERE id = ?
        AND sender_company_id = ?
        AND year = ?
        AND sent = 1
    `).run(basketId, companyId, year);
    return Number(result.changes) === 1;
  }
}

export const giftBasketRepository = new GiftBasketRepository();
