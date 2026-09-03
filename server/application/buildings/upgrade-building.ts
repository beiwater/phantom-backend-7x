import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { estimateUpgradeCost, assertNotBusyForConstructionWork } from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../errors/domain-error.ts';
import { assertNotRoboticsLocked } from '../../game/robotics.ts';

export interface UpgradeBuildingInput {
  buildingId: number;
  sizeDelta: number;
}

export interface UpgradeBuildingResult {
  building: BuildingEntity;
  cost: number;
  newMoney: number;
  resourcesConsumed: Array<{ kind: number; quality: number; amount: number }>;
}

export async function upgradeBuildingUseCase(
  ctx: GameContext,
  input: UpgradeBuildingInput
): Promise<UpgradeBuildingResult> {
  const { buildingId, sizeDelta } = input;
  if (!Number.isSafeInteger(sizeDelta) || sizeDelta <= 0) {
    throw new ValidationError('Building size change must be a positive integer');
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

    // Issue #47: repeated upgrades during construction/upgrade busy must be a
    // 409 conflict, not a validation error (official busy contract).
    assertNotBusyForConstructionWork(building.busyUntil, virtualClock.nowMs());
    // Issue #96: a robotized building cannot be upgraded or downgraded until
    // the robots are uninstalled (400 ROBOTICS_LOCKED).
    assertNotRoboticsLocked(building);
    // 2. Calculate costs & required materials.
    // Issue #94: upgrade materials scale with the building's CURRENT size —
    // qp[resourceId] * costUnits * currentSize — not with the size delta.
    const { cost, materials } = estimateUpgradeCost(building.kind, sizeDelta, building.size);

    // 3. Debit upgrade cost atomically
    const newMoney = companyRepository.debitMoney(ctx.companyId, cost);

    // 4. Consume materials atomically
    const consumedList: Array<{ kind: number; quality: number; amount: number }> = [];
    for (const mat of materials) {
      warehouseRepository.consumeExact(ctx.companyId, mat.kind, 0, mat.amount);
      consumedList.push({
        kind: mat.kind,
        quality: 0,
        amount: mat.amount
      });
    }

    // 5. Update building size and busy state
    const newSize = building.size + sizeDelta;
    const busyUntil = new Date(virtualClock.nowMs() + 10000).toISOString();

    const updatedBuilding = buildingRepository.updateSize(building.id, ctx.companyId, newSize);
    buildingRepository.updateBusyUntil(building.id, ctx.companyId, busyUntil);
    const finalizedBuilding = { ...updatedBuilding, busyUntil };

    // 6. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'BuildingUpgraded', {
      companyId: ctx.companyId,
      buildingId: finalizedBuilding.id,
      newSize: finalizedBuilding.size,
      cost
    });

    return {
      building: finalizedBuilding,
      cost,
      newMoney,
      resourcesConsumed: consumedList
    };
  }, { immediate: true });
}
