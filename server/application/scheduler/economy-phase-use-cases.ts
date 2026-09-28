import { virtualClock } from '../../core/virtual-clock.ts';
import { schedulerStateRepository } from '../../repositories/scheduler-state-repository.ts';
import { DAY_MS, ECONOMY_STATE_NAMES, nextEconomyBoundary, phaseName, computeEconomyProductionModifier } from '../../domain/scheduler/economy-phase-rules.ts';
import type { EconomyPhaseStatus, EconomyPhaseHistoryEntry } from '../../domain/scheduler/economy-phase-rules.ts';
export type { EconomyPhaseStatus, EconomyPhaseHistoryEntry, EconomyProductionModifier } from '../../domain/scheduler/economy-phase-rules.ts';
export { computeEconomyProductionModifier } from '../../domain/scheduler/economy-phase-rules.ts';

export function getEconomyPhase(realmId: number = 0): EconomyPhaseStatus {
  const row = schedulerStateRepository.getEconomyPhase(realmId);
  if (!row) throw new Error(`Economy phase for realm ${realmId} has not been initialized`);
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
