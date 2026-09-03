import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { estimateDemolitionRefund, assertBondCollateralFloor } from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ForbiddenError, ConflictError } from '../../errors/domain-error.ts';
import { productionRepository } from '../../repositories/production-repository.ts';
import { getOutstandingSoldBondLiability } from '../finance/bond-use-cases.ts';

export interface DemolishBuildingResult {
  demolishedBuilding: BuildingEntity;
  /** Reference value of the scrapped building portion (baseCost * size * 0.5). */
  scrapValue: number;
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

    // 2. Issue #94: bond collateral floor. Buildings collateralize issued
    // bonds; demolition must not push the remaining building valuation below
    // 80% of the outstanding bond liability. Checked inside the transaction so
    // the guard and the delete commit or roll back together.
    const bondLiability = getOutstandingSoldBondLiability(ctx.companyId);
    if (bondLiability > 0) {
      const totalBuildingValue = buildingRepository.findByCompany(ctx.companyId)
        .reduce((sum, b) => sum + b.cost * b.size, 0);
      const remainingBuildingValue = totalBuildingValue - building.cost * building.size;
      assertBondCollateralFloor(remainingBuildingValue, bondLiability);
    }

    // 3. Issue #94: scrap refund. 50% of the construction materials that went
    // into the building return to the warehouse at quality 0. No cash is
    // refunded — the old cash refund (baseCost * size * 0.5) is replaced by
    // the material return, reported as `scrapValue`.
    const { scrapValue, materialRefund } = estimateDemolitionRefund(building.kind, building.cost, building.size);
    for (const mat of materialRefund) {
      if (mat.amount > 0) {
        warehouseRepository.addResource(ctx.companyId, mat.kind, 0, mat.amount);
      }
    }

    // 4. Delete building
    buildingRepository.delete(building.id, ctx.companyId);

    // 5. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'BuildingDemolished', {
      companyId: ctx.companyId,
      buildingId: building.id,
      scrapValue,
      refundMaterials: materialRefund
    });

    const comp = companyRepository.findById(ctx.companyId);
    return {
      demolishedBuilding: building,
      scrapValue,
      refundMaterials: materialRefund,
      newMoney: Number(comp?.money ?? 0)
    };
  }, { immediate: true });
}
