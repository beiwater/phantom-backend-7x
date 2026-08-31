import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import {
  estimateConstructionCost,
  validateConstructionPosition,
  normalizePosition,
  extraSlotIndex
} from '../../domain/buildings/building-rules.ts';
import { getBuildingMeta } from '../../game-data/buildings.ts';
import { ConflictError, ValidationError } from '../../errors/domain-error.ts';
import { addCompanyExperience } from '../../game/company.ts';

export interface ConstructBuildingInput {
  kind: string;
  position: string;
  replaceExisting?: boolean;
}

export interface ConstructBuildingResult {
  building: BuildingEntity;
  cost: number;
  newMoney: number;
  resourcesConsumed: Array<{ kind: number; quality: number; amount: number }>;
}

export async function constructBuildingUseCase(
  ctx: GameContext,
  input: ConstructBuildingInput
): Promise<ConstructBuildingResult> {
  const { kind, position, replaceExisting = false } = input;
  const normPosition = normalizePosition(position);
  const meta = getBuildingMeta(kind);
  const { cost, materials } = estimateConstructionCost(kind, 1);

  return runInTransaction(async txCtx => {
    // 0. Validate building slot limits and locked positions
    const comp = companyRepository.findById(ctx.companyId);
    if (!comp) throw new NotFoundError(`Company ${ctx.companyId} not found`);
    const baseSlots = Math.min(14, 4 + Math.floor((Number(comp.level) || 0) / 3));
    const maxSlots = baseSlots + (Number(comp.extraBuildingSlots) || 0);

    // P0-07: "B<n>" lots are the star-unlocked slots. "B<n>" is unlocked when
    // n < extraBuildingSlots; plain numeric positions stay below maxSlots.
    const extraIndex = extraSlotIndex(normPosition);
    if (extraIndex !== null) {
      if (extraIndex >= (Number(comp.extraBuildingSlots) || 0)) {
        throw new ValidationError(`Position ${position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`);
      }
    } else {
      const posNum = Number(normPosition);
      if (Number.isInteger(posNum) && posNum >= maxSlots) {
        throw new ValidationError(`Position ${position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`);
      }
    }

    // 1. Validate position and existing buildings
    const existingAtPos = buildingRepository.findByCompanyAndPosition(ctx.companyId, normPosition);
    if (existingAtPos) {
      if (!replaceExisting) {
        throw new ConflictError(`Building position ${position} is already occupied`);
      }
      if (existingAtPos.busyUntil && new Date(existingAtPos.busyUntil).getTime() > Date.now()) {
        throw new ValidationError('Building is still busy with active operations or upgrades');
      }
      // Demolish existing building at position
      buildingRepository.delete(existingAtPos.id, ctx.companyId);
    } else {
      const currentCount = buildingRepository.countByCompany(ctx.companyId);
      if (currentCount >= maxSlots) {
        throw new ValidationError(`Building slot limit reached (${currentCount}/${maxSlots}). Unlock more building slots with SimBoosts.`);
      }
      validateConstructionPosition(normPosition, [], false);
    }

    // 2. Debit construction cost atomically (fails if insufficient funds)
    const newMoney = companyRepository.debitMoney(ctx.companyId, cost);

    // 3. Consume construction materials atomically
    const consumedList: Array<{ kind: number; quality: number; amount: number }> = [];
    for (const mat of materials) {
      const txs = warehouseRepository.consumeExact(ctx.companyId, mat.kind, 0, mat.amount);
      consumedList.push({
        kind: mat.kind,
        quality: 0,
        amount: mat.amount
      });
    }

    // 4. Create building
    const now = new Date().toISOString();
    const busyUntil = new Date(Date.now() + 10000).toISOString();

    const building = buildingRepository.create({
      companyId: ctx.companyId,
      position: normPosition,
      kind: String(kind),
      size: 1,
      name: meta.name,
      cost,
      category: meta.category,
      createdAt: now
    });
    addCompanyExperience(ctx.companyId, 20);

    buildingRepository.updateBusyUntil(building.id, ctx.companyId, busyUntil);
    const finalizedBuilding = { ...building, busyUntil };

    // 5. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'BuildingConstructed', {
      companyId: ctx.companyId,
      buildingId: finalizedBuilding.id,
      kind: finalizedBuilding.kind,
      position: finalizedBuilding.position,
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
