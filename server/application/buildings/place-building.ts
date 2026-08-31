import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { normalizePosition, extraSlotIndex } from '../../domain/buildings/building-rules.ts';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/domain-error.ts';

/**
 * P1-10: place a LIFTED building ("position" starts with 'l' after the
 * client's Reposition action) onto a chosen, unlocked, unoccupied slot.
 * Completes the two-step move:
 *   1. PATCH /api/v2/companies/me/buildings/:id/ { position: 'l' }
 *      (lifts the building off its slot; original position is released)
 *   2. POST /api/v2/companies/me/buildings/ { position, id } (this use case)
 *
 * Issue #68: the position swap is one atomic transaction; validation of
 * slot unlock state and occupancy happens inside it.
 */
export interface PlaceBuildingInput {
  buildingId: number;
  position: string;
}

export async function placeBuildingUseCase(
  ctx: GameContext,
  input: PlaceBuildingInput
): Promise<BuildingEntity> {
  return runInTransaction(async txCtx => {
    const building = buildingRepository.findById(input.buildingId);
    if (!building || building.companyId !== ctx.companyId) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }

    const normPosition = normalizePosition(input.position);

    const comp = companyRepository.findById(ctx.companyId);
    if (!comp) throw new NotFoundError(`Company ${ctx.companyId} not found`);
    const baseSlots = Math.min(14, 4 + Math.floor((Number(comp.level) || 0) / 3));
    const maxSlots = baseSlots + (Number(comp.extraBuildingSlots) || 0);

    // P0-07: "B<n>" lots are the star-unlocked slots, unlocked when n < extraBuildingSlots.
    const extraIndex = extraSlotIndex(normPosition);
    if (extraIndex !== null) {
      if (extraIndex >= (Number(comp.extraBuildingSlots) || 0)) {
        throw new ValidationError(
          `Position ${input.position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`
        );
      }
    } else {
      const posNum = Number(normPosition);
      if (!Number.isInteger(posNum) || posNum < 0) {
        throw new ValidationError(`Invalid building position: ${input.position}`);
      }
      if (posNum >= maxSlots) {
        throw new ValidationError(
          `Position ${input.position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`
        );
      }
    }

    const existingAtPos = buildingRepository.findByCompanyAndPosition(ctx.companyId, normPosition);
    if (existingAtPos && existingAtPos.id !== building.id) {
      throw new ConflictError(`Building position ${input.position} is already occupied`);
    }

    // Note: lifted buildings (position 'l') keep their busy state; the client
    // refuses to list busy buildings in the placement modal anyway.
    const updated = buildingRepository.updatePosition(building.id, ctx.companyId, normPosition);

    eventBus.publishCommitted(txCtx, 'BuildingPlaced', {
      companyId: ctx.companyId,
      buildingId: building.id,
      position: normPosition
    });

    return updated;
  }, { immediate: true });
}

/**
 * P1-10 (Reposition step 1): lift a building off its slot. The building's
 * position becomes 'l' — the marker the original client uses to list
 * lifted buildings in the placement modal — which atomically releases the
 * original position.
 */
export async function liftBuildingUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<BuildingEntity> {
  return runInTransaction(async txCtx => {
    const building = buildingRepository.findById(buildingId);
    if (!building || building.companyId !== ctx.companyId) {
      throw new NotFoundError(`Building ${buildingId} not found`);
    }

    const updated = buildingRepository.updatePosition(building.id, ctx.companyId, 'l');

    eventBus.publishCommitted(txCtx, 'BuildingLifted', {
      companyId: ctx.companyId,
      buildingId: building.id
    });

    return updated;
  }, { immediate: true });
}
