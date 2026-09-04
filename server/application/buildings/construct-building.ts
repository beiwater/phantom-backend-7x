import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository } from '../../repositories/production-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import {
  estimateConstructionCost,
  validateConstructionPosition,
  normalizePosition,
  extraSlotIndex,
  assertNotBusyForConstructionWork,
  calculateConstructionDurationSeconds
} from '../../domain/buildings/building-rules.ts';
import { FixtureService } from '../../services/fixture-service.ts';
import { getTierForLevel } from '../../domain/leveling/level-rules.ts';
import { getBuildingMeta } from '../../game-data/buildings.ts';
import { ConflictError, ValidationError, NotFoundError } from '../../errors/domain-error.ts';
import { initialAbundanceForKind } from '../../game/buildings.ts';

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
    // Issue #71: canonical slot policy lives in the leveling domain
    // (getTierForLevel). Do not duplicate level formulas here.
    const maxSlots = getTierForLevel(Number(comp.level) || 0).maxBuildings
      + (Number(comp.extraBuildingSlots) || 0);

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
      // Issue #31: replacing a building with an active production queue would
      // orphan the queue rows (resolved=0 forever, inputs never refunded).
      // The player must cancel production first. Historical resolved rows are
      // allowed to remain. Any future busy_until (construction/upgrade or
      // recreation upkeep, which legitimately occupies busy) also blocks
      // replacement, as before — but now with the 409 busy contract (#47).
      const activeQueues = productionRepository.findActiveByBuilding(existingAtPos.id, ctx.companyId);
      if (activeQueues.length > 0) {
        throw new ConflictError('Building has an active production order; cancel production first');
      }
      assertNotBusyForConstructionWork(existingAtPos.busyUntil, virtualClock.nowMs());
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
    const now = virtualClock.nowIso();
    const mode = FixtureService.getActiveConstructionTimeMode();
    const speedMultiplier = FixtureService.getConstructionSpeedMultiplier();
    const durationSeconds = calculateConstructionDurationSeconds(kind, 1, mode, speedMultiplier);
    const busyUntil = new Date(virtualClock.nowMs() + durationSeconds * 1000).toISOString();
    const abundance = initialAbundanceForKind(String(kind));
    const building = buildingRepository.create({
      companyId: ctx.companyId,
      position: normPosition,
      kind: String(kind),
      size: 1,
      name: meta.name,
      cost,
      category: meta.category,
      createdAt: now,
      abundance: abundance.abundance,
      originalAbundance: abundance.originalAbundance
    });
    companyRepository.addExperience(ctx.companyId, 20);

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
