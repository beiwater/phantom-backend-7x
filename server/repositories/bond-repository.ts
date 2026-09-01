/**
 * Bond repository (Issue #105 hardening).
 * Owns all bond-table SQL: reads for interest settlement, status writes,
 * and the listing/market queries used by the bond use cases. Knows nothing
 * about frontend DTOs.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface BondRowEntity {
  id: number;
  sellerCompanyId: number | null;
  buyerCompanyId: number | null;
  amount: number;
  interestRate: number;
  status: string;
}

interface BondDbRow {
  id: number;
  seller_company_id: number | null;
  buyer_company_id: number | null;
  amount: number;
  interest_rate: number;
  status: string;
}

function mapBondRow(row: BondDbRow): BondRowEntity {
  return {
    id: row.id,
    sellerCompanyId: row.seller_company_id === null ? null : Number(row.seller_company_id),
    buyerCompanyId: row.buyer_company_id === null ? null : Number(row.buyer_company_id),
    amount: Number(row.amount),
    interestRate: Number(row.interest_rate),
    status: row.status
  };
}

export class BondRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  /** Bonds actually held by a buyer (only these accrue interest). */
  findActiveHeld(): BondRowEntity[] {
    const rows = this.database.prepare(`
      SELECT id, seller_company_id, buyer_company_id, amount, interest_rate, status
      FROM bonds
      WHERE status = 'active' AND buyer_company_id IS NOT NULL
    `).all() as BondDbRow[];
    return rows.map(mapBondRow);
  }

  markDefaulted(bondId: number): void {
    this.database.prepare(`UPDATE bonds SET status = 'defaulted' WHERE id = ?`).run(bondId);
  }

  /**
   * Company cash snapshot for settlement loops (id, money only — the
   * settlement job credits/debits via the company repository).
   */
  listCompanyCash(): Array<{ companyId: number; money: number }> {
    const rows = this.database.prepare('SELECT company_id, money FROM companies').all() as Array<{
      company_id: number;
      money: number;
    }>;
    return rows.map(r => ({ companyId: Number(r.company_id), money: Number(r.money) }));
  }
}

export const bondRepository = new BondRepository();
