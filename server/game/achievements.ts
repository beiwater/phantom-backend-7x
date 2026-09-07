import { db } from '../db/database.ts';
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
  isAchievementCollected,
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

/**
 * Issue #88 / User Request: pending (uncollected, criteria met) achievements only.
 * `available` is computed from live gameplay progress vs criteria.
 */
export function getIndividualAchievements(companyId: number): IndividualAchievement[] {
  const stats = getAchievementStats(companyId);

  return ALL_ACHIEVEMENTS.map(ach => {
    const criteria = criteriaFor(ach.id);
    const progress = stats[criteria.stat] ?? 0;
    const collected = isAchievementCollected(companyId, ach.id);
    return {
      ...ach,
      done: collected ? 1 : 0,
      available: !collected && progress >= criteria.target ? 1 : 0,
      progress,
      target: criteria.target
    };
  }).filter(ach => ach.available > 0);
}

export function claimAchievement(companyId: number, achievementId: string) {
  const normalizedId = String(achievementId || '').trim();
  const ach = ALL_ACHIEVEMENTS.find(
    a => a.id === normalizedId || a.id.toLowerCase() === normalizedId.toLowerCase()
  ) ?? CANONICAL_ACHIEVEMENTS.find(
    c => c.id === normalizedId || c.aliases.includes(normalizedId)
  );

  if (!ach) {
    throw new DomainError('Achievement not found', 400, 'ACHIEVEMENT_NOT_FOUND');
  }

  const comp = getCompanyById(companyId);
  if (!comp) {
    throw new DomainError('Company not found', 400, 'COMPANY_NOT_FOUND');
  }

  // Issue #88: authoritative criteria validation on claim — re-evaluates real
  // gameplay statistics; never trust the pending list the client saw.
  const criteria = criteriaFor(ach.id);
  const progress = getAchievementStats(companyId)[criteria.stat] ?? 0;
  if (progress < criteria.target) {
    throw new DomainError('Achievement criteria not met', 400, 'CRITERIA_NOT_MET');
  }

  const now = virtualClock.nowIso();
  const boostReward = ('sim_boosts' in ach ? ach.sim_boosts : ach.simBoosts) || 5;
  const cashReward = ('reward' in ach && typeof ach.reward === 'number' ? ach.reward : (ach.rewards?.[0] ?? 5000));

  db.exec('BEGIN');
  try {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO company_achievements (company_id, achievement_id, collected_at)
      VALUES (?, ?, ?)
    `).run(companyId, ach.id, now);
    if (inserted.changes !== 1) {
      throw new DomainError('Achievement already claimed', 400, 'ACHIEVEMENT_ALREADY_CLAIMED');
    }

    const newSimBoosts = updateCompanySimBoosts(companyId, boostReward);
    const newMoney = updateCompanyMoney(companyId, cashReward);
    db.exec('COMMIT');

    return {
      success: true,
      sim_boosts: boostReward,
      simboosts: newSimBoosts,
      simBoosts: newSimBoosts,
      reward: cashReward,
      money: newMoney,
      moneyDelta: cashReward
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Returns summary overview of all 16 achievements matching official SimCompanies HAR contract:
 * GET /api/v2/companies/me/achievements/
 */
export function getAchievementsOverview(companyId: number) {
  const collected = (id: string): boolean => isAchievementCollected(companyId, id);
  const stats = getAchievementStats(companyId);

  return CANONICAL_ACHIEVEMENTS.map(def => {
    const isDone = collected(def.id) || def.aliases.some(alias => collected(alias));
    const criteria = criteriaFor(def.id);
    const currentVal = stats[criteria.stat] ?? 0;

    const progress = isDone
      ? { percent: 100, label: '已达成' }
      : {
          percent: Math.max(0, Math.min(100, Math.round((currentVal / criteria.target) * 100))),
          label: `${currentVal} / ${criteria.target}`
        };

    const currentStars = isDone ? def.starsMax : 0;
    const currentReward = def.rewards && def.rewards.length > 0
      ? def.rewards[Math.min(currentStars, def.rewards.length - 1)]
      : def.reward;

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
  const count = (sql: string, ...params: unknown[]): number => {
    try {
      const row = db.prepare(sql).get(...params) as { n: number } | undefined;
      return Math.max(0, Number(row?.n) || 0);
    } catch {
      return 0;
    }
  };

  const comp = db.prepare('SELECT level FROM companies WHERE id = ?').get(companyId) as { level?: number } | undefined;
  const companyLevel = Math.max(1, Number(comp?.level) || 1);

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
    maxResearchQuality: count('SELECT COALESCE(MAX(quality), 0) AS n FROM research WHERE company_id = ?', companyId),
    researchedQ1Count: count('SELECT COUNT(DISTINCT resource_kind) AS n FROM research WHERE company_id = ? AND quality >= 1', companyId),
    governmentOrdersCompleted: count('SELECT COUNT(*) AS n FROM government_orders WHERE company_id = ? AND resourceMultiplierAwarded IS NOT NULL', companyId),
    companyLevel,
    prospectorCount: count("SELECT COUNT(*) AS n FROM audit_logs WHERE company_id = ? AND action = 'demolish_building'", companyId),
    todayActivity: count("SELECT COUNT(*) AS n FROM production_queues WHERE company_id = ? AND datetime(created_at) >= datetime('now', '-1 day')", companyId) +
      count("SELECT COUNT(*) AS n FROM retail_sales_history WHERE company_id = ? AND datetime(sold_at) >= datetime('now', '-1 day')", companyId),
    overachieverRank: companyLevel >= 25 ? 1 : 0
  };
}

function criteriaFor(achievementId: string): AchievementCriteria {
  const normalized = String(achievementId || '').trim();
  if (ACHIEVEMENT_CRITERIA[normalized]) {
    return ACHIEVEMENT_CRITERIA[normalized];
  }
  const matched = CANONICAL_ACHIEVEMENTS.find(c => c.id === normalized || c.aliases.includes(normalized));
  if (matched) {
    return { stat: matched.statKey, target: matched.target };
  }
  return { stat: 'marketTrades', target: 1 };
}
