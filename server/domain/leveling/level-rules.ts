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

export function getXpRequiredForLevel(level: number): number {
  const l = Math.max(0, Math.min(60, Math.floor(level)));
  // XP progression curve: starts at 40 XP for L0, gradually increases
  if (l <= 20) {
    return 40 + l * 5; // L0: 40, L1: 45, L2: 50, ..., L5: 65, ..., L20: 140
  }
  if (l <= 40) {
    return 140 + (l - 20) * 8;
  }
  return 300 + (l - 40) * 12;
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
  const xpNeeded = getXpRequiredForLevel(level);

  return {
    level,
    levelName: tier.name,
    ratingCode: company.rating || "BBB",
    inTutorial: false,
    experience,
    experienceToNextLevel: xpNeeded,
    maxBuildings: tier.maxBuildings + (company.extra_building_slots || 0),
    timeLimit: tier.timeLimitS,
    capabilities: {
      scrape: tier.scrape,
      contracts: tier.contracts,
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
