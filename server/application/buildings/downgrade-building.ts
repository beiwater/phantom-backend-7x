import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { estimateDemolitionRefund } from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { demolishBuildingUseCase } from './demolish-building.ts';

export interface DowngradeBuildingInput {
  buildingId: number;
  sizeReduction: number;
}

export interface DowngradeBuildingResult {
  building: BuildingEntity;
  refundMoney: number;
  refundMaterials: Array<{ kind: number; amount: number }>;
  newMoney: number;
  demolished: boolean;
}

export async function downgradeBuildingUseCase(
  ctx: GameContext,
  input: DowngradeBuildingInput
): Promise<DowngradeBuildingResult> {
  const { buildingId, sizeReduction } = input;
  if (!Number.isSafeInteger(sizeReduction) || sizeReduction <= 0) {
    throw new ValidationError('Size reduction must be a positive integer');
  }

  return runInTransaction(async txCtx => {
    // 1. Validate building ownership
    const building = buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundError(`Building with id ${buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    const newSize = building.size - sizeReduction;

    // 2. If new size is 0 or less, demolish completely
    if (newSize <= 0) {
      const demolishResult = await demolishBuildingUseCase(ctx, buildingId);
      return {
        building: { ...demolishResult.demolishedBuilding, size: 0 },
        refundMoney: demolishResult.refundMoney,
        refundMaterials: demolishResult.refundMaterials,
        newMoney: demolishResult.newMoney,
        demolished: true
      };
    }

    // 3. Calculate refund for reduced levels
    const { moneyRefund, materialRefund } = estimateDemolitionRefund(building.cost, sizeReduction);

    // 4. Credit refund money
    const newMoney = companyRepository.creditMoney(ctx.companyId, moneyRefund);

    // 5. Refund materials to warehouse
    for (const mat of materialRefund) {
      if (mat.amount > 0) {
        warehouseRepository.addResource(ctx.companyId, mat.kind, 0, mat.amount);
      }
    }

    // 6. Update building size
    const updatedBuilding = buildingRepository.updateSize(building.id, ctx.companyId, newSize);

    // 7. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'BuildingUpgraded', {
      companyId: ctx.companyId,
      buildingId: updatedBuilding.id,
      newSize: updatedBuilding.size,
      cost: -moneyRefund
    });

    return {
      building: updatedBuilding,
      refundMoney: moneyRefund,
      refundMaterials: materialRefund,
      newMoney,
      demolished: false
    };
  }, { immediate: true });
}
