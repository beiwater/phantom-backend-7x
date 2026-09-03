import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { recordSimboostSpend } from '../social/simboost-history.ts';

export interface RushProductionInput {
  buildingId: number;
  queueId?: number | null;
  simboostsCost?: number;
}

export interface RushProductionResult {
  queueItem: ProductionQueueEntity;
  building: BuildingEntity;
  simboostsRemaining: number;
}

export async function rushProductionUseCase(
  ctx: GameContext,
  input: RushProductionInput
): Promise<RushProductionResult> {
  const cost = input.simboostsCost ?? 1;

  return runInTransaction(async txCtx => {
    // 1. Validate building ownership
    const building = buildingRepository.findById(input.buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    // 2. Find queue item to rush
    let queueItem: ProductionQueueEntity | null = null;
    if (input.queueId) {
      queueItem = productionRepository.findById(input.queueId);
    } else {
      queueItem = productionRepository.findLatestActiveByBuilding(building.id, ctx.companyId);
    }

    if (!queueItem || queueItem.buildingId !== building.id || queueItem.companyId !== ctx.companyId || queueItem.resolved) {
      throw new ValidationError('Building has no active production order to rush');
    }

    // 3. Debit SimBoosts
    const simboostsRemaining = companyRepository.debitSimboosts(ctx.companyId, cost);
    recordSimboostSpend(ctx.companyId, 'RUSH_PRODUCTION', cost);

    // 4. Finish immediately and DELIVER the output now (legacy semantics:
    // resolved=1, output added to warehouse, building freed — Issue #68:
    // inventory credit must be inside the same atomic transaction).
    const nowIso = virtualClock.nowIso();
    const finishedItem = productionRepository.finishImmediately(queueItem.id, ctx.companyId, nowIso);
    if (!productionRepository.markResolved(queueItem.id, ctx.companyId)) {
      throw new ValidationError('Production queue is no longer active');
    }
    warehouseRepository.addResource(ctx.companyId, queueItem.kind, queueItem.quality, queueItem.amount);

    // 5. Free the building (legacy: busy_until = NULL)
    const updatedBuilding = buildingRepository.updateBusyUntil(building.id, ctx.companyId, null);

    // 6. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'ProductionRushed', {
      companyId: ctx.companyId,
      buildingId: building.id,
      queueId: finishedItem.id,
      simboostsCost: cost
    });

    return {
      queueItem: { ...finishedItem, resolved: true },
      building: updatedBuilding,
      simboostsRemaining
    };
  }, { immediate: true });
}
