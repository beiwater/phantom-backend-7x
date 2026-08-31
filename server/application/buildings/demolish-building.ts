import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { estimateDemolitionRefund } from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ForbiddenError, ConflictError } from '../../errors/domain-error.ts';
import { productionRepository } from '../../repositories/production-repository.ts';

export interface DemolishBuildingResult {
  demolishedBuilding: BuildingEntity;
  refundMoney: number;
  refundMaterials: Array<{ kind: number; amount: number }>;
  newMoney: number;
}

export async function demolishBuildingUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<DemolishBuildingResult> {
  return runInTransaction(async txCtx => {
    // 1. Validate building ownership
    const building = buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundError(`Building with id ${buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }
    // C-8: demolishing a building with unresolved production queue rows would
    // orphan them (resolved=0 forever, inputs never refunded). Reject inside
    // the same transaction; the player must cancel production first.
    const activeQueues = productionRepository.findActiveByBuilding(building.id, ctx.companyId);
    if (activeQueues.length > 0) {
      throw new ConflictError('Building has an active production order; cancel it before demolishing');
    }

    // 2. Calculate refunds
    const { moneyRefund, materialRefund } = estimateDemolitionRefund(building.cost, building.size);

    // 3. Credit refund money
    const newMoney = companyRepository.creditMoney(ctx.companyId, moneyRefund);

    // 4. Refund materials to warehouse
    for (const mat of materialRefund) {
      if (mat.amount > 0) {
        warehouseRepository.addResource(ctx.companyId, mat.kind, 0, mat.amount);
      }
    }

    // 5. Delete building
    buildingRepository.delete(building.id, ctx.companyId);

    // 6. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'BuildingDemolished', {
      companyId: ctx.companyId,
      buildingId: building.id,
      refund: moneyRefund
    });

    return {
      demolishedBuilding: building,
      refundMoney: moneyRefund,
      refundMaterials: materialRefund,
      newMoney
    };
  }, { immediate: true });
}
