import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { validateProductionRequest } from '../../domain/production/production-rules.ts';

export interface CancelProductionInput {
  buildingId: number;
  queueId?: number | null;
}

export interface CancelProductionResult {
  cancelledItem: ProductionQueueEntity;
  building: BuildingEntity;
  refundedIngredients: Array<{ kind: number; amount: number }>;
}

export async function cancelProductionUseCase(
  ctx: GameContext,
  input: CancelProductionInput
): Promise<CancelProductionResult> {
  return runInTransaction(async txCtx => {
    // 1. Validate building ownership
    const building = buildingRepository.findById(input.buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    // 2. Find queue item to cancel
    let queueItem: ProductionQueueEntity | null = null;
    if (input.queueId) {
      queueItem = productionRepository.findById(input.queueId);
    } else {
      queueItem = productionRepository.findLatestActiveByBuilding(building.id, ctx.companyId);
    }

    if (!queueItem || queueItem.buildingId !== building.id || queueItem.companyId !== ctx.companyId || queueItem.resolved) {
      throw new ValidationError('Building has no active cancellable production order');
    }

    // 3. Delete queue item
    const deleted = productionRepository.delete(queueItem.id, ctx.companyId);
    if (!deleted) {
      throw new ValidationError('Failed to cancel production order: order may have already completed');
    }

    // 4. Refund ingredients back to warehouse
    // NOTE: only recomputes the ingredient refund for an already-persisted
    // queue row; re-validating persisted quality/amount here would brick
    // cancellation of rows written before the C-14/C-19 fix.
    const { ingredients } = validateProductionRequest(
      building.kind,
      queueItem.kind,
      queueItem.amount
    );

    for (const ing of ingredients) {
      warehouseRepository.addResource(ctx.companyId, ing.kind, 0, ing.amount);
    }

    // 5. Update building busy state
    const remainingActive = productionRepository.findLatestActiveByBuilding(building.id, ctx.companyId);
    const newBusyUntil = remainingActive ? remainingActive.finishesAt : null;
    const updatedBuilding = buildingRepository.updateBusyUntil(building.id, ctx.companyId, newBusyUntil);

    // 6. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'ProductionCancelled', {
      companyId: ctx.companyId,
      buildingId: building.id,
      queueId: queueItem.id,
      kind: queueItem.kind,
      amount: queueItem.amount,
      quality: queueItem.quality
    });

    return {
      cancelledItem: queueItem,
      building: updatedBuilding,
      refundedIngredients: ingredients
    };
  }, { immediate: true });
}
