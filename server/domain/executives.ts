/**
 * Executive domain rules (Issue #179 vertical migration).
 *
 * Pure, side-effect-free rules extracted verbatim from the legacy
 * game/executives.ts engine: agency tiers and fee multipliers, position and
 * offer-status normalizers, deterministic avatar genome generation, academy
 * bonus cadence and training cost/window constants.
 */

export const EXECUTIVE_TRAINING_COST = 30000;

export const AgencyTier = {
  IN_HOUSE: 1,
  STAFFING_AGENCY: 2,
  GOOD_AGENCY: 3,
  TOP_TALENT_AGENCY: 4
} as const;
export type AgencyTierValue = (typeof AgencyTier)[keyof typeof AgencyTier];

export const AGENCY_FEE_MULTIPLIERS: Record<number, number> = {
  [AgencyTier.IN_HOUSE]: 0,         // 0x
  [AgencyTier.STAFFING_AGENCY]: 0.5, // 0.5x expected salary
  [AgencyTier.GOOD_AGENCY]: 2.0,     // 2.0x expected salary
  [AgencyTier.TOP_TALENT_AGENCY]: 5.0 // 5.0x expected salary
};

export const EXECUTIVE_TRAINING_WINDOW_S = 97200; // 27h (client constant Y$)

// Issue #165: the original client schedules a training for $10,000 (client
// constant gPt) that completes 27h later, with a SimBoosts rush priced at
// ceil(remaining / 6min) — the same pricing formula used for settling in.
export const EXECUTIVE_TRAINING_MONEY_COST = 10000;

export function parseAgencyTier(agency: number | string | undefined): number {
  if (typeof agency === 'string') {
    const norm = agency.trim().toUpperCase();
    if (norm === 'IN_HOUSE' || norm === '1') return AgencyTier.IN_HOUSE;
    if (norm === 'STAFFING_AGENCY' || norm === '2') return AgencyTier.STAFFING_AGENCY;
    if (norm === 'GOOD_AGENCY' || norm === '3') return AgencyTier.GOOD_AGENCY;
    if (norm === 'TOP_TALENT_AGENCY' || norm === '4') return AgencyTier.TOP_TALENT_AGENCY;
  }
  if (typeof agency === 'number' && agency >= 1 && agency <= 4) {
    return agency;
  }
  return AgencyTier.IN_HOUSE;
}

export function normalizeOfferStatus(status: string): string {
  const s = (status || '').trim();
  const lower = s.toLowerCase();
  if (lower === 'ru.found' || lower === 'found' || lower === 'f') return 'f';
  if (lower === 'ru.standing' || lower === 'standing' || lower === 's') return 's';
  if (lower === 'ru.refused' || lower === 'refused' || lower === 'r') return 'r';
  if (lower === 'ru.outdated' || lower === 'outdated' || lower === 'o') return 'o';
  if (lower === 'ru.failed' || lower === 'failed' || lower === 'x') return 'x';
  if (lower === 'ru.accepted' || lower === 'accepted' || lower === 'a') return 'a';
  if (lower === 'ru.looking' || lower === 'looking' || lower === 'l') return 'l';
  return s || 'f';
}

export function normalizePositionCode(pos: string | null | undefined): string {
  if (!pos) return 'none';
  const lower = pos.toLowerCase();
  if (lower === 'o' || lower === 'coo') return 'o';
  if (lower === 'f' || lower === 'cfo') return 'f';
  if (lower === 'm' || lower === 'cmo') return 'm';
  if (lower === 't' || lower === 'cto') return 't';
  if (lower === 'v' || lower === 'coo_apprentice' || lower === 'coo-apprentice') return 'v';
  if (lower === 'x' || lower === 'cfo_apprentice' || lower === 'cfo-apprentice') return 'x';
  if (lower === 'y' || lower === 'cmo_apprentice' || lower === 'cmo-apprentice') return 'y';
  if (lower === 'z' || lower === 'cto_apprentice' || lower === 'cto-apprentice') return 'z';
  if (lower === '1' || lower === 'g1') return '1';
  if (lower === '2' || lower === 'g2') return '2';
  if (lower === '3' || lower === 'g3') return '3';
  if (lower === '4' || lower === 'g4') return '4';
  if (lower === '5' || lower === 'g5') return '5';
  if (lower === 'none' || lower === 'unassigned') return 'none';
  return lower;
}

export function validIsoOrNull(val: unknown): string | null {
  if (!val || typeof val !== 'string') return null;
  const parsed = Date.parse(val);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function academySkillBonus(activeLevels: number): number {
  return Math.min(2, Math.floor(activeLevels / 5));
}

interface GeneLimits {
  eyes: number;
  hair: number;
  tatoos: number;
  cloths: number;
  accessories: number;
}

const MALE_GENES: Record<string, GeneLimits> = {
  '01': { eyes: 4, hair: 10, tatoos: 1, cloths: 18, accessories: 4 },
  '02': { eyes: 4, hair: 14, tatoos: 1, cloths: 18, accessories: 4 },
  '03': { eyes: 4, hair: 10, tatoos: 1, cloths: 18, accessories: 4 },
  '04': { eyes: 4, hair: 32, tatoos: 1, cloths: 18, accessories: 4 },
  '05': { eyes: 4, hair: 23, tatoos: 1, cloths: 18, accessories: 4 },
};

const FEMALE_GENES: Record<string, GeneLimits> = {
  '01': { eyes: 5, hair: 11, tatoos: 1, cloths: 16, accessories: 5 },
  '02': { eyes: 5, hair: 7,  tatoos: 1, cloths: 17, accessories: 5 },
  '05': { eyes: 5, hair: 7,  tatoos: 1, cloths: 23, accessories: 5 },
};

const FEMALE_NAMES = new Set(['elena', 'sophia', 'sarah', 'emma', 'olivia', 'isabella', 'mia', 'ava', 'chloe', 'emily', 'grace', 'hannah', 'lily', 'natalie', 'zoe', 'anna', 'laura', 'maria', 'rachel', 'jessica', 'victoria', 'lucy']);
const MALE_NAMES = new Set(['alexander', 'david', 'marcus', 'lucas', 'gordon', 'maitre', 'john', 'michael', 'james', 'robert', 'william', 'richard', 'thomas', 'charles', 'daniel', 'matthew', 'anthony', 'donald', 'paul', 'mark', 'george', 'steven', 'edward', 'brian', 'kevin']);

export function generateDeterministicGenome(seed: number | string, avatar?: string | null, name?: string | null): { genome: string; age: number } {
  let hash = 0;
  const str = String(seed || '') + String(avatar || '') + String(name || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash);

  const firstName = String(name || '').trim().split(/\s+/)[0]?.toLowerCase();
  let isFemale = false;
  if (avatar && avatar.includes('female')) {
    isFemale = true;
  } else if (avatar && avatar.includes('male')) {
    isFemale = false;
  } else if (firstName && FEMALE_NAMES.has(firstName)) {
    isFemale = true;
  } else if (firstName && MALE_NAMES.has(firstName)) {
    isFemale = false;
  } else {
    isFemale = (h % 3 === 0);
  }
  const gender = isFemale ? 'female' : 'male';
  const geneDict = isFemale ? FEMALE_GENES : MALE_GENES;
  const modelKeys = Object.keys(geneDict);
  const model = modelKeys[h % modelKeys.length];
  const limits = geneDict[model];

  const eyes = (Math.floor(h / 7)) % limits.eyes;
  const hair = (Math.floor(h / 13)) % limits.hair;
  const tatoos = 0;
  const cloths = (Math.floor(h / 19)) % limits.cloths;
  const accessories = (Math.floor(h / 23)) % limits.accessories;

  const age = 28 + (h % 35);
  const genome = `${gender}-${model}-${eyes}-${hair}-${tatoos}-${cloths}-${accessories}`;
  return { genome, age };
}
