export const DAY_MS = 86400000;

export const ECONOMY_STATE_NAMES: Record<number, string> = {
  0: 'Recession',
  1: 'Normal',
  2: 'Boom'
};

export const ECONOMY_PHASE_NAMES: Record<number, 'recession' | 'normal' | 'boom'> = {
  0: 'recession',
  1: 'normal',
  2: 'boom'
};

export interface EconomyPhaseStatus {
  realmId: number;
  state: number;
  phase: 'recession' | 'normal' | 'boom';
  stateName: string;
  status: 'active' | 'ended';
  startAt: string;
  endAt: string | null;
  updatedAt: string | null;
  source: string;
  productionModifier: number;
  productionBonus: number;
  productionMalus: number;
  modifierKind: 'bonus' | 'malus' | 'neutral';
  modifierSeed: number;
}

export interface EconomyPhaseHistoryEntry {
  id: number;
  realmId: number;
  state: number;
  phase: 'recession' | 'normal' | 'boom';
  stateName: string;
  status: 'active' | 'ended';
  startAt: string;
  endAt: string | null;
  source: string;
  generatedAt: string;
  durationDays: number;
  productionModifier: number;
  productionBonus: number;
  productionMalus: number;
  modifierKind: 'bonus' | 'malus' | 'neutral';
  modifierSeed: number;
}

export interface EconomyProductionModifier {
  realmId: number;
  state: number;
  phase: 'recession' | 'normal' | 'boom';
  value: number;
  kind: 'bonus' | 'malus' | 'neutral';
  seed: number;
  source: 'cycle';
}

export const ECONOMY_MODIFIER_RANGES: Record<number, readonly [number, number]> = {
  0: [-0.12, 0.06],
  1: [-0.06, 0.06],
  2: [-0.03, 0.12]
};

export function nextEconomyBoundary(from: Date): Date {
  const next = new Date(from.getTime());
  const daysUntilFriday = (5 - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + daysUntilFriday);
  next.setUTCHours(15, 0, 0, 0);
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export function phaseName(state: number): 'recession' | 'normal' | 'boom' {
  return ECONOMY_PHASE_NAMES[state] ?? 'normal';
}

export function economyModifierSeed(realmId: number, state: number, periodStart: string): number {
  let hash = 2166136261;
  const key = `${realmId}:${state}:${periodStart}`;
  for (const character of key) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function computeEconomyProductionModifier(
  realmId: number,
  state: number,
  periodStart: string
): EconomyProductionModifier {
  const seed = economyModifierSeed(realmId, state, periodStart);
  const range = ECONOMY_MODIFIER_RANGES[state] ?? ECONOMY_MODIFIER_RANGES[1];
  const normalized = seed / 0xffffffff;
  const value = Math.round((range[0] + (range[1] - range[0]) * normalized) * 100) / 100;
  return {
    realmId,
    state,
    phase: phaseName(state),
    value,
    kind: value > 0 ? 'bonus' : value < 0 ? 'malus' : 'neutral',
    seed,
    source: 'cycle'
  };
}
