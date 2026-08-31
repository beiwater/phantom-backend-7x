import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import {
  estimateConstructionCost,
  validateConstructionPosition,
  normalizePosition
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
