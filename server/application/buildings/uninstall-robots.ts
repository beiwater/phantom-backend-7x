import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { productionRepository } from '../../repositories/production-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ConflictError } from '../../errors/domain-error.ts';
import {
  ROBOT_RESOURCE_KIND,
  uninstallRobotReturnCount
} from '../../game/robotics.ts';

export interface UninstallRobotsResult {
  building: BuildingEntity;
  /** Robots returned to the warehouse (50% of installed, at quality 0). */
  returnedRobots: number;
  returnedQuality: number;
}

/**
 * Issue #96: uninstall industrial robots from a building.
 *
 * Returns 50% of the installed robots to the warehouse at quality 0 and
 * clears the specialization lock, re-enabling upgrades/downgrades and
 * multi-product production. Atomic: the warehouse credit and the building
 * unlock commit or roll back together.
 */
export async function uninstallRobotsUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<UninstallRobotsResult> {
  return runInTransaction(async txCtx => {
    // 1. Validate building ownership
    const building = buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    const installed = Number(building.robotsInstalled) || 0;
    if (installed <= 0) {
      throw new ConflictError(`Building ${building.id} has no robots installed`);
    }

    // 2. A busy building cannot have its robots uninstalled (original
    // contract: "Building is currently busy and robots cannot be uninstalled").
    const activeQueues = productionRepository.findActiveByBuilding(building.id, ctx.companyId);
    if (activeQueues.length > 0) {
      throw new ConflictError('Building is currently busy and robots cannot be uninstalled');
    }

    // 3. Return 50% of the installed robots at quality 0 to the warehouse.
    const returnedRobots = uninstallRobotReturnCount(installed);
    if (returnedRobots > 0) {
      warehouseRepository.addResource(ctx.companyId, ROBOT_RESOURCE_KIND, 0, returnedRobots);
    }

    // 4. Clear the robotization: no robots, no product lock, no wage discount.
    const updatedBuilding = buildingRepository.updateRobotics(building.id, ctx.companyId, {
      robotsInstalled: 0,
      robotsQuality: 0,
      lockedProduct: null
    });

    // 5. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'RobotsUninstalled', {
      companyId: ctx.companyId,
      buildingId: building.id,
      returnedRobots
    });

    return {
      building: updatedBuilding,
      returnedRobots,
      returnedQuality: 0
    };
  }, { immediate: true });
}
