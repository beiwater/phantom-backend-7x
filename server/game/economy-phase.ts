import { virtualClock } from '../core/virtual-clock.ts';
import { schedulerStateRepository } from '../repositories/scheduler-state-repository.ts';

const DAY_MS = 86400000;

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
    seed,
    source: 'cycle'
  };
}

export function getEconomyPhase(realmId: number = 0): EconomyPhaseStatus {
  let row = schedulerStateRepository.getEconomyPhase(realmId);
  if (!row) {
    const now = virtualClock.now();
    setEconomyPhase(realmId, 1, now, 'bootstrap');
    row = schedulerStateRepository.getEconomyPhase(realmId);
  }
  const now = virtualClock.now();
  const startAt = row?.startAt ?? row?.updatedAt ?? now.toISOString();
  const endAt = row?.endAt ?? nextEconomyBoundary(new Date(startAt)).toISOString();
  const state = row?.state ?? 1;
  const modifier = row?.source === 'bootstrap' && row.modifierSeed === 0
    ? { value: 0, kind: 'neutral' as const, seed: 0 }
    : row && row.modifierSeed !== 0
      ? { value: row.productionModifier, kind: row.modifierKind, seed: row.modifierSeed }
      : computeEconomyProductionModifier(realmId, state, startAt);
  return {
    realmId,
    state,
    phase: phaseName(state),
    stateName: ECONOMY_STATE_NAMES[state] ?? 'Normal',
    status: 'active',
    startAt,
    endAt,
    updatedAt: row?.updatedAt ?? null,
    source: row?.source ?? 'bootstrap',
    productionModifier: modifier.value,
    productionBonus: modifier.kind === 'bonus' ? modifier.value : 0,
    productionMalus: modifier.kind === 'malus' ? Math.abs(modifier.value) : 0,
    modifierKind: modifier.kind,
    modifierSeed: modifier.seed
  };
}

export function getEconomyPhaseHistory(
  realmId: number = 0,
  limit = 100,
  offset = 0
): EconomyPhaseHistoryEntry[] {
  const now = virtualClock.nowMs();
  return schedulerStateRepository.getEconomyPhaseHistory(realmId, limit, offset).map(row => {
    const endTime = row.endAt ? Date.parse(row.endAt) : now;
    const startTime = Date.parse(row.startAt);
    const modifier = row.modifierSeed !== 0
      ? { value: row.productionModifier, kind: row.modifierKind, seed: row.modifierSeed }
      : computeEconomyProductionModifier(realmId, row.phase, row.startAt);
    return {
      id: row.id,
      realmId: row.realmId,
      state: row.phase,
      phase: phaseName(row.phase),
      stateName: ECONOMY_STATE_NAMES[row.phase] ?? 'Normal',
      status: row.endAt ? 'ended' : 'active',
      startAt: row.startAt,
      endAt: row.endAt,
      source: row.source,
      generatedAt: row.generatedAt,
      durationDays: Number.isFinite(startTime) && Number.isFinite(endTime)
        ? Math.max(0, (endTime - startTime) / DAY_MS)
        : 0,
      productionModifier: modifier.value,
      productionBonus: modifier.kind === 'bonus' ? modifier.value : 0,
      productionMalus: modifier.kind === 'malus' ? Math.abs(modifier.value) : 0,
      modifierKind: modifier.kind,
      modifierSeed: modifier.seed
    };
  });
}

export function getEconomyPhaseStatistics(realmId: number = 0): {
  realmId: number;
  totalDays: number;
  phases: Record<'recession' | 'normal' | 'boom', { days: number; percentage: number; cycles: number }>;
} {
  const history = getEconomyPhaseHistory(realmId, 500, 0);
  const totals = {
    recession: { days: 0, percentage: 0, cycles: 0 },
    normal: { days: 0, percentage: 0, cycles: 0 },
    boom: { days: 0, percentage: 0, cycles: 0 }
  };
  for (const entry of history) {
    totals[entry.phase].days += entry.durationDays;
    totals[entry.phase].cycles += 1;
  }
  const totalDays = Object.values(totals).reduce((sum, value) => sum + value.days, 0);
  for (const value of Object.values(totals)) {
    value.percentage = totalDays > 0 ? value.days / totalDays : 0;
  }
  return { realmId, totalDays, phases: totals };
}

export function setEconomyPhase(
  realmId: number,
  state: number,
  updatedAt: Date = virtualClock.now(),
  source = 'scheduler',
  forceBoundary = false
): void {
  const periodStart = updatedAt.toISOString();
  const modifier = source === 'bootstrap'
    ? { value: 0, kind: 'neutral' as const, seed: 0 }
    : computeEconomyProductionModifier(realmId, state, periodStart);
  schedulerStateRepository.upsertEconomyPhase(
    realmId,
    state,
    periodStart,
    source,
    forceBoundary,
    modifier.value,
    modifier.kind,
    modifier.seed
  );
}
