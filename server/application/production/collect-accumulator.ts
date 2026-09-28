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

/** Finish nurturing without cutting the trees down or issuing inventory. */
export async function resolveDueAccumulatorGrowth(buildingId: number, companyId: number): Promise<void> {
  await runInTransaction(() => {
    const building = buildingRepository.findById(buildingId);
    if (!building || building.companyId !== companyId || building.kind !== 'v') return;
    const params = getAccumulatorParameters(150);
    if (!params) throw new ValidationError('Building does not support accumulator production');
    const due = productionRepository.findActiveByBuilding(buildingId, companyId)
      .filter(item => item.kind === 150 && Date.parse(item.finishesAt) <= virtualClock.nowMs());
    if (due.length === 0) return;
    let state = accumulatorRepository.ensureForBuilding(buildingId, companyId, 150);
    for (const item of due) {
      const value = Number(state.value) + Number(item.amount);
      const cost = Number(state.costTotal) + Number(item.cost ?? 0) * Number(item.amount);
      if (state.resourceKind !== 150 || !Number.isFinite(value) || value < 0 || value > params.max
        || !(Number(item.amount) > 0) || !Number.isFinite(cost) || cost < 0) {
        throw new ValidationError('Accumulator state is outside the canonical bounds');
      }
      if (!productionRepository.markResolved(item.id, companyId)) {
        throw new ConflictError('Accumulator growth has already been resolved');
      }
      state = accumulatorRepository.updateProgress(buildingId, companyId, value, cost);
    }
    const remaining = productionRepository.findLatestActiveByBuilding(buildingId, companyId);
    buildingRepository.updateBusyUntil(buildingId, companyId, remaining?.finishesAt ?? null);
  }, { immediate: true });
}

/**
 * Cut down a completed Forest Nursery cycle. Accumulator growth remains in a
 * separate state row: collecting emits one tree per nursery slot only after a
 * stage threshold is reached. The original cut-down modal explicitly says
 * new trees grow from the start; cutting below Q0 loses the current progress.
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
    if (queue.active && (!Number.isFinite(Date.parse(queue.active.finishesAt))
      || Date.parse(queue.active.finishesAt) > virtualClock.nowMs())) {
      throw new ValidationError('Accumulator production has not finished yet');
    }
    await resolveDueAccumulatorGrowth(buildingId, ctx.companyId);

    const state = accumulatorRepository.ensureForBuilding(buildingId, ctx.companyId, 150);
    if (state.resourceKind !== 150) {
      throw new ValidationError('Accumulator resource does not belong to this building');
    }
    const priorValue = Number(state.value);
    const priorCost = Number(state.costTotal);
    if (!Number.isFinite(priorValue) || priorValue < 0 || priorValue > params.max
      || !Number.isFinite(priorCost) || priorCost < 0) {
      throw new ValidationError('Accumulator state is outside the canonical bounds');
    }
    if (priorValue === 0) {
      if (queue.latest?.resolved) throw new ConflictError('Accumulator production has already been collected');
      throw new NotFoundError(`No accumulator production found for building ${buildingId}`);
    }
    const completedValue = priorValue;
    if (!Number.isFinite(completedValue) || completedValue > params.max) {
      throw new ValidationError(`Accumulator value exceeds maximum ${params.max}`);
    }

    const completedQuality = accumulatorQualityForValue(completedValue, 150);
    const outputAmount = completedQuality === null ? 0
      : Math.max(1, Math.floor(building.size * params.amountPerLevel));
    const outputQuality = completedQuality ?? 0;
    const totalCost = priorCost;
    // Original bundle messageYouWillReceiveTheTree/messageYouWillNotReceiveAnyTree:
    // all growth is cut down; any issued trees carry the complete source cost.
    const consumedCost = completedQuality === null ? 0 : totalCost;

    const accumulator = accumulatorRepository.updateProgress(
      buildingId,
      ctx.companyId,
      0,
      0
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
    const experienceGained = outputAmount > 0 ? 10 : 0;
    if (experienceGained > 0) companyRepository.addExperience(ctx.companyId, experienceGained);
    const companyAfter = companyRepository.findById(ctx.companyId);
    const levelAfter = companyAfter?.level ?? levelBefore;
    const levelInfo = computeLevelInfo({
      level: companyAfter?.level ?? 0,
      experience: companyAfter?.experience ?? 0,
      rating: companyAfter?.rating,
      extra_building_slots: companyAfter?.extraBuildingSlots ?? 0
    });

    if (queue.latest && outputAmount > 0) eventBus.publishCommitted(txCtx, 'ProductionCollected', {
      companyId: ctx.companyId,
      buildingId,
      queueId: queue.latest.id,
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
