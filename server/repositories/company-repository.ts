import type { DatabaseSync } from 'node:sqlite';
import { virtualClock } from '../core/virtual-clock.ts';
import { db } from '../db/connection.ts';
import { InsufficientFundsError, NotFoundError } from '../errors/domain-error.ts';
import { getXpRequiredForLevel } from '../domain/leveling/level-rules.ts';
import { recordCashLedger, refreshDailyFinanceSnapshot } from '../game/cash-ledger.ts';

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

  /**
   * Legacy-compatible lookup: the original engine read companies by either
   * the company_id column or the rowid (getCompanyById dual-column WHERE).
   * The money/SimBoost primitives preserve that behavior.
   */
  private findByIdDual(companyId: number): CompanyEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM companies WHERE company_id = ? OR id = ?'
    ).get(companyId, companyId) as CompanyDbRow | undefined;

    return row ? mapCompanyRow(row) : null;
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
  findByName(name: string): CompanyEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM companies WHERE name = ? COLLATE NOCASE ORDER BY id ASC LIMIT 1'
    ).get(name) as CompanyDbRow | undefined;

    return row ? mapCompanyRow(row) : null;
  }

  /**
   * Accrue experience and apply level-ups (Issue #179: the leveling state
   * machine lives with persistence, not in the legacy game engine).
   * Mirrors the original game/company.ts implementation exactly, including
   * the level-60 cap and referral tier rewards.
   */
  addExperience(companyId: number, xpGain: number): { level: number; experience: number } | undefined {
    if (!xpGain || xpGain <= 0) return undefined;
    const comp = this.findById(companyId);
    if (!comp) return undefined;
    let level = Number(comp.level || 0);
    let experience = Number(comp.experience || 0) + xpGain;
    let xpNeeded = getXpRequiredForLevel(level);

    while (experience >= xpNeeded && level < 60) {
      experience -= xpNeeded;
      level += 1;
      xpNeeded = getXpRequiredForLevel(level);
    }

    const before = Number(comp.level || 0);
    this.database.prepare('UPDATE companies SET level = ?, experience = ? WHERE company_id = ?').run(level, experience, companyId);
    if (level > before) {
      void this.payoutReferralLevelRewards(companyId, before, level);
    }
    return { level, experience };
  }

  /**
   * The authoritative signed money mutation (Issue #179: moved verbatim from
   * game/company.ts so there is exactly one implementation). Delta may be
   * positive or negative; validates balance invariants, records a generic
   * 'g' cash-ledger row unless skipped, and refreshes the daily snapshot.
   */
  updateMoney(companyId: number, delta: number, options: { skipLedger?: boolean } = {}): number {
    const skipLedger = options.skipLedger ?? false;
    if (!Number.isFinite(delta)) {
      throw new Error('Money delta must be finite');
    }

    const comp = this.findByIdDual(companyId);
    if (!comp) {
      throw new Error('Company not found');
    }

    const currentMoney = Number(comp.money);
    if (!Number.isFinite(currentMoney)) {
      throw new Error('Company balance is invalid');
    }

    const newMoney = Math.round((currentMoney + delta) * 100) / 100;
    if (!Number.isFinite(newMoney)) {
      throw new Error('Money balance is invalid');
    }
    if (newMoney < 0) {
      throw new Error('Insufficient funds');
    }

    const result = this.database.prepare('UPDATE companies SET money = ? WHERE company_id = ? OR id = ?').run(newMoney, companyId, companyId);
    if (result.changes < 1) {
      throw new Error('Company not found');
    }
    if (!skipLedger) {
      recordCashLedger({ companyId, amount: delta, category: 'g', description: 'Company money change', descriptionKey: '' });
    }
    refreshDailyFinanceSnapshot(companyId);
    return newMoney;
  }

  /**
   * The authoritative SimBoost mutation primitive (moved verbatim from
   * game/company.ts during the #179 executives vertical migration): finite
   * delta validation, dual-column lookup, exact error messages.
   */
  updateSimBoosts(companyId: number, delta: number): number {
    if (!Number.isFinite(delta)) {
      throw new Error('SimBoost delta must be finite');
    }

    const comp = this.findByIdDual(companyId);
    if (!comp) {
      throw new Error('Company not found');
    }

    const currentSB = Number(comp.simboosts);
    if (!Number.isFinite(currentSB)) {
      throw new Error('Company SimBoost balance is invalid');
    }

    const newSB = currentSB + delta;
    if (!Number.isFinite(newSB)) {
      throw new Error('SimBoost balance is invalid');
    }
    if (newSB < 0) {
      throw new Error('Insufficient SimBoosts');
    }

    const result = this.database.prepare('UPDATE companies SET simboosts = ? WHERE company_id = ? OR id = ?').run(newSB, companyId, companyId);
    if (result.changes < 1) {
      throw new Error('Company not found');
    }
    return newSB;
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
   * Referral tier rewards (data/referral.json): the referrer earns SimBoosts
   * when a referred company reaches level 5/10/15. Referrals repository is
   * imported lazily to avoid a module cycle; failures never break the
   * level-up path.
   */
  private async payoutReferralLevelRewards(companyId: number, oldLevel: number, newLevel: number): Promise<void> {
    const { referralsRepository, REFERRAL_LEVEL_TIERS } = await import('./referrals-repository.ts');
    const referrerCompanyId = referralsRepository.findReferrerOf(companyId);
    if (!referrerCompanyId) return;
    const company = this.findById(referrerCompanyId);
    if (!company) return;
    for (const tier of REFERRAL_LEVEL_TIERS) {
      if (newLevel >= tier.level && oldLevel < tier.level) {
        const rewarded = referralsRepository.markTierPaidAndReward(referrerCompanyId, tier.level, tier.reward);
        if (rewarded) {
          this.creditSimboosts(referrerCompanyId, tier.reward);
        }
      }
    }
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

  /** Companies that have purchased supporter status, backed by persisted certificates. */
  listSupporters(realmId: number): Array<{
    companyId: number;
    name: string;
    realmId: number;
    logo: string;
    level: number;
    rating: string;
    note: string;
    dateJoined: string;
  }> {
    const rows = this.database.prepare(`
      SELECT company_id, name, realm_id, logo, level, rating, note,
             COALESCE(supporter_started_at, created_at) AS date_joined
      FROM companies
      WHERE realm_id = ?
        AND COALESCE(supporter_certificates, 0) > 0
      ORDER BY date_joined ASC, company_id ASC
    `).all(realmId) as Array<{
      company_id: number;
      name: string;
      realm_id: number;
      logo: string | null;
      level: number;
      rating: string | null;
      note: string | null;
      date_joined: string;
    }>;
    return rows.map(row => ({
      companyId: Number(row.company_id),
      name: row.name || '',
      realmId: Number(row.realm_id),
      logo: row.logo || '',
      level: Number(row.level) || 0,
      rating: row.rating || '',
      note: row.note || '',
      dateJoined: row.date_joined
    }));
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
        // Issue #114: companies has no 'deleted' column; banned companies are
        // flagged in company_settings (ban semantics, audit-repository).
        `SELECT c.company_id, c.name, c.logo, c.realm_id, c.money FROM companies c
         WHERE NOT EXISTS (
           SELECT 1 FROM company_settings cs
           WHERE cs.company_id = c.company_id AND cs.key = 'banned' AND cs.value = '1'
         )
         ORDER BY c.money DESC LIMIT ?`
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
        (SELECT COALESCE(MAX(COALESCE(skill_management, 0)), 0) FROM executives
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

  /**
   * Accounting-fee lift from the CFO and banks (#155), decompiled contract:
   *   executiveLift = cfoSkill × 500,000
   *   bankLift      = cfoSkill × bankSize × 50,000  (bank panel $ display)
   * The fee-free holdings threshold base is 3,000,000 (bundle Xcr = 3e6).
   * A bank only contributes while placed and not under construction
   * ("bankNotContributing" / "bankNotContributingUntilPlaced").
   */
  getAccountingLift(companyId: number): {
    bankSize: number;
    bankContributing: boolean;
    cfoSkill: number;
    executiveLift: number;
    bankLift: number;
    exemptThreshold: number;
  } {
    const bank = this.database.prepare(`
      SELECT COALESCE(SUM(size), 0) AS bank_size,
             SUM(CASE WHEN busy_until IS NOT NULL AND busy_until > ? THEN 1 ELSE 0 END) AS busy_banks,
             SUM(CASE WHEN position IS NULL OR position = '' THEN 1 ELSE 0 END) AS unplaced_banks
      FROM buildings WHERE company_id = ? AND kind = 'n'
    `).get(virtualClock.nowIso(), companyId) as { bank_size?: number; busy_banks?: number; unplaced_banks?: number } | undefined;
    const bankSize = Number(bank?.bank_size) || 0;
    const bankContributing = bankSize > 0 && Number(bank?.busy_banks) === 0 && Number(bank?.unplaced_banks) === 0;
    const cfo = this.database.prepare(`
      SELECT COALESCE(MAX(COALESCE(skill_accounting, 0)), 0) AS cfo_skill FROM executives
      WHERE company_id = ? AND status = 'employed' AND position = 'cfo'
    `).get(companyId) as { cfo_skill?: number } | undefined;
    const cfoSkill = Number(cfo?.cfo_skill) || 0;
    const executiveLift = cfoSkill * 500000;
    const bankLift = bankContributing ? cfoSkill * bankSize * 50000 : 0;
    return {
      bankSize,
      bankContributing,
      cfoSkill,
      executiveLift,
      bankLift,
      exemptThreshold: 3000000 + executiveLift + bankLift
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

  /** Check if a player holds admin privileges. */
  isPlayerAdmin(playerId: number): boolean {
    const row = this.database.prepare('SELECT is_admin FROM players WHERE player_id = ?').get(playerId) as { is_admin?: number } | undefined;
    return Boolean(row && row.is_admin === 1);
  }
}

export const companyRepository = new CompanyRepository();
