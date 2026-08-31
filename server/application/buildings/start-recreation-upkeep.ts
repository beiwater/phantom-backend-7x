import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/domain-error.ts';

/**
 * P1-09: start (or renew) the upkeep of a recreation building (park/lake/
 * temple, dbLetter 3/4/5). The original client posts an EMPTY body to
 * POST /api/v1/buildings/:id/busy/ — the server must recognise this shape
 * for recreation buildings and start a paid 7-day upkeep instead of
 * demanding kind/amount.
 *
 * Official contract (frontend bundle `startRecreation` / S0i component):
 *   - cost: 15 / 25 / 40 simboosts for the 1st / 2nd / 3rd recreation
 *     building (h5=[15,25,40], ordered by building age)
 *   - duration: 7 days, surfaced as busy { category: 'u', upkeep: true }
 *   - effect: +1% production speed and +1% sales speed per size unit,
 *     derived client-side from busy.upkeep being active
 *   - response: { building, simboostsDelta } — the client applies
 *     addSimBoosts(simboostsDelta) so the delta must be negative.
 *
 * Issue #68: the simboost debit and the upkeep-state persistence happen in
 * ONE atomic transaction; insufficient balance aborts everything.
 */
export const RECREATION_UPKEEP_COSTS = [15, 25, 40];
export const RECREATION_UPKEEP_DURATION_SECONDS = 7 * 24 * 3600;

export interface StartRecreationUpkeepResult {
  building: BuildingEntity;
  spent: number;
  simboostsDelta: number;
  simboostsRemaining: number;
  busyUntil: string;
}

/**
 * Count this company's recreation buildings that currently hold an active
 * upkeep. Drives the official cost ladder: 1st=15, 2nd=25, 3rd+=40.
 */
function countActiveRecreationUpkeeps(companyId: number): number {
  return buildingRepository.findByCompany(companyId).filter(b =>
    b.category === 'recreation' && b.upkeepActive
  ).length;
}

export async function startRecreationUpkeepUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<StartRecreationUpkeepResult> {
  return runInTransaction(async txCtx => {
    const building = buildingRepository.findById(buildingId);
    if (!building || building.companyId !== ctx.companyId) {
      throw new NotFoundError(`Building ${buildingId} not found`);
    }
    if (building.category !== 'recreation') {
      throw new ValidationError(`Building ${buildingId} is not a recreation building`);
    }

    // Idempotency guard: an active (or construction/upgrade) busy period must
    // not be silently double-charged on repeat POSTs.
    const busyUntilMs = building.busyUntil ? new Date(building.busyUntil).getTime() : 0;
    if (busyUntilMs > Date.now()) {
      throw new ConflictError('Building is already busy — upkeep is already running');
    }

    // Official cost ladder for the 1st / 2nd / 3rd recreation building upkeep.
    const activeUpkeeps = countActiveRecreationUpkeeps(ctx.companyId);
    const cost = RECREATION_UPKEEP_COSTS[Math.min(activeUpkeeps, RECREATION_UPKEEP_COSTS.length - 1)];

    // Atomic debit: fails with InsufficientFundsError (400) before any state
    // changes when the balance is too low.
    const simboostsRemaining = companyRepository.debitSimboosts(ctx.companyId, cost);

    const busyUntil = new Date(Date.now() + RECREATION_UPKEEP_DURATION_SECONDS * 1000).toISOString();
    const updated = buildingRepository.updateUpkeep(buildingId, ctx.companyId, busyUntil, true);

    // Post-commit side effect only; the economic mutation above is already
    // committed atomically.
    eventBus.publishCommitted(txCtx, 'RecreationUpkeepStarted', {
      companyId: ctx.companyId,
      buildingId,
      cost,
      busyUntil
    });

    return {
      building: updated,
      spent: cost,
      simboostsDelta: -cost,
      simboostsRemaining,
      busyUntil
    };
  }, { immediate: true });
}
