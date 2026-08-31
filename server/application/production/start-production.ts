import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { warehouseRepository, type ResourceTransactionEntity } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { validateProductionRequest, resolveAchievableQuality } from '../../domain/production/production-rules.ts';
import { calculateProductionTime } from '../../game-data/buildings.ts';

export interface StartProductionInput {
  buildingId: number;
  kind: number;
  amount: number;
  quality?: number | null;
}

export interface StartProductionResult {
  queueItem: ProductionQueueEntity;
  building: BuildingEntity;
  resourceTransactions: ResourceTransactionEntity[];
}

export async function startProductionUseCase(
  ctx: GameContext,
  input: StartProductionInput
): Promise<StartProductionResult> {
  return runInTransaction(async txCtx => {
    // 1. Validate building ownership
    const building = buildingRepository.findById(input.buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    if (building.busyUntil && new Date(building.busyUntil).getTime() > Date.now()) {
      const activeQueues = productionRepository.findActiveByBuilding(building.id, ctx.companyId);
      if (activeQueues.length === 0) {
        throw new ValidationError('Building is still under construction or upgrade');
      }
    }
    // 2. Validate production rules & ingredients
    const { ingredients } = validateProductionRequest(
      building.kind,
      input.kind,
      input.amount
    );

    // 3. Consume required ingredients atomically
    const allTransactions: ResourceTransactionEntity[] = [];
    for (const ingredient of ingredients) {
      const txs = warehouseRepository.consumeWithTransactions(
        ctx.companyId,
        ingredient.kind,
        0,
        ingredient.amount
      );
      allTransactions.push(...txs);
    }

    // 4. Calculate timing and queue chaining
    const durationSeconds = calculateProductionTime(input.kind, input.amount, building.size);
    const latestActive = productionRepository.findLatestActiveByBuilding(building.id, ctx.companyId);

    const now = new Date();
    let startTime = now;
    if (latestActive) {
      const latestFinish = new Date(latestActive.finishesAt);
      if (latestFinish > now) {
        startTime = latestFinish;
      }
    }

    const finishTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const startedAt = startTime.toISOString();
    const finishesAt = finishTime.toISOString();

    // 5. Determine quality
    const achievableQuality = resolveAchievableQuality(
      ctx.companyId,
      input.kind,
      input.quality
    );

    // 6. Create queue item
    const queueItem = productionRepository.create({
      buildingId: building.id,
      companyId: ctx.companyId,
      kind: input.kind,
      quality: achievableQuality,
      amount: input.amount,
      durationSeconds,
      startedAt,
      finishesAt
    });

    // 7. Update building busy state
    const updatedBuilding = buildingRepository.updateBusyUntil(building.id, ctx.companyId, finishesAt);

    // 8. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'ProductionStarted', {
      companyId: ctx.companyId,
      buildingId: building.id,
      queueId: queueItem.id,
      kind: input.kind,
      amount: input.amount,
      quality: achievableQuality,
      startedAt,
      finishesAt
    });

    return {
      queueItem,
      building: updatedBuilding,
      resourceTransactions: allTransactions
    };
  }, { immediate: true });
}
