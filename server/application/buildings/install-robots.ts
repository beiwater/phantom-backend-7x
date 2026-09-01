import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { warehouseRepository, type ResourceTransactionEntity } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../errors/domain-error.ts';
import {
  ROBOT_RESOURCE_KIND,
  ROBOTICS_WAGE_MULTIPLIER,
  requiredRobotCount,
  requiredRobotQuality,
  hasRobotsInstalled,
  assertSpecializableProduct
} from '../../game/robotics.ts';

export interface InstallRobotsInput {
  buildingId: number;
  /** The single product the robotized building will be specialized to. */
  kind: number;
}

export interface RoboticsState {
  installed: boolean;
  installedRobots: number;
  installedQuality: number;
  requiredRobots: number;
  requiredQuality: number;
  lockedProduct: number;
  wageMultiplier: number;
  wageDiscount: number;
}

export interface InstallRobotsResult {
  building: BuildingEntity;
  robotics: RoboticsState;
  resourcesConsumed: ResourceTransactionEntity[];
}

/**
 * Issue #96: install industrial robots on a production building.
 *
 * Consumes `ceil(robotUnits(building) * size)` robots (kind 114) of at least
 * `floor(size / 4)` quality from the company warehouse, locks the building to
 * the requested single product, and applies the 3% wage reduction
 * (wageMultiplier 0.97). Atomic: robot consumption and the building lock
 * commit or roll back together.
 */
export async function installRobotsUseCase(
  ctx: GameContext,
  input: InstallRobotsInput
): Promise<InstallRobotsResult> {
  const kind = Number(input.kind);
  if (!Number.isSafeInteger(kind) || kind <= 0) {
    throw new ValidationError(`Robot specialization product must be a positive integer: ${input.kind}`);
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

    // 2. A robotized building cannot be re-robotized; uninstall first.
    if (hasRobotsInstalled(building)) {
      throw new ConflictError(`Building ${building.id} already has robots installed`);
    }

    // 3. The specialization must be a product this building can produce.
    assertSpecializableProduct(building.kind, kind);

    // 4. Requirements scale with the building kind and its current size.
    const requiredRobots = requiredRobotCount(building.kind, building.size);
    const requiredQuality = requiredRobotQuality(building.size);

    // 5. Consume the robots atomically (lowest sufficient quality first).
    const consumed = warehouseRepository.consumeWithTransactions(
      ctx.companyId,
      ROBOT_RESOURCE_KIND,
      requiredQuality,
      requiredRobots
    );

    // 6. Persist the robotization: count, display quality (weighted average of
    // what was actually consumed) and the product lock.
    const totalConsumed = consumed.reduce((sum, tx) => sum + tx.amount, 0);
    const weightedQuality = consumed.reduce((sum, tx) => sum + tx.amount * (Number(tx.quality) || 0), 0);
    const installedQuality = totalConsumed > 0 ? Math.floor(weightedQuality / totalConsumed) : requiredQuality;

    const updatedBuilding = buildingRepository.updateRobotics(building.id, ctx.companyId, {
      robotsInstalled: totalConsumed,
      robotsQuality: installedQuality,
      lockedProduct: kind
    });

    // 7. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'RobotsInstalled', {
      companyId: ctx.companyId,
      buildingId: building.id,
      robotsInstalled: totalConsumed,
      robotsQuality: installedQuality,
      lockedProduct: kind
    });

    return {
      building: updatedBuilding,
      robotics: {
        installed: true,
        installedRobots: totalConsumed,
        installedQuality,
        requiredRobots,
        requiredQuality,
        lockedProduct: kind,
        wageMultiplier: ROBOTICS_WAGE_MULTIPLIER,
        wageDiscount: Math.round((1 - ROBOTICS_WAGE_MULTIPLIER) * 100) / 100
      },
      resourcesConsumed: consumed
    };
  }, { immediate: true });
}
