import { db } from '../db/database.ts';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from './company.ts';
import { getResourceDef } from './constants.ts';
import { getNftAsset } from './collectibles.ts';
import { DomainError } from '../errors/domain-error.ts';

// Issue #88: display case certificate placement verifies ownership against
// the certificates table; importing the certificates domain ensures the table
// exists (and is seeded) before any ownership check runs.
import './certificates.ts';

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS company_achievements (
    company_id INTEGER NOT NULL,
    achievement_id TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    PRIMARY KEY (company_id, achievement_id)
  )
`);

// Issue #88: a display case slot can hold a production resource, a
// certificate, an achievement, or a collectible (NFT). item_kind records
// which, item_ref the achievement id / certificate id / nft asset id.
// Legacy rows default to 'resource' so pre-existing cases keep rendering.
const displayCaseCols = db.prepare('PRAGMA table_info(display_case)').all() as Array<{ name: string }>;
if (!displayCaseCols.some((c) => c.name === 'item_kind')) {
  db.exec("ALTER TABLE display_case ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'resource'");
}
if (!displayCaseCols.some((c) => c.name === 'item_ref')) {
  db.exec('ALTER TABLE display_case ADD COLUMN item_ref TEXT');
}

export interface IndividualAchievement {
  id: string;
  name: string;
  congratulation: string;
  is_daily: boolean;
  is_level: boolean;
  level: number;
  done: number;
  available: number;
  sim_boosts: number;
  reward: number;
  message: string;
  /** Issue #88: live gameplay progress toward the criteria target. */
  progress: number;
  /** Issue #88: gameplay stat value required before the reward can be claimed. */
  target: number;
  nextAchievement: {
    name: string;
    done: number;
    available: number;
    message: string;
    reward: number;
    sim_boosts: number;
  } | null;
}

export const ALL_ACHIEVEMENTS: IndividualAchievement[] = [
  {
    id: "market-tycoon",
    name: "Market Tycoon",
    congratulation: "恭喜达成市场大亨成就！",
    is_daily: false,
    is_level: false,
    level: 1,
    done: 1,
    available: 1,
    sim_boosts: 5,
    reward: 5000,
    message: "在交易所买卖并达成大宗商品交易。",
    nextAchievement: {
      name: "Market Tycoon II",
      done: 2,
      available: 0,
      message: "继续在交易所交易以达到更高星级。",
      reward: 10000,
      sim_boosts: 10
    }
  },
  {
    id: "first-steps",
    name: "First Steps",
    congratulation: "初涉商海，迈出成功第一步！",
    is_daily: false,
    is_level: false,
    level: 1,
    done: 1,
    available: 1,
    sim_boosts: 5,
    reward: 2500,
    message: "在产业地图上兴建并运营你的第一座工厂。",
    nextAchievement: null
  },
  {
    id: "builder",
    name: "Builder",
    congratulation: "建筑大师，产业规模进一步扩张！",
    is_daily: false,
    is_level: false,
    level: 2,
    done: 2,
    available: 1,
    sim_boosts: 5,
    reward: 5000,
    message: "升级建筑以扩大产能和员工规模。",
    nextAchievement: {
      name: "Builder III",
      done: 3,
      available: 0,
      message: "继续升级建筑以达到最高星级。",
      reward: 15000,
      sim_boosts: 10
    }
  },
  {
    id: "employer-of-the-year",
    name: "Employer of the Year",
    congratulation: "卓越雇主，高管团队高效运转！",
    is_daily: false,
    is_level: false,
    level: 1,
    done: 1,
    available: 1,
    sim_boosts: 5,
    reward: 5000,
    message: "招聘并培训管理团队，提升公司运营效益。",
    nextAchievement: null
  }
];

/**
 * Issue #88: pending (uncollected, criteria met) achievements only.
 * `available` is computed from live gameplay progress vs criteria — an
 * uncollected achievement with unmet criteria is NOT available, so a fresh
 * account can claim nothing and this list is empty for it.
 */
export function getIndividualAchievements(companyId: number): IndividualAchievement[] {
  const stats = getAchievementStats(companyId);

  return ALL_ACHIEVEMENTS.map(ach => {
    const criteria = criteriaFor(ach.id);
    const progress = stats[criteria.stat] ?? 0;
    const collected = isCollected(companyId, ach.id);
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
  const ach = ALL_ACHIEVEMENTS.find(a => a.id === achievementId || String(a.id) === String(achievementId));
  if (!ach) {
    // 400 preserves the long-standing claim contract pinned by the issue #51/#53
    // regression suite (unknown and repeated claims cannot mint rewards).
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

  const now = new Date().toISOString();
  const boostReward = ach.sim_boosts || 5;
  const cashReward = ach.reward || 5000;

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
export function getAchievementsOverview(companyId: number) {
  const collected = (id: string): boolean => isCollected(companyId, id);
  const stats = getAchievementStats(companyId);

  // Issue #88: progress percent/label computed from live gameplay stats vs
  // criteria — no static "已达成" placeholders.
  const progressFor = (id: string): { percent: number; label: string } => {
    const criteria = criteriaFor(id);
    const value = stats[criteria.stat] ?? 0;
    if (collected(id)) {
      return { percent: 100, label: '已达成' };
    }
    const percent = Math.max(0, Math.min(100, Math.round((value / criteria.target) * 100)));
    return { percent, label: `${value} / ${criteria.target}` };
  };

  return [
    {
      id: "market-tycoon",
      label: "Market Tycoon",
      action: "在交易所买卖并达成大宗商品交易",
      type: "market-tycoon",
      stars: collected("market-tycoon") ? 2 : 1,
      starsMax: 5,
      reward: 5000,
      simBoosts: 5,
      rewards: [1000, 2500, 5000, 10000, 25000],
      progress: progressFor("market-tycoon"),
      image: "images/achievements/market.png"
    },
    {
      id: "first-steps",
      label: "First Steps",
      action: "建立第一座生产建筑",
      type: "first-steps",
      stars: collected("first-steps") ? 2 : 1,
      starsMax: 5,
      reward: 2500,
      simBoosts: 5,
      rewards: [500, 1000, 2500, 5000, 10000],
      progress: progressFor("first-steps"),
      image: "images/achievements/general.png"
    },
    {
      id: "builder",
      label: "Builder",
      action: "升级产业建筑规模",
      type: "builder",
      stars: collected("builder") ? 3 : 2,
      starsMax: 5,
      reward: 5000,
      simBoosts: 5,
      rewards: [1000, 2500, 5000, 10000, 25000],
      progress: progressFor("builder"),
      image: "images/achievements/construction.png"
    },
    {
      id: "employer-of-the-year",
      label: "Employer of the Year",
      action: "管理并培训高管团队",
      type: "employer-of-the-year",
      stars: collected("employer-of-the-year") ? 2 : 1,
      starsMax: 5,
      reward: 5000,
      simBoosts: 5,
      rewards: [1000, 2500, 5000, 10000, 25000],
      progress: progressFor("employer-of-the-year"),
      image: "images/achievements/executives.png"
    }
  ];
}

export interface DisplayCaseRow {
  id: number;
  company_id: number;
  slot: number;
  resource_kind: number;
  quality: number;
  title: string;
  item_kind?: string;
  item_ref?: string | null;
}

export type DisplayItemKind = 'resource' | 'certificate' | 'achievement' | 'collectible';

export interface DisplayCasePlacement {
  slot: number;
  itemKind: DisplayItemKind;
  achievementId?: string;
  certificateId?: number;
  nftId?: number;
  resourceKind?: number;
  quality?: number;
  title?: string;
}

/** Hard slot bounds of the display case (decompiled spec: max 12 slots). */
export const DISPLAY_CASE_MIN_SLOT = 1;
export const DISPLAY_CASE_MAX_SLOT = 12;

/**
 * Issue #88: placing an item requires OWNING it.
 *   achievement  → must be in company_achievements (already claimed)
 *   certificate  → must be a certificates row awarded to this company
 *   collectible  → NFT asset whose current owner is this company (issue #100
 *                  collectibles domain: getNftAsset().currentOwnerId)
 * Violations fail closed with 400 ITEM_NOT_OWNED.
 */
function assertItemOwnership(companyId: number, placement: DisplayCasePlacement): void {
  if (placement.itemKind === 'achievement') {
    const achievementId = String(placement.achievementId ?? '');
    if (!achievementId) {
      throw new DomainError('achievement_id is required to display an achievement', 400, 'INVALID_ITEM');
    }
    if (!isCollected(companyId, achievementId)) {
      throw new DomainError('You do not own this achievement', 400, 'ITEM_NOT_OWNED');
    }
    return;
  }

  if (placement.itemKind === 'certificate') {
    const certificateId = Number(placement.certificateId);
    if (!Number.isSafeInteger(certificateId) || certificateId <= 0) {
      throw new DomainError('certificate_id is required to display a certificate', 400, 'INVALID_ITEM');
    }
    const owned = db.prepare('SELECT 1 FROM certificates WHERE id = ? AND company_id = ?')
      .get(certificateId, companyId);
    if (!owned) {
      throw new DomainError('You do not own this certificate', 400, 'ITEM_NOT_OWNED');
    }
    return;
  }

  if (placement.itemKind === 'collectible') {
    const nftId = Number(placement.nftId);
    if (!Number.isSafeInteger(nftId) || nftId <= 0) {
      throw new DomainError('nft_id is required to display a collectible', 400, 'INVALID_ITEM');
    }
    let asset: { currentOwnerId?: number | null } | null = null;
    try {
      asset = getNftAsset(nftId);
    } catch {
      asset = null;
    }
    if (!asset || Number(asset.currentOwnerId) !== companyId) {
      throw new DomainError('You do not own this collectible', 400, 'ITEM_NOT_OWNED');
    }
  }
}

export function getDisplayCase(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM display_case WHERE company_id = ? ORDER BY slot ASC
  `).all(companyId) as unknown as DisplayCaseRow[];

  return rows.map(r => {
    const itemKind = (r.item_kind || 'resource') as DisplayItemKind;
    if (itemKind === 'resource') {
      return {
        slot: r.slot,
        itemKind,
        resource: {
          kind: r.resource_kind,
          quality: r.quality,
          title: r.title
        }
      };
    }
    const item: Record<string, unknown> = {
      slot: r.slot,
      itemKind,
      title: r.title
    };
    if (itemKind === 'achievement') item.achievement = { id: r.item_ref, name: r.title };
    if (itemKind === 'certificate') item.certificate = { id: Number(r.item_ref), name: r.title };
    if (itemKind === 'collectible') item.collectible = { id: Number(r.item_ref), name: r.title };
    return item;
  });
}

export function updateDisplayCase(companyId: number, placement: DisplayCasePlacement) {
  const slot = Number(placement.slot);
  if (!Number.isSafeInteger(slot) || slot < DISPLAY_CASE_MIN_SLOT || slot > DISPLAY_CASE_MAX_SLOT) {
    throw new DomainError(
      `Display case slot must be between ${DISPLAY_CASE_MIN_SLOT} and ${DISPLAY_CASE_MAX_SLOT}`,
      400,
      'INVALID_SLOT'
    );
  }

  if (placement.itemKind === 'resource') {
    const resourceKind = Number(placement.resourceKind);
    const quality = Number(placement.quality ?? 0);
    if (!Number.isSafeInteger(resourceKind) || resourceKind <= 0 || !getResourceDef(resourceKind)) {
      throw new DomainError('Unknown resource kind', 400, 'INVALID_ITEM');
    }
    if (!Number.isSafeInteger(quality) || quality < 0 || quality > 12) {
      throw new DomainError('Resource quality must be between 0 and 12', 400, 'INVALID_ITEM');
    }
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
      db.prepare(`
        INSERT INTO display_case (company_id, slot, resource_kind, quality, title, item_kind, item_ref)
        VALUES (?, ?, ?, ?, ?, 'resource', NULL)
      `).run(companyId, slot, resourceKind, quality, placement.title ?? '');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return getDisplayCase(companyId);
  }

  assertItemOwnership(companyId, placement);

  let itemRef: string;
  let title: string;
  if (placement.itemKind === 'achievement') {
    itemRef = String(placement.achievementId);
    title = placement.title ?? ALL_ACHIEVEMENTS.find(a => a.id === itemRef)?.name ?? itemRef;
  } else if (placement.itemKind === 'certificate') {
    itemRef = String(Number(placement.certificateId));
    title = placement.title
      ?? (db.prepare('SELECT name FROM certificates WHERE id = ? AND company_id = ?')
        .get(Number(itemRef), companyId) as { name?: string } | undefined)?.name
      ?? `Certificate #${itemRef}`;
  } else {
    itemRef = String(Number(placement.nftId));
    title = placement.title ?? `Collectible #${itemRef}`;
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
    db.prepare(`
      INSERT INTO display_case (company_id, slot, resource_kind, quality, title, item_kind, item_ref)
      VALUES (?, ?, 0, 0, ?, ?, ?)
    `).run(companyId, slot, title, placement.itemKind, itemRef);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getDisplayCase(companyId);
}

export function removeDisplayCaseSlot(companyId: number, slot: number) {
  db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
  return getDisplayCase(companyId);
}

export function getCertificates(realmId: number) {
  // Certificates derive from real collected achievements: one certificate per
  // collected achievement, ranked by (level, unlock time) within its
  // achievement id. No hardcoded entries.
  const rows = db.prepare(`
    SELECT a.achievement_id, a.collected_at, a.company_id, c.name
    FROM company_achievements a
    JOIN companies c ON c.company_id = a.company_id
    ORDER BY a.achievement_id ASC, a.collected_at ASC
  `).all() as Array<{
    achievement_id: number | string;
    claimed_at: string;
    company_id: number;
    name: string;
  }>;

  const rankCounter = new Map<string, number>();
  const certificates: Array<{ id: number; title: string; company: string; companyId: number; date: string; rank: number }> = [];
  let certId = 1;
  for (const row of rows) {
    const def = ALL_ACHIEVEMENTS.find(a => String(a.id) === String(row.achievement_id));
    const title = def ? def.name : `Achievement #${row.achievement_id}`;
    const key = String(row.achievement_id);
    const rank = (rankCounter.get(key) ?? 0) + 1;
    rankCounter.set(key, rank);
    certificates.push({
      id: certId++,
      title,
      company: row.name || `Company #${row.company_id}`,
      companyId: row.company_id,
      date: row.collected_at,
      rank
    });
  }
  return certificates;
}

// ---------------------------------------------------------------------------
// Issue #88: criteria engine. Every achievement is gated on real gameplay
// statistics (market fills, resolved production batches, upgraded buildings,
// executive training spend). Claiming re-evaluates the stats authoritatively —
// a fresh account can claim nothing.
// ---------------------------------------------------------------------------

export type AchievementStatKey =
  | 'marketTrades'
  | 'productionBatches'
  | 'upgradedBuildings'
  | 'executiveTrainings';

export interface AchievementCriteria {
  stat: AchievementStatKey;
  target: number;
}

export const ACHIEVEMENT_CRITERIA: Record<string, AchievementCriteria> = {
  'market-tycoon': { stat: 'marketTrades', target: 1 },
  'first-steps': { stat: 'productionBatches', target: 1 },
  'builder': { stat: 'upgradedBuildings', target: 1 },
  'employer-of-the-year': { stat: 'executiveTrainings', target: 1 }
};

/**
 * Live gameplay statistics for a company, each derived from authoritative
 * game tables — never from the achievements tables themselves:
 *   marketTrades        completed exchange fills: market purchases
 *                       (cash_ledger category 'm') plus fully-sold own sell
 *                       orders (active=0, quantity=0)
 *   productionBatches   production queue batches resolved & collected
 *   upgradedBuildings   buildings raised above their constructed size
 *   executiveTrainings  executive training payments (cash_ledger category 'h')
 */
export function getAchievementStats(companyId: number): Record<AchievementStatKey, number> {
  const count = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { n: number } | undefined;
    return Math.max(0, Number(row?.n) || 0);
  };
  return {
    marketTrades:
      count(`SELECT COUNT(*) AS n FROM cash_ledger WHERE company_id = ? AND category = 'm'`, companyId) +
      count('SELECT COUNT(*) AS n FROM market_orders WHERE seller_id = ? AND active = 0 AND quantity <= 0', companyId),
    productionBatches: count('SELECT COUNT(*) AS n FROM production_queues WHERE company_id = ? AND resolved = 1', companyId),
    upgradedBuildings: count('SELECT COUNT(*) AS n FROM buildings WHERE company_id = ? AND size > 1', companyId),
    executiveTrainings: count(`SELECT COUNT(*) AS n FROM cash_ledger WHERE company_id = ? AND category = 'h'`, companyId)
  };
}

function criteriaFor(achievementId: string): AchievementCriteria {
  return ACHIEVEMENT_CRITERIA[achievementId] ?? { stat: 'marketTrades', target: 1 };
}

function isCollected(companyId: number, achievementId: string): boolean {
  const row = db.prepare(
    'SELECT 1 FROM company_achievements WHERE company_id = ? AND achievement_id = ?'
  ).get(companyId, achievementId);
  return row !== undefined;
}
