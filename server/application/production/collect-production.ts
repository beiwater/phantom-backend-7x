import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { warehouseRepository, type WarehouseEntity } from '../../repositories/warehouse-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/domain-error.ts';

export interface CollectProductionInput {
  buildingOrQueueId: number;
}

export interface CollectProductionResult {
  collectedItem: ProductionQueueEntity;
  warehouseItem: WarehouseEntity;
  building: BuildingEntity;
  currentMoney: number;
}

export async function collectProductionUseCase(
  ctx: GameContext,
  input: CollectProductionInput
): Promise<CollectProductionResult> {
  return runInTransaction(async txCtx => {
    // 1. Locate the queue item (requestedId might be building_id or queue_id)
    const itemByQueue = productionRepository.findById(input.buildingOrQueueId);
    let targetItem: ProductionQueueEntity | null = null;

    if (itemByQueue && itemByQueue.companyId === ctx.companyId && !itemByQueue.resolved) {
      targetItem = itemByQueue;
    } else {
      // Look by buildingId
      const activeByBuilding = productionRepository.findActiveByBuilding(input.buildingOrQueueId, ctx.companyId);
      // Find the earliest or latest finished
      const now = Date.now();
      const finishedItems = activeByBuilding.filter(item => Date.parse(item.finishesAt) <= now);
      if (finishedItems.length > 0) {
        targetItem = finishedItems[0];
      }
    }

    if (!targetItem) {
      throw new NotFoundError(`No completed production order found for ID ${input.buildingOrQueueId}`);
    }

    if (targetItem.companyId !== ctx.companyId) {
      throw new NotFoundError(`No completed production order found for ID ${input.buildingOrQueueId}`);
    }

    if (targetItem.resolved) {
      throw new ConflictError('Production order has already been collected');
    }

    const finishTime = Date.parse(targetItem.finishesAt);
    if (!Number.isFinite(finishTime) || finishTime > Date.now()) {
      throw new ValidationError('Production has not finished yet');
    }

    // 2. Atomically mark as resolved (idempotency barrier)
    const marked = productionRepository.markResolved(targetItem.id, ctx.companyId);
    if (!marked) {
      throw new ConflictError('Production order has already been collected');
    }

    // 3. Add produced resource to warehouse
    const warehouseItem = warehouseRepository.addResource(
      ctx.companyId,
      targetItem.kind,
      targetItem.quality,
      targetItem.amount
    );

    // 4. Update building busy state
    const remainingActive = productionRepository.findLatestActiveByBuilding(targetItem.buildingId, ctx.companyId);
    const newBusyUntil = remainingActive ? remainingActive.finishesAt : null;
    const updatedBuilding = buildingRepository.updateBusyUntil(targetItem.buildingId, ctx.companyId, newBusyUntil);

    // 5. Query company balance
    const company = companyRepository.findById(ctx.companyId);
    const currentMoney = company?.money ?? 0;

    // 6. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'ProductionCollected', {
      companyId: ctx.companyId,
      buildingId: targetItem.buildingId,
      queueId: targetItem.id,
      kind: targetItem.kind,
      quality: targetItem.quality,
      amount: targetItem.amount,
      collectedAt: new Date().toISOString()
    });

    return {
      collectedItem: targetItem,
      warehouseItem,
      building: updatedBuilding,
      currentMoney
    };
  }, { immediate: true });
}
