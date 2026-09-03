/**
 * Finance repository (Issue #180).
 * Owns the read-side SQL behind the finance HTTP surfaces: balance-sheet
 * asset/liability aggregates, employee counts, admin-overhead inputs and the
 * company admin flag used for cross-company authorization.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface FinanceBalanceAdjustments {
  /** Escrow held by active buy orders, excluded from companies.money. */
  cashReservedForOrders: number;
  /** Completed retail orders whose revenue is waiting for collection. */
  accountsReceivable: number;
  /** Input cost recorded on unresolved production queues still in progress. */
  workInProcess: number;
  /** Security deposits held by open, unfulfilled government bids. */
  deposits: number;
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}


export class FinanceRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  /** Sum of amount * cost_market over the company's warehouse rows. */
  inventoryValue(companyId: number): number {
    const row = this.database.prepare(
      'SELECT COALESCE(SUM(amount * cost_market), 0) AS total FROM warehouse WHERE company_id = ?'
    ).get(companyId) as { total: number | null };
    return Number(row?.total) || 0;
  }
  /**
   * Read balance-sheet amounts that are held outside the company's cash and
   * warehouse aggregates. Each amount is sourced from an active durable row;
   * this query intentionally performs no settlement, expiry, or cleanup work.
   */
  balanceAdjustments(companyId: number, nowIso: string): FinanceBalanceAdjustments {
    const reservedRow = this.database.prepare(`
      SELECT COALESCE(SUM(quantity * price), 0) AS total
      FROM market_orders
      WHERE seller_id = ? AND active = 1 AND is_buy = 1 AND quantity > 0
    `).get(companyId) as { total?: number } | undefined;

    const receivableRow = this.database.prepare(`
      SELECT COALESCE(SUM(units * unit_price), 0) AS total
      FROM retail_orders
      WHERE company_id = ? AND finished_at IS NOT NULL AND finished_at <= ?
    `).get(companyId, nowIso) as { total?: number } | undefined;

    const workInProcessRow = this.database.prepare(`
      SELECT COALESCE(SUM(amount * cost), 0) AS total
      FROM production_queues
      WHERE company_id = ? AND resolved = 0 AND finishes_at > ?
    `).get(companyId, nowIso) as { total?: number } | undefined;

    const depositsRow = this.database.prepare(`
      SELECT COALESCE(SUM(c.deposit_paid), 0) AS total
      FROM government_bid_contractors c
      WHERE c.company_id = ? AND c.fulfilled = 0 AND c.deposit_paid > 0
    `).get(companyId) as { total?: number } | undefined;

    return {
      cashReservedForOrders: roundMoney(reservedRow?.total ?? 0),
      accountsReceivable: roundMoney(receivableRow?.total ?? 0),
      workInProcess: roundMoney(workInProcessRow?.total ?? 0),
      deposits: roundMoney(depositsRow?.total ?? 0)
    };
  }

  /** Replacement cost of the company's buildings (cost * size). */
  buildingsValue(companyId: number): number {
    const row = this.database.prepare(
      'SELECT COALESCE(SUM(cost * size), 0) AS total FROM buildings WHERE company_id = ?'
    ).get(companyId) as { total: number | null };
    return Number(row?.total) || 0;
  }

  /** Face value of active bonds bought by the company (amount * 5000). */
  bondsHeldValue(companyId: number): number {
    const row = this.database.prepare(
      `SELECT COALESCE(SUM(amount) * 5000, 0) AS total FROM bonds WHERE buyer_company_id = ? AND status = 'active'`
    ).get(companyId) as { total: number | null };
    return Number(row?.total) || 0;
  }

  /** Remaining principal on the company's active loans. */
  loansOutstanding(companyId: number): number {
    const row = this.database.prepare(
      `SELECT COALESCE(SUM(remaining), 0) AS total FROM loans WHERE company_id = ? AND status = 'active'`
    ).get(companyId) as { total: number | null };
    return Number(row?.total) || 0;
  }

  /** Whether the company's owning player carries the admin flag. */
  isCompanyAdmin(companyId: number): boolean {
    return Boolean(
      (this.database.prepare('SELECT p.is_admin FROM players p JOIN companies c ON c.player_id = p.player_id WHERE c.company_id = ?').get(companyId) as { is_admin?: number } | undefined)?.is_admin
    );
  }

  /** Number of buildings owned by the company. */
  buildingCount(companyId: number): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM buildings WHERE company_id = ?').get(companyId) as { count?: number } | undefined;
    return Number(row?.count) || 0;
  }

  /**
   * #152: recreation bonus mirrors the client selector zP — sum of sizes
   * of recreation buildings with an active paid upkeep (busy_until in the
   * future and upkeep_active set), excluding landmark positions ('l...').
   */
  recreationBonus(companyId: number, nowIso: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(size), 0) AS bonus FROM buildings
      WHERE company_id = ? AND category = 'recreation' AND upkeep_active = 1
        AND busy_until IS NOT NULL AND busy_until > ?
        AND position NOT LIKE 'l%'
    `).get(companyId, nowIso) as { bonus?: number } | undefined;
    return Number(row?.bonus) || 0;
  }

  /** Employees implied by total building size (#152/#155 staffing curve). */
  employeeCount(companyId: number): number {
    const row = this.database.prepare(
      `SELECT COALESCE(SUM(size), 0) AS total FROM buildings WHERE company_id = ?`
    ).get(companyId) as { total: number | null };
    const bldCount = Number(row?.total) || 0;
    return Math.floor(bldCount * 100 * (1 + (bldCount - 1) / 170)) || 0;
  }
}

export const financeRepository = new FinanceRepository();
