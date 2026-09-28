/**
 * RushBuildingConstruction use case (Issue #105 Phase 2 / Issue #104 Stage 1).
 * Single authoritative implementation of paying by remaining time to instantly
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
import { productionRepository } from '../../repositories/production-repository.ts';

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
    if (productionRepository.findActiveByBuilding(building.id, ctx.companyId).length > 0) {
      throw new ValidationError('Use production rush for an active production order');
    }
    const remainingSec = Math.ceil((busyUntilMs - virtualClock.nowMs()) / 1000);
    const cost = input.simboostsCost ?? Math.max(1, Math.ceil(remainingSec / 360));

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
