import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { accumulatorRepository, type AccumulatorState } from '../../repositories/accumulator-repository.ts';
import { warehouseRepository, type WarehouseEntity } from '../../repositories/warehouse-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/domain-error.ts';
import {
  accumulatorQualityForValue,
  accumulatorStateDTO,
  accumulatorThresholdForQuality,
  getAccumulatorParameters
} from '../../game-data/accumulator.ts';
import { computeLevelInfo, type LevelInfoDTO } from '../../domain/leveling/level-rules.ts';

export interface AccumulatorResourceResult {
  kind: number;
  quality: number;
  amount: number;
}

export interface CollectAccumulatorResult {
  resource: AccumulatorResourceResult;
  building: BuildingEntity;
  accumulator: AccumulatorState;
  warehouseItem: WarehouseEntity | null;
  currentMoney: number;
  levelInfo: LevelInfoDTO;
  levelUp: boolean;
  experienceGained: number;
}

function findAccumulatorQueue(buildingId: number, companyId: number): {
  active: ProductionQueueEntity | null;
  latest: ProductionQueueEntity | null;
} {
  const active = productionRepository
    .findActiveByBuilding(buildingId, companyId)
    .filter(item => item.kind === 150)
    .sort((a, b) => Date.parse(a.finishesAt) - Date.parse(b.finishesAt) || a.id - b.id)[0] ?? null;
  const latest = productionRepository
    .findHistoryByBuilding(buildingId, 20)
    .filter(item => item.kind === 150)
    .sort((a, b) => b.id - a.id)[0] ?? null;
  return { active, latest };
}

/**
 * Cut down a completed Forest Nursery cycle. Accumulator growth remains in a
 * separate state row: collecting emits one tree per nursery slot only after a
 * stage threshold is reached, then carries residual growth and cost forward.
 */
export async function collectAccumulatorUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<CollectAccumulatorResult> {
  return runInTransaction(async txCtx => {
    const building = buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    const params = getAccumulatorParameters(150);
    if (!params || building.kind !== 'v') {
      throw new ValidationError('Building does not support accumulator production');
    }

    const queue = findAccumulatorQueue(buildingId, ctx.companyId);
    if (!queue.active) {
      if (queue.latest?.resolved) {
        throw new ConflictError('Accumulator production has already been collected');
      }
      throw new NotFoundError(`No accumulator production found for building ${buildingId}`);
    }

    const finishTime = Date.parse(queue.active.finishesAt);
    if (!Number.isFinite(finishTime) || finishTime > virtualClock.nowMs()) {
      throw new ValidationError('Accumulator production has not finished yet');
    }

    const state = accumulatorRepository.ensureForBuilding(buildingId, ctx.companyId, 150);
    if (state.resourceKind !== 150) {
      throw new ValidationError('Accumulator resource does not belong to this building');
    }
    const priorValue = Number(state.value);
    const growth = Number(queue.active.amount);
    const priorCost = Number(state.costTotal);
    const growthCost = Number(queue.active.cost ?? 0) * growth;
    if (!Number.isFinite(priorValue) || priorValue < 0 || priorValue > params.max
      || !Number.isFinite(growth) || growth <= 0
      || !Number.isFinite(priorCost) || priorCost < 0
      || !Number.isFinite(growthCost) || growthCost < 0) {
      throw new ValidationError('Accumulator state is outside the canonical bounds');
    }

    const completedValue = priorValue + growth;
    if (!Number.isFinite(completedValue) || completedValue > params.max) {
      throw new ValidationError(`Accumulator value exceeds maximum ${params.max}`);
    }

    const completedQuality = accumulatorQualityForValue(completedValue, 150);
    const outputAmount = completedQuality === null ? 0 : Math.max(1, Math.floor(building.size));
    const outputQuality = completedQuality ?? 0;
    const totalCost = priorCost + growthCost;
    const consumedThreshold = completedQuality === null
      ? 0
      : accumulatorThresholdForQuality(150, completedQuality);
    const consumedCost = completedQuality === null || completedValue <= 0
      ? 0
      : totalCost * consumedThreshold / completedValue;
    const nextValue = completedQuality === null
      ? completedValue
      : Math.max(0, completedValue - consumedThreshold);
    const nextCost = Math.max(0, totalCost - consumedCost);

    if (!productionRepository.markResolved(queue.active.id, ctx.companyId)) {
      throw new ConflictError('Accumulator production has already been collected');
    }
    const accumulator = accumulatorRepository.updateProgress(
      buildingId,
      ctx.companyId,
      nextValue,
      nextCost
    );
    const warehouseItem = outputAmount > 0
      ? warehouseRepository.addResource(
        ctx.companyId,
        150,
        outputQuality,
        outputAmount,
        { market: outputAmount > 0 ? consumedCost / outputAmount : 0 }
      )
      : null;

    const remainingActive = productionRepository.findLatestActiveByBuilding(buildingId, ctx.companyId);
    const updatedBuilding = buildingRepository.updateBusyUntil(
      buildingId,
      ctx.companyId,
      remainingActive ? remainingActive.finishesAt : null
    );

    const company = companyRepository.findById(ctx.companyId);
    const levelBefore = company?.level ?? 0;
    const currentMoney = company?.money ?? 0;
    const experienceGained = 10;
    companyRepository.addExperience(ctx.companyId, experienceGained);
    const companyAfter = companyRepository.findById(ctx.companyId);
    const levelAfter = companyAfter?.level ?? levelBefore;
    const levelInfo = computeLevelInfo({
      level: companyAfter?.level ?? 0,
      experience: companyAfter?.experience ?? 0,
      rating: companyAfter?.rating,
      extra_building_slots: companyAfter?.extraBuildingSlots ?? 0
    });

    eventBus.publishCommitted(txCtx, 'ProductionCollected', {
      companyId: ctx.companyId,
      buildingId,
      queueId: queue.active.id,
      kind: 150,
      quality: outputQuality,
      amount: outputAmount,
      collectedAt: virtualClock.nowIso()
    });

    return {
      resource: { kind: 150, quality: outputQuality, amount: outputAmount },
      building: updatedBuilding,
      accumulator,
      warehouseItem,
      currentMoney,
      levelInfo,
      levelUp: levelAfter > levelBefore,
      experienceGained
    };
  }, { immediate: true });
}

export function toAccumulatorStateDTO(state: AccumulatorState): ReturnType<typeof accumulatorStateDTO> {
  return accumulatorStateDTO(state.resourceKind, state.value, state.costTotal);
}
