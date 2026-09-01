import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { estimateDemolitionRefund } from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { assertNotRoboticsLocked } from '../../game/robotics.ts';
import { demolishBuildingUseCase } from './demolish-building.ts';

export interface DowngradeBuildingInput {
  buildingId: number;
  sizeReduction: number;
}

export interface DowngradeBuildingResult {
  building: BuildingEntity;
  /** Reference value of the scrapped levels (baseCost * reduction * 0.5). */
  scrapValue: number;
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

    // Issue #96: a robotized building cannot be downgraded (nor demolished by
    // full downgrade) until the robots are uninstalled (400 ROBOTICS_LOCKED).
    assertNotRoboticsLocked(building);

    const newSize = building.size - sizeReduction;

    // 2. If new size is 0 or less, demolish completely
    if (newSize <= 0) {
      const demolishResult = await demolishBuildingUseCase(ctx, buildingId);
      return {
        building: { ...demolishResult.demolishedBuilding, size: 0 },
        scrapValue: demolishResult.scrapValue,
        refundMaterials: demolishResult.refundMaterials,
        newMoney: demolishResult.newMoney,
        demolished: true
      };
    }

    // 3. Issue #94: scrapping levels returns 50% of their construction
    // materials at quality 0 — not cash.
    const { scrapValue, materialRefund } = estimateDemolitionRefund(building.kind, building.cost, sizeReduction);

    // 4. Refund materials to warehouse at quality 0
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
      cost: -scrapValue
    });

    const comp = companyRepository.findById(ctx.companyId);
    return {
      building: updatedBuilding,
      scrapValue,
      refundMaterials: materialRefund,
      newMoney: Number(comp?.money ?? 0),
      demolished: false
    };
  }, { immediate: true });
}
