import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import {
  estimateDemolitionRefund,
  assertBondCollateralFloor,
  assertNotBusyForConstructionWork
} from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ForbiddenError, ConflictError } from '../../errors/domain-error.ts';
import { productionRepository } from '../../repositories/production-repository.ts';
import { getOutstandingSoldBondLiability } from '../finance/bond-use-cases.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { auditRepository } from '../../repositories/audit-repository.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { assertNotRoboticsLocked } from '../../game/robotics.ts';

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
    // Keep structural operations consistent: a building under construction or
    // upgrade cannot be demolished, and installed robots must be uninstalled
    // first so they are not destroyed without the normal return flow.
    assertNotBusyForConstructionWork(building.busyUntil, virtualClock.nowMs());
    assertNotRoboticsLocked(building);
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

    // 3. Issue #94: return the configured scrap quantities at Q0. Preserve
    // their original warehouse cost buckets when this building has persisted
    // construction/upgrade snapshots; never smear the building's cash value
    // across unlike materials.
    const { scrapValue, materialRefund } = estimateDemolitionRefund(building.kind, building.cost, building.size);
    const consumedCostsByKind = new Map<number, { amount: number; costs: { workers: number; admin: number; material1: number; material2: number; market: number } }>();
    for (const segment of building.constructionMaterialCostSnapshots) {
      for (const material of segment.materials) {
        const total = consumedCostsByKind.get(material.kind) ?? {
          amount: 0,
          costs: { workers: 0, admin: 0, material1: 0, material2: 0, market: 0 }
        };
        total.amount += material.amount;
        total.costs.workers += material.costs.workers;
        total.costs.admin += material.costs.admin;
        total.costs.material1 += material.costs.material1;
        total.costs.material2 += material.costs.material2;
        total.costs.market += material.costs.market;
        consumedCostsByKind.set(material.kind, total);
      }
    }
    for (const mat of materialRefund) {
      if (mat.amount > 0) {
        const consumed = consumedCostsByKind.get(mat.kind);
        const costs = consumed && consumed.amount > 0
          ? {
              workers: consumed.costs.workers / consumed.amount,
              admin: consumed.costs.admin / consumed.amount,
              material1: consumed.costs.material1 / consumed.amount,
              material2: consumed.costs.material2 / consumed.amount,
              market: consumed.costs.market / consumed.amount
            }
          : { market: getResourceDef(mat.kind)?.cost || 2.5 };
        warehouseRepository.addResource(ctx.companyId, mat.kind, 0, mat.amount, costs);
      }
    }

    // 4. Delete building
    buildingRepository.delete(building.id, ctx.companyId);
    // The prospector achievement is company-scoped and only counts completed
    // demolitions. Persist the audit row in this transaction with the delete.
    auditRepository.record({
      actorCompanyId: ctx.companyId,
      targetCompanyId: ctx.companyId,
      action: 'demolish_building',
      reason: `Demolished building ${building.id}`
    });

    // 5. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'BuildingDemolished', {
      companyId: ctx.companyId,
      buildingId: building.id,
      refund: 0,
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
