import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { InsufficientFundsError, NotFoundError } from '../errors/domain-error.ts';

export interface CompanyEntity {
  id: number;
  companyId: number;
  playerId: number;
  name: string;
  money: number;
  simboosts: number;
  level: number;
  rating: string;
  experience: number;
  realmId: number;
  logo: string;
  personalAssistant: string;
  note: string;
  extraBuildingSlots: number;
  extraExecutiveSlots: number;
  displayCaseSlots: number;
  maxTags: number;
  createdAt: string;
}

export interface CompanyDbRow {
  id: number;
  company_id: number;
  player_id: number;
  name: string;
  money: number;
  simboosts: number;
  level: number;
  rating: string;
  experience: number;
  realm_id: number;
  logo: string;
  personal_assistant: string;
  note: string;
  extra_building_slots?: number;
  extra_executive_slots?: number;
  display_case_slots?: number;
  max_tags?: number;
  created_at: string;
}

function mapCompanyRow(row: CompanyDbRow): CompanyEntity {
  return {
    id: row.id,
    companyId: row.company_id,
    playerId: row.player_id,
    name: row.name,
    money: row.money,
    simboosts: row.simboosts,
    level: row.level,
    rating: row.rating,
    experience: row.experience,
    realmId: row.realm_id,
    logo: row.logo,
    personalAssistant: row.personal_assistant,
    note: row.note,
    extraBuildingSlots: row.extra_building_slots ?? 0,
    extraExecutiveSlots: row.extra_executive_slots ?? 0,
    displayCaseSlots: row.display_case_slots ?? 1,
    maxTags: row.max_tags ?? 1,
    createdAt: row.created_at
  };
}

export class CompanyRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findById(companyId: number): CompanyEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM companies WHERE company_id = ?'
    ).get(companyId) as CompanyDbRow | undefined;

    return row ? mapCompanyRow(row) : null;
  }

  findByPlayerId(playerId: number): CompanyEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1'
    ).get(playerId) as CompanyDbRow | undefined;

    return row ? mapCompanyRow(row) : null;
  }

  /**
   * Atomically credit money to a company.
   */
  creditMoney(companyId: number, amount: number): number {
    // C-18: non-finite amounts (Infinity/NaN) would corrupt the balance and
    // serialize as null downstream; reject them at the write boundary.
    if (!Number.isFinite(amount)) {
      throw new Error(`creditMoney amount must be finite: ${amount}`);
    }
    if (amount < 0) {
      throw new Error(`creditMoney amount must be non-negative: ${amount}`);
    }
    const result = this.database.prepare(`
      UPDATE companies
      SET money = money + ?
      WHERE company_id = ?
      RETURNING money
    `).get(amount, companyId) as { money: number } | undefined;

    if (!result) {
      throw new NotFoundError(`Company with id ${companyId} not found`);
    }
    return result.money;
  }

  /**
   * Atomically debit money from a company, failing if balance would drop below zero.
   */
  debitMoney(companyId: number, amount: number): number {
    // C-18: reject non-finite amounts before they reach the balance.
    if (!Number.isFinite(amount)) {
      throw new Error(`debitMoney amount must be finite: ${amount}`);
    }
    if (amount < 0) {
      throw new Error(`debitMoney amount must be non-negative: ${amount}`);
    }
    const result = this.database.prepare(`
      UPDATE companies
      SET money = money - ?
      WHERE company_id = ? AND money >= ?
      RETURNING money
    `).get(amount, companyId, amount) as { money: number } | undefined;

    if (!result) {
      const company = this.findById(companyId);
      if (!company) {
        throw new NotFoundError(`Company with id ${companyId} not found`);
      }
      throw new InsufficientFundsError(`Insufficient cash balance: needed $${amount.toFixed(2)}, currently have $${company.money.toFixed(2)}`);
    }
    return result.money;
  }

  /**
   * Atomically credit SimBoosts to a company.
   */
  creditSimboosts(companyId: number, amount: number): number {
    // C-18: reject non-finite amounts before they reach the balance.
    if (!Number.isFinite(amount)) {
      throw new Error(`creditSimboosts amount must be finite: ${amount}`);
    }
    if (amount < 0) {
      throw new Error(`creditSimboosts amount must be non-negative: ${amount}`);
    }
    const result = this.database.prepare(`
      UPDATE companies
      SET simboosts = simboosts + ?
      WHERE company_id = ?
      RETURNING simboosts
    `).get(amount, companyId) as { simboosts: number } | undefined;

    if (!result) {
      throw new NotFoundError(`Company with id ${companyId} not found`);
    }
    return result.simboosts;
  }

  /**
   * Atomically debit SimBoosts from a company.
   */
  debitSimboosts(companyId: number, amount: number): number {
    // C-18: reject non-finite amounts before they reach the balance.
    if (!Number.isFinite(amount)) {
      throw new Error(`debitSimboosts amount must be finite: ${amount}`);
    }
    if (amount < 0) {
      throw new Error(`debitSimboosts amount must be non-negative: ${amount}`);
    }
    const result = this.database.prepare(`
      UPDATE companies
      SET simboosts = simboosts - ?
      WHERE company_id = ? AND simboosts >= ?
      RETURNING simboosts
    `).get(amount, companyId, amount) as { simboosts: number } | undefined;

    if (!result) {
      const company = this.findById(companyId);
      if (!company) {
        throw new NotFoundError(`Company with id ${companyId} not found`);
      }
      throw new InsufficientFundsError(`Insufficient SimBoosts: needed ${amount}, currently have ${company.simboosts}`);
    }
    return result.simboosts;
  }

  /** Top companies by money (leaderboard), excluding deleted. */
  listTopCompaniesByMoney(limit = 100): Array<{
    companyId: number;
    name: string;
    logo: string;
    realmId: number;
    money: number;
  }> {
    const rows = this.database
      .prepare(
        `SELECT company_id, name, logo, realm_id, money FROM companies
         WHERE deleted = 0 ORDER BY money DESC LIMIT ?`
      )
      .all(limit) as Array<{ company_id: number; name: string; logo: string; realm_id: number; money: number }>;
    return rows.map(r => ({
      companyId: Number(r.company_id),
      name: r.name,
      logo: r.logo || '',
      realmId: Number(r.realm_id),
      money: Number(r.money) || 0
    }));
  }

  /** Accounting-overhead stats for one company (building count/size, COO skill). */
  getAccountingOverheadStats(companyId: number): {
    buildingCount: number;
    totalSize: number;
    cooSkill: number;
  } {
    const stats = this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buildings WHERE company_id = ?) AS building_count,
        (SELECT COALESCE(SUM(size), 0) FROM buildings WHERE company_id = ?) AS total_size,
        (SELECT COALESCE(MAX(COALESCE(skill_accounting, 0)), 0) FROM executives
           WHERE company_id = ? AND status = 'employed' AND position = 'coo') AS coo_skill
    `).get(companyId, companyId, companyId) as {
      building_count: number;
      total_size: number;
      coo_skill: number;
    };
    return {
      buildingCount: Number(stats.building_count) || 0,
      totalSize: Number(stats.total_size) || 0,
      cooSkill: Number(stats.coo_skill) || 0
    };
  }

  /** Payroll rows for every company: (companyId, money, employed salary total). */
  listExecutivePayrolls(): Array<{ companyId: number; money: number; salaries: number }> {
    const rows = this.database.prepare(`
      SELECT c.company_id AS company_id, c.money AS money,
             COALESCE((SELECT SUM(e.salary) FROM executives e
                       WHERE e.company_id = c.company_id AND e.status = 'employed'), 0) AS salaries
      FROM companies c
    `).all() as Array<{ company_id: number; money: number; salaries: number }>;
    return rows.map(r => ({
      companyId: Number(r.company_id),
      money: Number(r.money),
      salaries: Number(r.salaries)
    }));
  }
}

export const companyRepository = new CompanyRepository();
