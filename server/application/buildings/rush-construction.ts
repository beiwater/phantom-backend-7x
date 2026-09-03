/**
 * RushBuildingConstruction use case (Issue #105 Phase 2 / Issue #104 Stage 1).
 * Single authoritative implementation of paying 5 SimBoosts to instantly
 * finish an in-progress construction or upgrade. SimBoost debit and the
 * building free happen inside ONE transaction (Issue #68).
 */
import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { recordSimboostSpend } from '../social/simboost-history.ts';

export interface RushConstructionInput {
  buildingId: number;
  simboostsCost?: number;
}

export interface RushConstructionResult {
  building: BuildingEntity;
  simboostsRemaining: number;
}

export async function rushBuildingConstructionUseCase(
  ctx: GameContext,
  input: RushConstructionInput
): Promise<RushConstructionResult> {
  const cost = input.simboostsCost ?? 5;

  return runInTransaction(async txCtx => {
    const building = buildingRepository.findById(input.buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    const busyUntilMs = building.busyUntil ? new Date(building.busyUntil).getTime() : 0;
    if (busyUntilMs <= virtualClock.nowMs()) {
      throw new ValidationError('Building is not under construction or upgrade');
    }

    const simboostsRemaining = companyRepository.debitSimboosts(ctx.companyId, cost);
    recordSimboostSpend(ctx.companyId, 'RUSH_CONSTRUCTION', cost);
    const updatedBuilding = buildingRepository.updateBusyUntil(building.id, ctx.companyId, null);

    eventBus.publishCommitted(txCtx, 'ProductionRushed', {
      companyId: ctx.companyId,
      buildingId: building.id,
      queueId: null,
      simboostsCost: cost
    });

    return {
      building: updatedBuilding,
      simboostsRemaining
    };
  }, { immediate: true });
}
