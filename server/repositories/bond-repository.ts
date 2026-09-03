import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { companyRepository } from './company-repository.ts';

export interface BondRow {
  id: number;
  seller_company_id: number;
  buyer_company_id: number | null;
  interest_rate: number;
  amount: number;
  status: string;
  created_at: string;
  maturity_date: string | null;
  settled: number;
}

/**
 * Bond persistence + DTO mapping (Issue #179: moved verbatim from
 * game/bonds.ts). Every statement is preserved exactly — the Strangler rule:
 * architecture migration does not rewrite economy rules.
 */
export class BondRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findById(bondId: number): BondRow | undefined {
    return this.database.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as BondRow | undefined;
  }

  listOwnedRows(companyId: number): BondRow[] {
    return this.database.prepare(`
      SELECT * FROM bonds
      WHERE buyer_company_id = ? AND status = 'active'
      ORDER BY id DESC
    `).all(companyId) as BondRow[];
  }

  listSoldRows(companyId: number): BondRow[] {
    return this.database.prepare(`
      SELECT * FROM bonds
      WHERE seller_company_id = ? AND status = 'active'
      ORDER BY id DESC
    `).all(companyId) as BondRow[];
  }

  listMarketRows(): BondRow[] {
    return this.database.prepare(`
      SELECT * FROM bonds
      WHERE buyer_company_id IS NULL AND status = 'active'
      ORDER BY interest_rate DESC LIMIT 50
    `).all() as BondRow[];
  }

  listMaturedUnsettled(now: string): BondRow[] {
    return this.database.prepare(`
      SELECT * FROM bonds
      WHERE status = 'active' AND buyer_company_id IS NOT NULL AND settled = 0
        AND maturity_date IS NOT NULL AND maturity_date <= ?
    `).all(now) as BondRow[];
  }

  /** Bonds actively held by a company (daily interest job source, camelCase). */
  findActiveHeld(): Array<{ id: number; sellerCompanyId: number; buyerCompanyId: number; amount: number; interestRate: number }> {
    const rows = this.database.prepare(`
      SELECT id, seller_company_id, buyer_company_id, amount, interest_rate
      FROM bonds
      WHERE status = 'active' AND buyer_company_id IS NOT NULL
    `).all() as Array<{ id: number; seller_company_id: number; buyer_company_id: number; amount: number; interest_rate: number }>;
    return rows.map(r => ({
      id: Number(r.id),
      sellerCompanyId: Number(r.seller_company_id),
      buyerCompanyId: Number(r.buyer_company_id),
      amount: Number(r.amount),
      interestRate: Number(r.interest_rate)
    }));
  }

  /** Insert a player-issued offering; returns the freshly persisted row. */
  insertBond(sellerCompanyId: number, interestRate: number, amount: number, createdAt: string, maturityDate: string): BondRow {
    const res = this.database.prepare(`
      INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at, maturity_date)
      VALUES (?, NULL, ?, ?, 'active', ?, ?)
    `).run(sellerCompanyId, interestRate, amount, createdAt, maturityDate);

    const bondId = Number(res.lastInsertRowid);
    return this.database.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as BondRow;
  }

  /** Compare-and-set claim of an unsold offering for a buyer; returns affected rows. */
  claimForBuyer(buyerCompanyId: number, bondId: number): number {
    const res = this.database.prepare(`
      UPDATE bonds SET buyer_company_id = ?
      WHERE id = ? AND status = 'active' AND buyer_company_id IS NULL
    `).run(buyerCompanyId, bondId);
    return res.changes;
  }

  /** Compare-and-set early call by the issuing seller; returns affected rows. */
  markCalled(bondId: number, sellerCompanyId: number): number {
    const res = this.database.prepare(`
      UPDATE bonds SET status = 'called'
      WHERE id = ? AND seller_company_id = ? AND status = 'active'
    `).run(bondId, sellerCompanyId);
    return res.changes;
  }

  markSettled(bondId: number, status: string): void {
    this.database.prepare('UPDATE bonds SET settled = 1, status = ? WHERE id = ?').run(status, bondId);
  }

  countUnsold(): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM bonds
      WHERE buyer_company_id IS NULL AND status = 'active'
    `).get() as { count?: number } | undefined;
    return Number(row?.count) || 0;
  }

  insertNpcListing(sellerCompanyId: number, interestRate: number, amount: number, createdAt: string): void {
    this.database.prepare(`
      INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at)
      VALUES (?, NULL, ?, ?, 'active', ?)
    `).run(sellerCompanyId, interestRate, amount, createdAt);
  }

  /**
   * Issue #94: total face value of bonds this company has issued AND that are
   * currently held by buyers — the outstanding bond liability backing the
   * building-collateral requirement. Each bond unit has a $5,000 face value
   * (`go`, chunk_zjr.js). Unsold offerings (buyer_company_id IS NULL) are not a
   * liability yet.
   */
  outstandingSoldLiability(companyId: number): number {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS units
      FROM bonds
      WHERE seller_company_id = ? AND buyer_company_id IS NOT NULL AND status = 'active'
    `).get(companyId) as { units?: number | null } | undefined;
    return Number(row?.units ?? 0) * 5000;
  }

  seedBondMarketListings() {
    if (this.countUnsold() > 0) return;

    const now = new Date().toISOString();
    const seedBonds = [
      { seller: 999901, amount: 50000, rate: 0.005 },
      { seller: 999902, amount: 100000, rate: 0.0055 },
      { seller: 999903, amount: 25000, rate: 0.0045 }
    ];
    for (const bond of seedBonds) {
      this.insertNpcListing(bond.seller, bond.rate, bond.amount, now);
    }
  }

  formatBond(b: BondRow) {
    const seller = companyRepository.findById(b.seller_company_id);
    const buyer = b.buyer_company_id ? companyRepository.findById(b.buyer_company_id) : null;

    return {
      id: b.id,
      seller: {
        id: b.seller_company_id,
        company: seller?.name || `Company #${b.seller_company_id}`,
        rating: seller?.rating || 'BBB',
        logo: seller?.logo || ''
      },
      buyer: buyer ? {
        id: buyer.companyId,
        company: buyer.name,
        logo: buyer.logo || ''
      } : null,
      interest: b.interest_rate,
      amount: b.amount,
      status: b.status,
      created: b.created_at,
      dailyInterest: Math.round(b.amount * b.interest_rate * 100) / 100
    };
  }
}

export const bondRepository = new BondRepository();
