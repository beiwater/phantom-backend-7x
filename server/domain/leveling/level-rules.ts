import { DomainError } from '../../errors/domain-error.ts';

export interface LevelTier {
  start: number;
  kind: string;
  name: string;
  maxBuildings: number;
  scrape: boolean;
  research: boolean;
  contracts: boolean;
  bonds: boolean;
  executives: boolean;
  governmentOrders: boolean;
  hqUpdates: boolean;
  paUpdates: boolean;
  buildingAuctions: boolean;
  seasonal: boolean;
  buyOrders: boolean;
  timeLimitS: number;
}

export const LEVEL_TIERS: LevelTier[] = [
  { start: 0, kind: "Contractor", name: "Contractor", maxBuildings: 4, scrape: false, research: false, contracts: false, bonds: false, executives: false, governmentOrders: false, hqUpdates: false, paUpdates: false, buildingAuctions: false, seasonal: false, buyOrders: false, timeLimitS: 7200 },
  { start: 5, kind: "FamilyBusiness", name: "Family business", maxBuildings: 5, scrape: true, research: false, contracts: true, bonds: false, executives: false, governmentOrders: false, hqUpdates: false, paUpdates: false, buildingAuctions: false, seasonal: true, buyOrders: false, timeLimitS: 86400 },
  { start: 10, kind: "SoleTrader", name: "Sole trader", maxBuildings: 6, scrape: true, research: true, contracts: true, bonds: true, executives: false, governmentOrders: false, hqUpdates: true, paUpdates: true, buildingAuctions: false, seasonal: true, buyOrders: false, timeLimitS: 86400 },
  { start: 15, kind: "SoleTrader", name: "Sole trader", maxBuildings: 8, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: false, hqUpdates: true, paUpdates: true, buildingAuctions: false, seasonal: true, buyOrders: false, timeLimitS: 172800 },
  { start: 20, kind: "LimitedCompany", name: "Limited company", maxBuildings: 10, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: false, timeLimitS: 172800 },
  { start: 25, kind: "LimitedCompany", name: "Limited company", maxBuildings: 12, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 },
  { start: 30, kind: "LimitedCompany", name: "Limited company", maxBuildings: 14, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 },
  { start: 35, kind: "Corporation", name: "Corporation", maxBuildings: 14, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 },
  { start: 40, kind: "Corporation", name: "Corporation", maxBuildings: 14, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 },
  { start: 45, kind: "Corporation", name: "Corporation", maxBuildings: 14, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 },
  { start: 50, kind: "MultinationalCorporation", name: "Multinational corporation", maxBuildings: 14, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 },
  { start: 55, kind: "MultinationalCorporation", name: "Multinational corporation", maxBuildings: 14, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 },
  { start: 60, kind: "Ipo", name: "IPO", maxBuildings: 14, scrape: true, research: true, contracts: true, bonds: true, executives: true, governmentOrders: true, hqUpdates: true, paUpdates: true, buildingAuctions: true, seasonal: true, buyOrders: true, timeLimitS: 172800 }
];

export function getTierForLevel(level: number): LevelTier {
  const normLevel = Math.max(0, Math.min(60, Math.floor(level)));
  let selected = LEVEL_TIERS[0];
  for (const tier of LEVEL_TIERS) {
    if (normLevel >= tier.start) {
      selected = tier;
    } else {
      break;
    }
  }
  return selected;
}
// Issue #71: single canonical capability gate for mutation routes/use cases.
// Reads the tier table via getTierForLevel — never duplicate the unlock
// formula at the call site. Returns the unlock threshold so callers can
// surface "unlocks at level N" to the original frontend.
export interface CapabilityCheck {
  allowed: boolean;
  requiredLevel: number;
}
export type CapabilityKey = Parameters<typeof checkCapability>[1];

// Issue #99: decompiled leveling-guide correction — contracts (send/accept
// supply agreements) unlock at level 2, not at the level-5 tier boundary the
// z9 tier table encodes. The override keeps LEVEL_TIERS canonical while
// checkCapability stays the single decision point for capability gates.
const CAPABILITY_MIN_LEVEL_OVERRIDES: Partial<Record<CapabilityKey, number>> = {
  contracts: 2
};

export function checkCapability(level: number, capability: keyof Omit<LevelTier, 'start' | 'kind' | 'name' | 'maxBuildings' | 'timeLimitS'>): CapabilityCheck {
  const minLevel = CAPABILITY_MIN_LEVEL_OVERRIDES[capability];
  if (minLevel !== undefined) {
    const allowed = Math.max(0, Math.floor(level)) >= minLevel;
    return { allowed, requiredLevel: minLevel };
  }
  const tier = getTierForLevel(level);
  const allowed = Boolean(tier[capability]);
  if (allowed) return { allowed: true, requiredLevel: tier.start };
  const first = LEVEL_TIERS.find(t => Boolean(t[capability]));
  return { allowed: false, requiredLevel: first ? first.start : Infinity };
}

export function assertCapability(level: number, capability: Parameters<typeof checkCapability>[1], subject: string): void {
  const check = checkCapability(level, capability);
  if (!check.allowed) {
    throw new CapabilityError(`Capability "${capability}" (${subject}) unlocks at level ${check.requiredLevel}.`);
  }
}

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityError';
  }

}

// ---------------------------------------------------------------------------
// Issue #99: canonical cumulative XP table (decompiled leveling guide).
// getCumulativeXpForLevel(level) returns the TOTAL accumulated XP required to
// reach `level`. The exact server-side per-level table is not present in the
// decompiled client (data/decompile/leveling.json only ships the s5t chart
// curve), so the audited anchor points below are canonical and intermediate
// levels are linearly interpolated between them.
// ---------------------------------------------------------------------------
export const LEVEL_CAP = 60;

const XP_ANCHORS: ReadonlyArray<readonly [level: number, cumulativeXp: number]> = [
  [0, 0],
  [1, 5],
  [5, 50],
  [10, 550],
  [15, 6_000],
  [20, 68_000],
  [25, 250_000],
  [30, 600_000],
  [35, 1_200_000],
  [40, 2_100_000],
  [45, 3_300_000],
  [50, 4_800_000],
  [55, 6_600_000],
  [60, 8_700_000]
];

export function getCumulativeXpForLevel(level: number): number {
  const l = Math.max(0, Math.min(LEVEL_CAP, Math.floor(level)));
  for (let i = 1; i < XP_ANCHORS.length; i++) {
    const [hiLevel, hiXp] = XP_ANCHORS[i];
    if (l <= hiLevel) {
      const [loLevel, loXp] = XP_ANCHORS[i - 1];
      if (l === loLevel) return loXp;
      return Math.round(loXp + ((hiXp - loXp) * (l - loLevel)) / (hiLevel - loLevel));
    }
  }
  return XP_ANCHORS[XP_ANCHORS.length - 1][1];
}

/**
 * XP a company currently at `level` must still earn to advance to level + 1 —
 * the delta of the canonical cumulative table (Issue #99). At the level cap
 * there is no next level, so the requirement can never be satisfied.
 */
export function getXpRequiredForLevel(level: number): number {
  const l = Math.max(0, Math.min(LEVEL_CAP, Math.floor(level)));
  if (l >= LEVEL_CAP) return Infinity;
  return Math.max(1, getCumulativeXpForLevel(l + 1) - getCumulativeXpForLevel(l));
}

/**
 * Issue #99: queue-duration caps per company tier — 2h at L0-4, 24h at
 * L5-14, 48h at L15+. The tier table carries timeLimitS; queue-start use
 * cases MUST enforce it through this gate instead of treating it as
 * informational.
 */
export class QueueDurationLimitError extends DomainError {
  constructor(durationSeconds: number, limitSeconds: number, subject: string) {
    super(
      `${subject} duration of ${durationSeconds}s exceeds the ${limitSeconds}s queue duration limit for your company level.`,
      400,
      'QUEUE_DURATION_LIMIT'
    );
  }
}

export function assertQueueDuration(level: number, durationSeconds: number, subject: string): void {
  const limit = getTierForLevel(level).timeLimitS;
  if (durationSeconds > limit) {
    throw new QueueDurationLimitError(durationSeconds, limit, subject);
  }
}

export interface LevelInfoDTO {
  level: number;
  levelName: string;
  ratingCode: string;
  inTutorial: boolean;
  experience: number;
  experienceToNextLevel: number;
  maxBuildings: number;
  timeLimit: number;
  capabilities: {
    scrape: boolean;
    contracts: boolean;
    seasonal: boolean;
    research: boolean;
    bonds: boolean;
    executives: boolean;
    governmentOrders: boolean;
    hqUpdates: boolean;
    paUpdates: boolean;
    buildingAuctions: boolean;
    buyOrders: boolean;
  };
  acceleration: {
    multiplier: number;
    until: string | null;
  };
}

export function computeLevelInfo(company: {
  level?: number;
  experience?: number;
  rating?: string;
  extra_building_slots?: number;
}): LevelInfoDTO {
  const level = Number.isFinite(company.level) ? Number(company.level) : 0;
  const experience = Number.isFinite(company.experience) ? Number(company.experience) : 0;
  const tier = getTierForLevel(level);
  // Issue #99: experienceToNextLevel is the canonical cumulative-table delta
  // for the current level; at the cap there is no next level, so the last
  // earned delta is reported (finite, keeps the client XP bar well-defined).
  const xpToNext = level >= LEVEL_CAP
    ? getCumulativeXpForLevel(LEVEL_CAP) - getCumulativeXpForLevel(LEVEL_CAP - 1)
    : getXpRequiredForLevel(level);

  return {
    level,
    levelName: tier.name,
    ratingCode: company.rating || "BBB",
    inTutorial: false,
    experience,
    experienceToNextLevel: xpToNext,
    maxBuildings: tier.maxBuildings + (company.extra_building_slots || 0),
    timeLimit: tier.timeLimitS,
    capabilities: {
      scrape: tier.scrape,
      contracts: checkCapability(level, 'contracts').allowed,
      seasonal: tier.seasonal,
      research: tier.research,
      bonds: tier.bonds,
      executives: tier.executives,
      governmentOrders: tier.governmentOrders,
      hqUpdates: tier.hqUpdates,
      paUpdates: tier.paUpdates,
      buildingAuctions: tier.buildingAuctions,
      buyOrders: tier.buyOrders
    },
    acceleration: {
      multiplier: 1,
      until: null
    }
  };
}
