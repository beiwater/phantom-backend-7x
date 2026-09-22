import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { warehouseRepository, type WarehouseEntity } from '../../repositories/warehouse-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/domain-error.ts';
import { computeLevelInfo, type LevelInfoDTO } from '../../domain/leveling/level-rules.ts';
import { applyAbundanceCycleDecay } from '../../game/buildings.ts';
import { rocketKindForLaunchAmount, resolveRocketLaunch, type RocketLaunchOutcome } from '../../game/aerospace.ts';

export interface CollectProductionInput {
  buildingOrQueueId: number;
  /** Select building-first lookup for the public order/take contract. */
  preferBuildingId?: boolean;
}

export interface CollectProductionResult {
  collectedItem: ProductionQueueEntity;
  /** Launches resolve to no warehouse output (Issue #170). */
  warehouseItem: WarehouseEntity | null;
  /** Present when the collected order was a launch-pad launch (Issue #170). */
  launch?: RocketLaunchOutcome;
  building: BuildingEntity;
  currentMoney: number;
  levelInfo: LevelInfoDTO;
  levelUp: boolean;
  experienceGained: number;
}

export async function collectProductionUseCase(
  ctx: GameContext,
  input: CollectProductionInput
): Promise<CollectProductionResult> {
  return runInTransaction(async txCtx => {
    let targetItem: ProductionQueueEntity | null = null;
    if (input.preferBuildingId) {
      // The public order/take route supplies a building ID. Resolve it before
      // considering a historical queue row with the same numeric ID.
      const requestedBuilding = buildingRepository.findById(input.buildingOrQueueId);
      if (requestedBuilding?.companyId === ctx.companyId) {
        const activeByBuilding = productionRepository.findActiveByBuilding(requestedBuilding.id, ctx.companyId);
        // Find the earliest finished order for this building.
        const now = virtualClock.nowMs();
        targetItem = activeByBuilding.find(item => Date.parse(item.finishesAt) <= now) ?? null;
      }
    } else {
      // Preserve queue-first behavior for existing internal callers.
      const itemByQueue = productionRepository.findById(input.buildingOrQueueId);
      if (itemByQueue && itemByQueue.companyId === ctx.companyId && itemByQueue.resolved) {
        // An already-collected order must never be collected again.
        throw new ConflictError('Production order has already been collected');
      }
      const accumulatorBuilding = itemByQueue
        ? buildingRepository.findById(itemByQueue.buildingId)
        : null;
      if (itemByQueue && !itemByQueue.resolved
        && itemByQueue.companyId === ctx.companyId
        && itemByQueue.kind === 150
        && accumulatorBuilding?.kind === 'v') {
        // Issue #200: accumulator progress is cut down by its dedicated
        // application flow; never deliver the growth amount as ordinary stock.
        throw new ValidationError('Accumulator production must use the dedicated collect endpoint');
      }
      if (itemByQueue && itemByQueue.companyId === ctx.companyId) {
        targetItem = itemByQueue;
      }

      if (!targetItem) {
        // Legacy callers may also pass a building ID when no owned queue ID matches.
        const activeByBuilding = productionRepository.findActiveByBuilding(input.buildingOrQueueId, ctx.companyId);
        const now = virtualClock.nowMs();
        targetItem = activeByBuilding.find(item => Date.parse(item.finishesAt) <= now) ?? null;
      }
    }

    if (!targetItem) {
      throw new NotFoundError(`No completed production order found for ID ${input.buildingOrQueueId}`);
    }

    if (targetItem.companyId !== ctx.companyId) {
      throw new NotFoundError(`No completed production order found for ID ${input.buildingOrQueueId}`);
    }

    if (targetItem.resolved) {
      throw new ConflictError('Production order has already been collected');
    }

    const finishTime = Date.parse(targetItem.finishesAt);
    if (!Number.isFinite(finishTime) || finishTime > virtualClock.nowMs()) {
      throw new ValidationError('Production has not finished yet');
    }


    // 2. Atomically mark as resolved (idempotency barrier)
    const marked = productionRepository.markResolved(targetItem.id, ctx.companyId);
    if (!marked) {
      throw new ConflictError('Production order has already been collected');
    }

    // Issue #170: a kind-100 order on a launch pad is a rocket launch. Its
    // collect resolves the launch — crash roll, rocket_launches log, patents —
    // and produces no warehouse resource.
    const launchPad = buildingRepository.findById(targetItem.buildingId);
    let launchOutcome: RocketLaunchOutcome | null = null;
    if (launchPad && launchPad.kind === 'l' && targetItem.kind === 100) {
      const rocketKind = rocketKindForLaunchAmount(Number(targetItem.amount));
      if (rocketKind === null) {
        throw new ValidationError(`Invalid launch order amount: ${targetItem.amount}`);
      }
      launchOutcome = resolveRocketLaunch(
        ctx.companyId,
        targetItem.buildingId,
        rocketKind,
        Number(targetItem.quality) || 0
      );
    }

    // 3. Add produced resource to warehouse (launches produce none)
    const warehouseItem = launchOutcome ? null : warehouseRepository.addResource(
      ctx.companyId,
      targetItem.kind,
      targetItem.quality,
      targetItem.amount
    );

    // 4. Update building busy state
    const remainingActive = productionRepository.findLatestActiveByBuilding(targetItem.buildingId, ctx.companyId);
    const newBusyUntil = remainingActive ? remainingActive.finishesAt : null;
    // Issue #93: each completed production cycle (a production day) decays
    // the deposit abundance of natural resource extractors (Mine, Quarry,
    // Oil Rig) by 0.032%. Runs inside this transaction after the output has
    // been delivered; a rolled-back collect never decays.
    applyAbundanceCycleDecay(targetItem.buildingId);
    const updatedBuilding = buildingRepository.updateBusyUntil(targetItem.buildingId, ctx.companyId, newBusyUntil);

    // 5. Query company balance and level state BEFORE the reward
    const company = companyRepository.findById(ctx.companyId);
    const currentMoney = company?.money ?? 0;
    const levelBefore = company?.level ?? 0;

    // 6. Award production experience INSIDE the same transaction (P1-05).
    // Flat reward per completed production order; server-side rule is
    // deliberately simple because the official XP curve is not exposed.
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

    // 7. Publish domain event on transaction commit
    if (launchOutcome) {
      eventBus.publishCommitted(txCtx, 'RocketLaunched', {
        companyId: ctx.companyId,
        buildingId: targetItem.buildingId,
        queueId: targetItem.id,
        rocketKind: rocketKindForLaunchAmount(Number(targetItem.amount)),
        quality: targetItem.quality,
        success: launchOutcome.success,
        patentsEarned: launchOutcome.patentsEarned,
        launchedAt: virtualClock.nowIso()
      });
    }
    eventBus.publishCommitted(txCtx, 'ProductionCollected', {
      companyId: ctx.companyId,
      buildingId: targetItem.buildingId,
      queueId: targetItem.id,
      kind: targetItem.kind,
      quality: targetItem.quality,
      amount: targetItem.amount,
      experienceGained,
      level: levelAfter,
      collectedAt: virtualClock.nowIso()
    });

    return {
      collectedItem: targetItem,
      warehouseItem,
      building: updatedBuilding,
      currentMoney,
      levelInfo,
      levelUp: levelAfter > levelBefore,
      experienceGained,
      launch: launchOutcome ?? undefined
    };
  }, { immediate: true });
}
