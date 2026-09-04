import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { warehouseRepository, type ResourceTransactionEntity } from '../../repositories/warehouse-repository.ts';
import { eventBus } from '../../events/event-bus.ts';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../errors/domain-error.ts';
import { validateProductionRequest, resolveAchievableQuality } from '../../domain/production/production-rules.ts';
import { assertQueueDuration } from '../../domain/leveling/level-rules.ts';
import { calculateProductionTime } from '../../game-data/buildings.ts';
import { isAbundanceExtractorKind, getBuildingAbundance, scaleExtractorOutput } from '../../game/buildings.ts';
import { assertAllowedProduct } from '../../game/robotics.ts';
import { queueRocketLaunch, rocketKindForLaunchRequest } from '../../game/aerospace.ts';
import { getEconomyPhase } from '../scheduler/daily-jobs.ts';
import { getCompanyBoostSettings } from '../../game/simboost-settings.ts';
import { accumulatorRepository } from '../../repositories/accumulator-repository.ts';
import { getAccumulatorParameters, accumulatorBonusForResearch } from '../../game-data/accumulator.ts';
import { getProductionQualityCap } from '../../game/research.ts';

export interface StartProductionInput {
  buildingId: number;
  kind: number;
  amount: number;
  quality?: number | null;
}

export interface StartProductionResult {
  queueItem: ProductionQueueEntity;
  building: BuildingEntity;
  resourceTransactions: ResourceTransactionEntity[];
  /** Compatibility message override (e.g. launch confirmation, Issue #170). */
  message?: string;
}

export async function startProductionUseCase(
  ctx: GameContext,
  input: StartProductionInput
): Promise<StartProductionResult> {
  const economy = getEconomyPhase(ctx.realmId);
  const companyBoost = getCompanyBoostSettings(ctx.companyId);
  return runInTransaction(async txCtx => {
    // 1. Validate building ownership
    const building = buildingRepository.findById(input.buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }

    // Launch-pad cards identify the actual rocket product. Keep accepting the
    // legacy kind-100 payload only as an amount-based compatibility form.
    if (building.kind === 'l' && (input.kind === 100 || input.kind === 91 || input.kind === 94)) {
      const rocketKind = rocketKindForLaunchRequest(input.kind, input.amount);
      if (rocketKind === null) {
        throw new ValidationError(
          input.kind === 100
            ? `Invalid launch order amount: ${input.amount}. Expected 400 (Sub-Orbital Rocket) or 2800 (BFR)`
            : `Invalid launch quantity for rocket resource #${input.kind}; expected amount 1`
        );
      }
      // Construction/upgrade busy still applies; an active launch queue does
      // not — the original allows chaining launches up to LAUNCH_QUEUE_MAX.
      if (building.busyUntil && new Date(building.busyUntil).getTime() > virtualClock.nowMs()
        && productionRepository.findActiveByBuilding(building.id, ctx.companyId).length === 0) {
        throw new ConflictError('Building is still under construction or upgrade');
      }
      const launch = await queueRocketLaunch(
        ctx.companyId,
        building.id,
        rocketKind,
        input.quality ?? 0,
        { consumeResearch: input.kind === 100 }
      );
      const refreshed = buildingRepository.findById(building.id);
      if (!refreshed) {
        throw new NotFoundError(`Building ${building.id} not found`);
      }
      return {
        queueItem: launch.queueItem,
        building: refreshed,
        resourceTransactions: launch.transactions.map(tx => ({
          kind: tx.kind,
          quality: tx.quality,
          amount: -tx.amount,
          cost: 0
        })),
        message: 'Launch queued successfully',
      } satisfies StartProductionResult;
    }

    const accumulatorParameters = building.kind === 'v'
      ? getAccumulatorParameters(input.kind)
      : null;
    const isAccumulator = accumulatorParameters !== null;

    // Issue #200: Forest Nursery growth is progress, not immediate inventory.
    // Keep the requested growth amount in the queue and persist the accumulator
    // row before any material debit so max-boundary rejection is atomic.
    if (isAccumulator) {
      const state = accumulatorRepository.ensureForBuilding(building.id, ctx.companyId, input.kind);
      if (state.value + input.amount > accumulatorParameters.max) {
        throw new ValidationError(`Accumulator value exceeds maximum ${accumulatorParameters.max}`);
      }
    }

    // Issue #96: a robotized building is locked to its specialized product;
    // any other production request is rejected while robots are installed.
    assertAllowedProduct(building, input.kind);
    // C-13: official contract rejects production on a busy building instead of
    // silently chaining the new item behind the running queue.
    // Issue #47: construction/upgrade busy (no queue rows at all) is also a
    // 409 conflict — a freshly constructed/upgraded building must finish its
    // busy window before it can start production.
    if (building.busyUntil && new Date(building.busyUntil).getTime() > virtualClock.nowMs()) {
      const activeQueues = productionRepository.findActiveByBuilding(building.id, ctx.companyId);
      if (activeQueues.length === 0) {
        throw new ConflictError('Building is still under construction or upgrade');
      }
      throw new ConflictError('Building is busy with an active production order');
    }

    // 2. Validate production rules & ingredients
    const { ingredients } = validateProductionRequest(
      building.kind,
      input.kind,
      input.amount,
      input.quality ?? null
    );

    // Issue #99: the queue item's duration must fit the company tier limit
    // (2h below L5, 24h below L15, 48h at L15+). Enforced BEFORE any
    // ingredients are consumed so the duration rejection is side-effect free.
    const combinedProductionModifier = Math.max(
      -0.75,
      Math.min(3, economy.productionModifier + (companyBoost.productionModifier / 100))
    );
    const researchedAccumulatorQuality = isAccumulator
      ? getProductionQualityCap(ctx.companyId, input.kind)
      : 0;
    const accumulatorBonus = accumulatorBonusForResearch(input.kind, researchedAccumulatorQuality);
    const productionOutputMultiplier = isAccumulator
      ? 1
      : Math.max(0.5, Math.min(1.5, 1 + economy.productionModifier));
    const durationSeconds = calculateProductionTime(
      input.kind,
      input.amount,
      building.size,
      combinedProductionModifier,
      {
        economyState: economy.state,
        quality: input.quality ?? 100,
        accumulatorBonus
      }
    );
    assertQueueDuration(
      companyRepository.findById(ctx.companyId)?.level ?? 0,
      durationSeconds,
      'Production'
    );
    // Issue #93: natural resource extractors (Mine 'M', Quarry 'Q', Oil Rig
    // 'O') scale their output linearly with the deposit abundance:
    // outputAmount = round(baseAmount * abundance / 100). Ingredients and
    // duration stay based on the ordered base amount; only the delivered
    // output is scaled.
    const baseOutputAmount = isAbundanceExtractorKind(building.kind)
      ? scaleExtractorOutput(input.amount, getBuildingAbundance(building.id)?.abundance ?? 100)
      : input.amount;
    // Accumulator queues store growth progress. The tree inventory output is
    // materialized only by the dedicated cut-down collect use case.
    const outputAmount = isAccumulator
      ? input.amount
      : Math.max(1, Math.round(baseOutputAmount * productionOutputMultiplier));
    // 3. Consume required ingredients atomically, tracking the weighted
    // average input quality and total cost basis (P0-02).
    const allTransactions: ResourceTransactionEntity[] = [];
    let totalInputAmount = 0;
    let weightedQualitySum = 0; // sum of amount * quality across inputs
    let totalInputCost = 0;
    for (const ingredient of ingredients) {
      const txs = warehouseRepository.consumeWithTransactions(
        ctx.companyId,
        ingredient.kind,
        0,
        ingredient.amount
      );
      for (const tx of txs) {
        const txAmount = Math.abs(Number(tx.amount));
        totalInputAmount += txAmount;
        weightedQualitySum += txAmount * (Number(tx.quality) || 0);
        totalInputCost += txAmount * (Number(tx.cost) || 0);
      }
      allTransactions.push(...txs);
    }
    const averageInputQuality = totalInputAmount > 0 ? weightedQualitySum / totalInputAmount : 0;
    const inputCostPerOutputUnit = input.amount > 0 ? totalInputCost / input.amount : 0;

    // 4. Queue chaining (durationSeconds was computed and validated against
    // the tier limit before ingredients were consumed)
    const latestActive = productionRepository.findLatestActiveByBuilding(building.id, ctx.companyId);

    const now = virtualClock.now();
    let startTime = now;
    if (latestActive) {
      const latestFinish = new Date(latestActive.finishesAt);
      if (latestFinish > now) {
        startTime = latestFinish;
      }
    }

    const finishTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const startedAt = startTime.toISOString();
    const finishesAt = finishTime.toISOString();

    // 5. Determine quality: the requested (research-capped) quality drives the
    // output tier; when not explicitly requested the output quality is the
    // input-amount-weighted average input quality, floored to an integer
    // (P0-02: persisted at queue time so it survives refresh).
    const requested = input.quality ?? null;
    const achievableQuality = resolveAchievableQuality(
      ctx.companyId,
      input.kind,
      requested
    );
    const persistedQuality = requested !== null
      ? achievableQuality
      : Math.max(0, Math.floor(averageInputQuality));

    const queueItem = productionRepository.create({
      buildingId: building.id,
      companyId: ctx.companyId,
      kind: input.kind,
      quality: persistedQuality,
      cost: inputCostPerOutputUnit,
      amount: outputAmount,
      durationSeconds,
      startedAt,
      finishesAt,
      economyPhase: economy.state,
      economyPhaseStartedAt: economy.startAt,
      economySource: economy.source,
      productionModifier: combinedProductionModifier,
      productionOutputMultiplier
    });

    // 7. Update building busy state
    const updatedBuilding = buildingRepository.updateBusyUntil(building.id, ctx.companyId, finishesAt);

    // 8. Publish domain event on transaction commit
    eventBus.publishCommitted(txCtx, 'ProductionStarted', {
      companyId: ctx.companyId,
      buildingId: building.id,
      queueId: queueItem.id,
      kind: input.kind,
      amount: outputAmount,
      quality: achievableQuality,
      startedAt,
      finishesAt,
      economyPhase: economy.state,
      productionModifier: combinedProductionModifier,
      productionOutputMultiplier
    });

    return {
      queueItem,
      building: updatedBuilding,
      resourceTransactions: allTransactions
    };
  }, { immediate: true });
}
