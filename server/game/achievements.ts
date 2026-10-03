import { db } from '../db/database.ts';
import type { SQLInputValue } from 'node:sqlite';
import { runInTransaction } from '../db/transaction.ts';
import { getQualityFromPatents } from '../domain/research/research-rules.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from './company.ts';
import { DomainError } from '../errors/domain-error.ts';
import {
  type IndividualAchievement,
  type AchievementStatKey,
  type CanonicalAchievementDef,
  CANONICAL_ACHIEVEMENTS,
  ALL_ACHIEVEMENTS
} from './achievement-definitions.ts';
import {
  getDisplayCase,
  updateDisplayCase,
  removeDisplayCaseSlot,
  type DisplayCaseRow,
  type DisplayItemKind,
  type DisplayCasePlacement,
  DISPLAY_CASE_MIN_SLOT,
  DISPLAY_CASE_MAX_SLOT
} from './display-case.ts';

// Issue #88: display case certificate placement verifies ownership against
// the certificates table; importing the certificates domain ensures the table
// exists (and is seeded) before any ownership check runs.
import {
  getCertificates as getIssuedCertificates,
  getLatestCertificates as getIssuedLatestCertificates,
  getRarestCertificates as getIssuedRarestCertificates,
  getCertificateDetail as getIssuedCertificateDetail,
  getCompanyCertificates as getIssuedCompanyCertificates,
  getCertificateCatalog as getIssuedCertificateCatalog
} from './certificates.ts';

export {
  type IndividualAchievement,
  type AchievementStatKey,
  ALL_ACHIEVEMENTS,
  getDisplayCase,
  updateDisplayCase,
  removeDisplayCaseSlot,
  type DisplayCaseRow,
  type DisplayItemKind,
  type DisplayCasePlacement,
  DISPLAY_CASE_MIN_SLOT,
  DISPLAY_CASE_MAX_SLOT
};

export interface AchievementCriteria {
  stat: AchievementStatKey;
  target: number;
}

export const ACHIEVEMENT_CRITERIA: Record<string, AchievementCriteria> = Object.fromEntries(
  CANONICAL_ACHIEVEMENTS.map((a) => [a.id, { stat: a.statKey, target: a.target }])
);

/** Completed stars are persisted independently of live gameplay progress. */
function completedTiers(companyId: number, def: CanonicalAchievementDef): number {
  const rows = db.prepare('SELECT achievement_id, completed_tiers FROM company_achievements WHERE company_id = ?')
    .all(companyId) as Array<{ achievement_id: string; completed_tiers: number }>;
  const ids = [def.id, ...def.aliases].map(id => id.toLowerCase());
  return Math.min(def.starsMax, rows.reduce((max, row) =>
    ids.includes(row.achievement_id.toLowerCase()) ? Math.max(max, row.completed_tiers) : max, 0));
}

function tierTarget(def: CanonicalAchievementDef, completed: number): number {
  return def.target * (completed + 1);
}

function tierReward(def: CanonicalAchievementDef, completed: number): number {
  return def.rewards?.[completed] ?? def.reward ?? 0;
}

export function getIndividualAchievements(companyId: number): IndividualAchievement[] {
  const stats = getAchievementStats(companyId);
  return ALL_ACHIEVEMENTS.map(ach => {
    const def = CANONICAL_ACHIEVEMENTS.find(def => def.id === ach.id)!;
    const completed = completedTiers(companyId, def);
    const progress = stats[def.statKey];
    const target = tierTarget(def, completed);
    const nextTier = completed + 1;
    return {
      ...ach,
      level: nextTier,
      done: completed,
      available: completed < def.starsMax && progress >= target ? 1 : 0,
      reward: tierReward(def, completed),
      progress,
      target,
      nextAchievement: nextTier < def.starsMax ? {
        name: `${def.label} ${nextTier + 1}`,
        done: 0,
        available: progress >= tierTarget(def, nextTier) ? 1 : 0,
        message: def.message,
        reward: tierReward(def, nextTier),
        sim_boosts: def.simBoosts
      } : null
    };
  }).filter(ach => ach.available > 0);
}

export function claimAchievement(companyId: number, achievementId: string) {
  const normalized = String(achievementId || '').trim().toLowerCase();
  const def = CANONICAL_ACHIEVEMENTS.find(def =>
    [def.id, ...def.aliases].some(id => id.toLowerCase() === normalized) && def.id !== 'daily-production');
  if (!def) throw new DomainError('Achievement not found', 400, 'ACHIEVEMENT_NOT_FOUND');

  return runInTransaction(() => {
    if (!getCompanyById(companyId)) throw new DomainError('Company not found', 400, 'COMPANY_NOT_FOUND');
    const completed = completedTiers(companyId, def);
    if (completed >= def.starsMax) {
      throw new DomainError('Achievement already claimed', 400, 'ACHIEVEMENT_ALREADY_CLAIMED');
    }
    if (getAchievementStats(companyId)[def.statKey] < tierTarget(def, completed)) {
      throw new DomainError('Achievement criteria not met', 400, 'CRITERIA_NOT_MET');
    }
    const cashReward = tierReward(def, completed);
    db.prepare(`
      INSERT INTO company_achievements (company_id, achievement_id, collected_at, completed_tiers)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, achievement_id) DO UPDATE SET
        collected_at = excluded.collected_at, completed_tiers = excluded.completed_tiers
    `).run(companyId, def.id, virtualClock.nowIso(), completed + 1);
    const newSimBoosts = updateCompanySimBoosts(companyId, def.simBoosts);
    const newMoney = updateCompanyMoney(companyId, cashReward);
    return {
      success: true,
      sim_boosts: def.simBoosts,
      simboosts: newSimBoosts,
      simBoosts: newSimBoosts,
      reward: cashReward,
      money: newMoney,
      moneyDelta: cashReward
    };
  });
}

/**
 * Returns summary overview of all 16 achievements matching official SimCompanies HAR contract:
 * GET /api/v2/companies/me/achievements/
 */
export function getAchievementsOverview(companyId: number) {
  const stats = getAchievementStats(companyId);

  return CANONICAL_ACHIEVEMENTS.map(def => {
    const currentStars = completedTiers(companyId, def);
    const isDone = currentStars >= def.starsMax;
    const target = tierTarget(def, currentStars);
    const currentVal = stats[def.statKey];
    const progress = isDone
      ? { percent: 100, label: '已达成' }
      : {
          percent: Math.max(0, Math.min(100, Math.round((currentVal / target) * 100))),
          label: `${currentVal} / ${target}`
        };
    const currentReward = tierReward(def, currentStars);

    return {
      label: def.label,
      stars: currentStars,
      starsMax: def.starsMax,
      type: def.type,
      progress,
      action: isDone ? null : def.action,
      reward: currentReward,
      rewards: def.rewards,
      simBoosts: def.simBoosts,
      id: def.id === 'daily-production' ? null : def.id,
      image: def.image
    };
  });
}

export function getLatestCertificates(realmId: number) {
  return getIssuedLatestCertificates(realmId);
}

export function getRarestCertificates(realmId: number) {
  return getIssuedRarestCertificates(realmId);
}

export function getCertificateDetail(
  realmId: number,
  kind: number,
  certificateId: number | string,
  resourceKind?: string | null
) {
  const detail = getIssuedCertificateDetail(realmId, kind, certificateId, resourceKind ?? '-');
  if (detail || !/^\d+$/.test(String(certificateId)) || Number(certificateId) <= 0) {
    return detail;
  }
  return getIssuedCertificateDetail(realmId, kind, '-', resourceKind ?? '-');
}

export function getCertificates(realmId: number) {
  return getIssuedCertificates(realmId);
}

export function getCompanyCertificates(companyId: number) {
  return getIssuedCompanyCertificates(companyId);
}

export function getCertificateCatalog() {
  return getIssuedCertificateCatalog();
}

/**
 * Live gameplay statistics for a company, derived directly from authoritative game tables.
 */
export function getAchievementStats(companyId: number): Record<AchievementStatKey, number> {
  const count = (sql: string, ...params: SQLInputValue[]): number => {
    try {
      const row = db.prepare(sql).get(...params) as { n: number } | undefined;
      return Math.max(0, Number(row?.n) || 0);
    } catch {
      return 0;
    }
  };

  const comp = db.prepare('SELECT level FROM companies WHERE id = ?').get(companyId) as { level?: number } | undefined;
  const companyLevel = Math.max(1, Number(comp?.level) || 1);
  const research = db.prepare('SELECT patents FROM research WHERE company_id = ?').all(companyId) as Array<{ patents: number }>;

  return {
    marketTrades:
      count(`SELECT COUNT(*) AS n FROM cash_ledger WHERE company_id = ? AND category = 'm'`, companyId) +
      count('SELECT COUNT(*) AS n FROM market_orders WHERE seller_id = ? AND active = 0 AND quantity <= 0', companyId),
    marketSold: count('SELECT COUNT(*) AS n FROM market_orders WHERE seller_id = ? AND active = 0 AND quantity <= 0', companyId),
    productionBatches: count('SELECT COUNT(*) AS n FROM production_queues WHERE company_id = ? AND resolved = 1', companyId),
    retailSales: count('SELECT COUNT(*) AS n FROM retail_sales_history WHERE company_id = ?', companyId),
    upgradedBuildings: count('SELECT COUNT(*) AS n FROM buildings WHERE company_id = ? AND size > 1', companyId),
    totalBuildingSize: count('SELECT COALESCE(SUM(size), 0) AS n FROM buildings WHERE company_id = ?', companyId),
    executiveTrainings: count(`SELECT COUNT(*) AS n FROM cash_ledger WHERE company_id = ? AND category = 'h'`, companyId),
    executivesCount: count('SELECT COUNT(*) AS n FROM executives WHERE company_id = ?', companyId),
    maxResearchQuality: research.reduce((quality, row) => Math.max(quality, getQualityFromPatents(row.patents)), 0),
    researchedQ1Count: research.filter(row => getQualityFromPatents(row.patents) >= 1).length,
    governmentOrdersCompleted: count('SELECT COUNT(DISTINCT bid_secret) AS n FROM government_bid_contractors WHERE company_id = ? AND fulfilled = 1', companyId),
    companyLevel,
    prospectorCount: count("SELECT COUNT(*) AS n FROM audit_logs WHERE company_id = ? AND action = 'demolish_building'", companyId),
    todayActivity: count("SELECT COUNT(*) AS n FROM production_queues WHERE company_id = ? AND datetime(created_at) >= datetime('now', '-1 day')", companyId) +
      count("SELECT COUNT(*) AS n FROM retail_sales_history WHERE company_id = ? AND datetime(sold_at) >= datetime('now', '-1 day')", companyId),
    overachieverRank: companyLevel >= 25 ? 1 : 0
  };
}

