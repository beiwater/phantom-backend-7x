import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import {
  warehouseRepository,
  type ConstructionMaterialCostSegment,
  type ResourceCostSnapshot
} from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { estimateDemolitionRefund } from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { assertNotRoboticsLocked } from '../../game/robotics.ts';
import { demolishBuildingUseCase } from './demolish-building.ts';
import { getResourceDef } from '../../game-data/resources.ts';

const COST_BUCKETS = ['workers', 'admin', 'material1', 'material2', 'market'] as const;

function scaleMaterialSnapshot(snapshot: ResourceCostSnapshot, factor: number): ResourceCostSnapshot {
  return {
    kind: snapshot.kind,
    amount: snapshot.amount * factor,
    costs: {
      workers: snapshot.costs.workers * factor,
      admin: snapshot.costs.admin * factor,
      material1: snapshot.costs.material1 * factor,
      material2: snapshot.costs.material2 * factor,
      market: snapshot.costs.market * factor
    }
  };
}

function costsForRemovedLevels(
  segments: readonly ConstructionMaterialCostSegment[],
  fromSize: number,
  toSize: number
): Map<number, ResourceCostSnapshot> {
  const totals = new Map<number, ResourceCostSnapshot>();
  for (const segment of segments) {
    const segmentSize = segment.sizeAfter - segment.sizeBefore;
    if (segmentSize <= 0) continue;
    const overlap = Math.max(
      0,
      Math.min(segment.sizeAfter, toSize) - Math.max(segment.sizeBefore, fromSize)
    );
    if (overlap <= 0) continue;
    const fraction = overlap / segmentSize;
    for (const material of segment.materials) {
      const partial = scaleMaterialSnapshot(material, fraction);
      const total = totals.get(material.kind) ?? {
        kind: material.kind,
        amount: 0,
        costs: { workers: 0, admin: 0, material1: 0, material2: 0, market: 0 }
      };
      total.amount += partial.amount;
      for (const bucket of COST_BUCKETS) total.costs[bucket] += partial.costs[bucket];
      totals.set(material.kind, total);
    }
  }
  return totals;
}

function retainedConstructionSegments(
  segments: readonly ConstructionMaterialCostSegment[],
  newSize: number
): ConstructionMaterialCostSegment[] {
  const retained: ConstructionMaterialCostSegment[] = [];
  for (const segment of segments) {
    if (segment.sizeBefore >= newSize) continue;
    if (segment.sizeAfter <= newSize) {
      retained.push(segment);
      continue;
    }
    const segmentSize = segment.sizeAfter - segment.sizeBefore;
    if (segmentSize <= 0) continue;
    const retainedFraction = (newSize - segment.sizeBefore) / segmentSize;
    retained.push({
      sizeBefore: segment.sizeBefore,
      sizeAfter: newSize,
      materials: segment.materials.map(material => scaleMaterialSnapshot(material, retainedFraction))
    });
  }
  return retained;
}

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
    const removedCosts = costsForRemovedLevels(
      building.constructionMaterialCostSnapshots,
      newSize,
      building.size
    );

    // 4. Refund materials to warehouse at quality 0
    for (const mat of materialRefund) {
      if (mat.amount > 0) {
        const consumed = removedCosts.get(mat.kind);
        const costs = consumed && consumed.amount > 0
          ? {
              workers: consumed.costs.workers / consumed.amount,
              admin: consumed.costs.admin / consumed.amount,
              material1: consumed.costs.material1 / consumed.amount,
              material2: consumed.costs.material2 / consumed.amount,
              market: consumed.costs.market / consumed.amount
            }
          : { market: getResourceDef(mat.kind)?.cost ?? 2.5 };
        warehouseRepository.addResource(ctx.companyId, mat.kind, 0, mat.amount, costs);
      }
    }

    // 6. Update building size
    buildingRepository.updateSize(building.id, ctx.companyId, newSize);
    const updatedBuilding = buildingRepository.setConstructionMaterialCostSnapshots(
      building.id,
      ctx.companyId,
      retainedConstructionSegments(building.constructionMaterialCostSnapshots, newSize)
    );

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
