/**
 * Executive Selectors & Skill Calculations
 * 
 * Provenance:
 * - sourceBundle: "frontend-original/static/bundle/assets/index-cgzgptQ8.js"
 * - byteRange: [2165147, 2167000]
 * - symbols: HT, Ts, H6t, jhe, V6t, z6t, rd, Yd, k6, Lx, Fhe, G6t
 */

export type ExecutiveRole = 'coo' | 'cfo' | 'cmo' | 'cto';

export interface WorkHistory {
  position: string;
  start: string;
  accelerated?: boolean;
}

export interface TrainingRecord {
  datetime: string;
  accelerated?: boolean;
}

export interface Executive {
  id: number | string;
  skills?: Record<ExecutiveRole, number>;
  currentWorkHistory: WorkHistory;
  currentTraining?: TrainingRecord | null;
  strikeUntil?: string | null;
  isCandidate?: boolean;
}

// Position code constants
export const CHIEF_EXECUTIVE_CODES: string[] = ['o', 'f', 'm', 't']; // COO, CFO, CMO, CTO

export const APPRENTICE_POSITIONS = {
  COO_APPRENTICE: 'COO_APPRENTICE',
  CFO_APPRENTICE: 'CFO_APPRENTICE',
  CMO_APPRENTICE: 'CMO_APPRENTICE',
  CTO_APPRENTICE: 'CTO_APPRENTICE',
} as const;

export const JUNIOR_STAFF_POSITIONS = ['G1', 'G2', 'G3', 'G4', 'G5'] as const;

// Time constants
export const TIME_CONSTANTS = {
  SETTLE_IN_SECONDS: 10800, // 3 hours onboarding
  TRAINING_SECONDS: 97200,  // 27 hours university course
  CUTOFF_TIER_1: 60,        // First diminishing returns threshold
  CUTOFF_TIER_2: 80,        // Second diminishing returns threshold
} as const;

/**
 * Checks if position is one of the four C-Suite chief executives.
 * (original minified symbol: k6)
 */
export function isChiefExecutivePosition(position: string): boolean {
  return CHIEF_EXECUTIVE_CODES.indexOf(position) !== -1;
}

/**
 * Checks if position is an apprentice / trainee.
 * (original minified symbol: Lx)
 */
export function isApprenticePosition(position: string): boolean {
  return [
    APPRENTICE_POSITIONS.COO_APPRENTICE,
    APPRENTICE_POSITIONS.CFO_APPRENTICE,
    APPRENTICE_POSITIONS.CMO_APPRENTICE,
    APPRENTICE_POSITIONS.CTO_APPRENTICE,
  ].indexOf(position as any) !== -1;
}

/**
 * Checks if position is in the junior staff pool.
 * (original minified symbol: Fhe)
 */
export function isJuniorStaffPosition(position: string): boolean {
  return (JUNIOR_STAFF_POSITIONS as readonly string[]).indexOf(position) !== -1;
}

/**
 * Checks if an apprentice slot is unlocked based on company level / capacity.
 * (original minified symbol: G6t)
 */
export function isApprenticeSlotUnlocked(position: string, unlockedSlots: number): boolean {
  if (position === APPRENTICE_POSITIONS.COO_APPRENTICE) return unlockedSlots >= 5;
  if (position === APPRENTICE_POSITIONS.CFO_APPRENTICE) return unlockedSlots >= 10;
  if (position === APPRENTICE_POSITIONS.CMO_APPRENTICE) return unlockedSlots >= 15;
  if (position === APPRENTICE_POSITIONS.CTO_APPRENTICE) return unlockedSlots >= 20;
  return false;
}

/**
 * Gets executives currently in the 3-hour onboarding / settling-in cooldown.
 * (original minified symbol: jhe)
 */
export function getSettlingExecutives(executives: Executive[], nowMs: number): Executive[] {
  const settleDurationMs = TIME_CONSTANTS.SETTLE_IN_SECONDS * 1000;
  return executives.filter(exec => {
    const startMs = Date.parse(exec.currentWorkHistory.start);
    const elapsed = nowMs - startMs;
    const isRelevantPosition = isChiefExecutivePosition(exec.currentWorkHistory.position) ||
      isApprenticePosition(exec.currentWorkHistory.position);
    return isRelevantPosition && elapsed < settleDurationMs && !exec.currentWorkHistory.accelerated && !exec.isCandidate;
  });
}

/**
 * Gets executives currently attending training / university courses.
 * (original minified symbol: V6t)
 */
export function getTrainingExecutives(executives: Executive[], nowMs: number): Executive[] {
  const trainingDurationMs = TIME_CONSTANTS.TRAINING_SECONDS * 1000;
  return executives.filter(exec => {
    if (!exec.currentTraining || exec.currentTraining.accelerated) return false;
    const trainingTimeMs = Date.parse(exec.currentTraining.datetime);
    return trainingTimeMs && trainingTimeMs > nowMs - trainingDurationMs;
  });
}

/**
 * Gets executives currently on strike.
 * (original minified symbol: z6t)
 */
export function getStrikingExecutives(executives: Executive[], nowMs: number): Executive[] {
  return executives.filter(exec => !!exec.strikeUntil && Date.parse(exec.strikeUntil) > nowMs);
}

/**
 * Filters executives down to those actively working and providing bonuses.
 * Excludes settling, training, striking, and locked apprentices.
 * (original minified symbol: rd)
 */
export function getActiveWorkingExecutives(executives: Executive[], unlockedApprenticeSlots: number): Executive[] {
  const nowMs = Date.now();
  const nonStaff = executives.filter(exec => !isJuniorStaffPosition(exec.currentWorkHistory.position));

  const settlingIds = new Set(getSettlingExecutives(nonStaff, nowMs).map(e => e.id));
  const trainingIds = new Set(getTrainingExecutives(nonStaff, nowMs).map(e => e.id));
  const strikingIds = new Set(getStrikingExecutives(nonStaff, nowMs).map(e => e.id));

  return nonStaff
    .filter(exec => !settlingIds.has(exec.id) && !strikingIds.has(exec.id) && !trainingIds.has(exec.id))
    .filter(exec => !isApprenticePosition(exec.currentWorkHistory.position) ||
      isApprenticeSlotUnlocked(exec.currentWorkHistory.position, unlockedApprenticeSlots));
}

/**
 * Applies the official diminishing returns piecewise curve to raw executive skills:
 * - Skill <= 60: 100% effective
 * - 60 < Skill <= 80: 50% effectiveness for points above 60
 * - Skill > 80: 25% effectiveness for points above 80
 * (original minified symbol: H6t)
 */
export function applyDiminishingReturnsSkillCurve(rawSkill: number): number {
  let effective = rawSkill;
  if (effective > TIME_CONSTANTS.CUTOFF_TIER_2) {
    effective = TIME_CONSTANTS.CUTOFF_TIER_2 + (effective - TIME_CONSTANTS.CUTOFF_TIER_2) / 2;
  }
  if (effective > TIME_CONSTANTS.CUTOFF_TIER_1) {
    effective = TIME_CONSTANTS.CUTOFF_TIER_1 + (effective - TIME_CONSTANTS.CUTOFF_TIER_1) / 2;
  }
  return effective;
}

/**
 * Calculates total raw skill points for a role:
 * - Chief executive provides 100% of their skill.
 * - Apprentice executive provides 25% of their skill.
 * (original minified symbol: HT)
 */
export function calculateRawExecutiveSkillByRole(activeExecutives: Executive[], role: ExecutiveRole): number {
  const roleToChiefCode: Record<ExecutiveRole, string> = {
    coo: 'o',
    cfo: 'f',
    cmo: 'm',
    cto: 't',
  };

  const roleToApprenticeCode: Record<ExecutiveRole, string> = {
    coo: APPRENTICE_POSITIONS.COO_APPRENTICE,
    cfo: APPRENTICE_POSITIONS.CFO_APPRENTICE,
    cmo: APPRENTICE_POSITIONS.CMO_APPRENTICE,
    cto: APPRENTICE_POSITIONS.CTO_APPRENTICE,
  };

  const total = activeExecutives.reduce((sum, exec) => {
    if (!exec.skills || typeof exec.skills[role] !== 'number') return sum;
    const pos = exec.currentWorkHistory.position;
    if (pos === roleToChiefCode[role]) {
      return sum + exec.skills[role];
    }
    if (pos === roleToApprenticeCode[role]) {
      return sum + exec.skills[role] / 4;
    }
    return sum;
  }, 0);

  return Math.floor(total);
}

/**
 * Calculates effective executive skill points for a role after applying diminishing returns.
 * (original minified symbol: Ts)
 */
export function calculateEffectiveExecutiveSkillByRole(activeExecutives: Executive[], role: ExecutiveRole): number {
  const rawSkill = calculateRawExecutiveSkillByRole(activeExecutives, role);
  return Math.floor(applyDiminishingReturnsSkillCurve(rawSkill));
}

/**
 * Calculates the administration overhead percentage discounted by CFO skill.
 * (original minified symbol: Yd)
 */
export function calculateDiscountedAdministrationOverhead(baseOverhead: number, cfoDiscountPercent: number): number {
  const base = baseOverhead || 1.0;
  return base - (base - 1.0) * (cfoDiscountPercent / 100);
}
