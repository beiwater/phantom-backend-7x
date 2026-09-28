import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { warehouseRepository, type CostBreakdown } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { validateProductionRequest } from '../../domain/production/production-rules.ts';
import { cancelQueuedLaunch } from '../aerospace/launch-use-cases.ts';
import { rocketKindForLaunchAmount } from '../../domain/aerospace/launch-rules.ts';


export interface CancelProductionInput {
  buildingId: number;
  queueId?: number | null;
}

export interface CancelProductionResult {
  cancelledItem: ProductionQueueEntity;
  building: BuildingEntity;
  refundedIngredients: Array<{ kind: number; amount: number; quality?: number }>;
}

export async function cancelProductionUseCase(
  ctx: GameContext,
  input: CancelProductionInput
): Promise<CancelProductionResult> {
  // Launch cancellations share the aerospace transaction so the generic busy
  // and queue DELETE routes preserve launch cost basis and re-chain later work.
  const candidateBuilding = buildingRepository.findById(input.buildingId);
  if (candidateBuilding?.companyId === ctx.companyId && candidateBuilding.kind === 'l') {
    const candidate = input.queueId != null
      ? productionRepository.findById(input.queueId)
      : productionRepository.findLatestActiveByBuilding(candidateBuilding.id, ctx.companyId);
    if (candidate
      && candidate.buildingId === candidateBuilding.id
      && candidate.companyId === ctx.companyId
      && !candidate.resolved
      && candidate.kind === 100
      && rocketKindForLaunchAmount(Number(candidate.amount)) !== null) {
      let cancellation: Awaited<ReturnType<typeof cancelQueuedLaunch>>;
      try {
        cancellation = await cancelQueuedLaunch(ctx.companyId, candidateBuilding.id, candidate.id);
      } catch (error: unknown) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
      const updatedBuilding = buildingRepository.findById(candidateBuilding.id);
      if (!updatedBuilding) {
        throw new NotFoundError(`Building ${candidateBuilding.id} not found`);
      }
      const refundedIngredients = [
        { kind: cancellation.refunded.rocketKind, amount: cancellation.refunded.amount, quality: 0 },
        ...(cancellation.refunded.researchPoints > 0
          ? [{ kind: 100, amount: cancellation.refunded.researchPoints, quality: 0 }]
          : [])
      ];
      return { cancelledItem: candidate, building: updatedBuilding, refundedIngredients };
    }
  }

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


    // A race may have inserted a launch after the pre-read above. Never let a
    // generic refund path delete it without the aerospace pending/re-chain rules.
    if (building.kind === 'l'
      && queueItem.kind === 100
      && rocketKindForLaunchAmount(Number(queueItem.amount)) !== null) {
      throw new ValidationError('Launch state changed; retry cancellation');
    }

    // 3. Delete queue item
    const deleted = productionRepository.delete(queueItem.id, ctx.companyId);
    if (!deleted) {
      throw new ValidationError('Failed to cancel production order: order may have already completed');
    }

    // The original client promises cancellation refunds at Q0. The queue's
    // amount is modified output, so use the saved original recipe quantities;
    // legacy rows without a snapshot retain the prior recipe fallback.
    const cancellationInputs: Array<{ kind: number; amount: number; quality?: number; cost?: CostBreakdown | number }> = queueItem.inputIngredients
      ?? validateProductionRequest(building.kind, queueItem.kind, queueItem.amount).ingredients;
    const refundedIngredients = cancellationInputs
      .map(ingredient => ({
        ...ingredient,
        // The original client restores cancellation inputs at Q0.
        quality: 0
      }));

    for (const [index, ing] of refundedIngredients.entries()) {
      const sourceCost = cancellationInputs[index]?.cost;
      const cost = typeof sourceCost === 'number'
        ? { market: sourceCost }
        : sourceCost ?? {};
      warehouseRepository.addResource(
        ctx.companyId,
        ing.kind,
        ing.quality,
        ing.amount,
        cost
      );
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
      refundedIngredients: refundedIngredients.map(({ kind, amount, quality }) => ({ kind, amount, quality }))
    };
  }, { immediate: true });
}
