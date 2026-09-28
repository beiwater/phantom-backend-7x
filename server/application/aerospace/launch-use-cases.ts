import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { eventBus } from '../../events/event-bus.ts';
import { buildingRepository } from '../../repositories/building-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { productionRepository, type ProductionInputIngredient, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { aerospaceRepository } from '../../repositories/aerospace-repository.ts';
import { getCompanyBoostSettings } from '../../game/simboost-settings.ts';
import { LAUNCH_QUEUE_MAX, ROCKET_CONFIGS, rocketKindForLaunchAmount, calculateLaunchDurationSeconds, computeRocketLaunchOutcome,
  type RocketLaunchOutcome, type QueuedLaunchItem, type QueueRocketLaunchOptions } from '../../domain/aerospace/launch-rules.ts';

export function resolveRocketLaunch(
  companyId: number,
  buildingId: number,
  rocketKind: number,
  quality: number,
  realmId: number = 0
): RocketLaunchOutcome {
  const outcome = computeRocketLaunchOutcome(rocketKind, quality, Math.random());
  aerospaceRepository.recordLaunch(companyId, realmId, buildingId, rocketKind, quality, outcome.success, virtualClock.nowIso());
  return outcome;
}

export async function queueRocketLaunch(
  companyId: number,
  buildingId: number,
  rocketKind: number,
  quality: number = 0,
  options: QueueRocketLaunchOptions = {}
): Promise<QueuedLaunchItem & { queueItem: ProductionQueueEntity; transactions: Array<{
  kind: number;
  quality: number;
  amount: number;
  cost: number;
  costWorkers: number;
  costAdmin: number;
  costMaterial1: number;
  costMaterial2: number;
  costMarket: number;
}> }> {
  return runInTransaction(() => {
    // 1. Fetch building and validate
    const building = buildingRepository.findById(buildingId);
    if (!building) {
      throw new Error('Building not found');
    }
    if (Number(building.companyId) !== companyId) {
      throw new Error('Building does not belong to your company');
    }

    // 2. Validate rocket configuration
    const config = ROCKET_CONFIGS[rocketKind];
    if (!config) {
      throw new Error(`Invalid rocket kind: ${rocketKind}. Supported kinds are 91 (Sub-Orbital Rocket) and 94 (BFR)`);
    }

    // 3. Validate building level
    const buildingLevel = Number(building.size) || 1;
    if (buildingLevel < config.minLevel) {
      throw new Error(`Requires launch pad level ${config.minLevel} or higher (current level: ${buildingLevel})`);
    }

    // 4. Validate queue capacity (unresolved launch orders on this pad)
    const launchResearchCosts = Object.values(ROCKET_CONFIGS).map(config => config.researchCost);
    const queueCount = productionRepository.findActiveByBuilding(buildingId, companyId)
      .filter(row => row.kind === 100 && launchResearchCosts.includes(row.amount)).length;
    if (queueCount >= LAUNCH_QUEUE_MAX) {
      throw new Error(`Launch queue is full (maximum ${LAUNCH_QUEUE_MAX} queued launches)`);
    }

    // 5. Validate inventory
    const safeQuality = Math.max(0, Math.floor(quality || 0));
    const rocketStock = warehouseRepository.findByCompanyAndResource(companyId, rocketKind, safeQuality);
    if (!rocketStock || Number(rocketStock.amount) < 1) {
      throw new Error(`Insufficient rocket inventory in warehouse (resource #${rocketKind} Q${safeQuality})`);
    }
    const consumeResearch = options.consumeResearch !== false;
    if (consumeResearch) {
      const researchStock = warehouseRepository.findByCompanyAndResource(companyId, 100, 0);
      if (!researchStock || Number(researchStock.amount) < config.researchCost) {
        const available = Number(researchStock?.amount || 0);
        throw new Error(`Insufficient Aerospace Research (resource #100). Required: ${config.researchCost}, available: ${available}`);
      }
    }

    // 6. Compute launch duration and queue chaining. Launch orders live in
    // production_queues (kind 100) so the generic queue/busy/collect pipeline
    // sees them — the original client models a launch as an Aerospace Research
    // production order on the pad (Issue #170). Launches are exempt from the
    // tier queue-duration limit: the original launch duration (128h at L1)
    // exceeds every tier limit by design.
    const boostSettings = getCompanyBoostSettings(companyId);
    const prodMod = boostSettings?.productionModifier || 0;
    const durationSeconds = calculateLaunchDurationSeconds(buildingLevel, prodMod);

    const nowMs = virtualClock.nowMs();
    let startMs = nowMs;
    const lastActive = productionRepository.findLatestActiveByBuilding(buildingId, companyId);
    if (lastActive && new Date(lastActive.finishesAt).getTime() > nowMs) {
      startMs = new Date(lastActive.finishesAt).getTime();
    }
    const finishMs = startMs + durationSeconds * 1000;
    const startedAt = new Date(startMs).toISOString();
    const finishesAt = new Date(finishMs).toISOString();

    const consumedRocket = warehouseRepository.consumeExact(companyId, rocketKind, safeQuality, 1);
    if (!consumedRocket) {
      throw new Error(`Failed to consume rocket resource #${rocketKind} Q${safeQuality}`);
    }

    // Legacy kind-100 launches debit research; product-kind launches do not.
    const consumedResearch = consumeResearch
      ? warehouseRepository.consumeExact(companyId, 100, 0, config.researchCost)
      : [];
    if (consumeResearch && (!consumedResearch || consumedResearch.length === 0)) {
      throw new Error(`Failed to consume ${config.researchCost} Aerospace Research (resource #100)`);
    }
    const researchTransactions = consumedResearch ?? [];
    const inputIngredients: ProductionInputIngredient[] = [
      ...consumedRocket,
      ...researchTransactions
    ].map(transaction => ({
      kind: Number(transaction.kind),
      amount: Math.abs(Number(transaction.amount)),
      cost: {
        workers: Number(transaction.costWorkers) || 0,
        admin: Number(transaction.costAdmin) || 0,
        material1: Number(transaction.costMaterial1) || 0,
        material2: Number(transaction.costMaterial2) || 0,
        market: Number(transaction.costMarket) || 0
      }
    }));

    // Insert launch order — amount encodes the rocket kind (rocketKindForLaunchAmount)
    const queueItem = productionRepository.create({
      buildingId,
      companyId,
      kind: 100,
      quality: safeQuality,
      cost: 0,
      amount: config.researchCost,
      durationSeconds,
      startedAt,
      finishesAt,
      launchConsumesResearch: consumeResearch,
      inputIngredients
    });

    // Update building busy_until if needed
    if (!building.busyUntil || new Date(String(building.busyUntil)).getTime() < finishMs) {
      buildingRepository.updateBusyUntil(buildingId, companyId, finishesAt);
    }

    return {
      id: queueItem.id,
      buildingId,
      companyId,
      rocketKind,
      quality: safeQuality,
      status: 'QUEUED',
      started: startedAt,
      finishes: finishesAt,
      finishes_at: finishesAt,
      duration: durationSeconds,
      createdAt: startedAt,
      queueItem,
      transactions: [
        ...consumedRocket.map(tx => ({
          kind: Number(tx.kind),
          quality: Number(tx.quality),
          amount: Math.abs(Number(tx.amount)),
          cost: Number(tx.cost) || 0,
          costWorkers: Number(tx.costWorkers) || 0,
          costAdmin: Number(tx.costAdmin) || 0,
          costMaterial1: Number(tx.costMaterial1) || 0,
          costMaterial2: Number(tx.costMaterial2) || 0,
          costMarket: Number(tx.costMarket) || 0
        })),
        ...researchTransactions.map(tx => ({
          kind: Number(tx.kind),
          quality: Number(tx.quality),
          amount: Math.abs(Number(tx.amount)),
          cost: Number(tx.cost) || 0,
          costWorkers: Number(tx.costWorkers) || 0,
          costAdmin: Number(tx.costAdmin) || 0,
          costMaterial1: Number(tx.costMaterial1) || 0,
          costMaterial2: Number(tx.costMaterial2) || 0,
          costMarket: Number(tx.costMarket) || 0
        }))
      ]
    };
  }, { immediate: true });
}

export async function cancelQueuedLaunch(
  companyId: number,
  buildingId: number,
  launchId?: number
): Promise<{
  success: boolean;
  message: string;
  id: number;
  status: string;
  refunded: {
    rocketKind: number;
    quality: number;
    amount: number;
    researchPoints: number;
  };
}> {
  return runInTransaction(txCtx => {
    // 1. Fetch building and validate
    const building = buildingRepository.findById(buildingId);
    if (!building) {
      throw new Error('Building not found');
    }
    if (Number(building.companyId) !== companyId) {
      throw new Error('Building does not belong to your company');
    }

    // 2. Find the target launch order (an unresolved kind-100 production_queues
    // row on this pad). Finished-but-uncollected launches are not cancellable —
    // they must be collected (order/take) so the outcome is logged exactly once.
    let targetLaunch: {
      id: number;
      rocketKind: number;
      quality: number;
      researchCost: number;
      consumeResearch: boolean;
      startedAt: string;
      durationSeconds: number;
      inputIngredients: ProductionInputIngredient[] | null;
    } | undefined;
    const nowMs = virtualClock.nowMs();
    const loadRow = (row: ProductionQueueEntity) => {
      // Only a launch that is still waiting for its start can be cancelled.
      // Running/finished launches must resolve through the collect path.
      if (new Date(row.startedAt).getTime() <= nowMs || new Date(row.finishesAt).getTime() <= nowMs) return;
      const rocketKind = rocketKindForLaunchAmount(Number(row.amount));
      if (rocketKind === null) return;
      const config = ROCKET_CONFIGS[rocketKind];
      targetLaunch = {
        id: row.id,
        rocketKind,
        quality: Number(row.quality) || 0,
        researchCost: config?.researchCost ?? Number(row.amount),
        consumeResearch: row.launchConsumesResearch,
        startedAt: row.startedAt,
        durationSeconds: row.durationSeconds,
        inputIngredients: row.inputIngredients
      };
    };
    if (launchId !== undefined && launchId !== null) {
      const row = productionRepository.findById(launchId);
      if (row && row.buildingId === buildingId && row.companyId === companyId && !row.resolved) {
        loadRow(row);
      }
    } else {
      const rows = productionRepository.findActiveByBuilding(buildingId, companyId)
        .filter(row => row.kind === 100)
        .sort((a, b) => b.id - a.id);
      for (const row of rows) {
        loadRow(row);
        if (targetLaunch) break;
      }
    }
    if (!targetLaunch) {
      throw new Error('Queued launch not found or already started/cancelled');
    }
    const launch = targetLaunch;

    // Remove the launch order (production_queues row) and refund resources
    const deleted = productionRepository.delete(launch.id, companyId);
    if (!deleted) {
      throw new Error('Failed to cancel launch order');
    }

    // New rows restore the original resource batches' per-unit cost buckets.
    // Legacy rows retain the helper's historical default basis.
    const refunds = launch.inputIngredients ?? [
      { kind: launch.rocketKind, amount: 1, quality: launch.quality },
      ...(launch.consumeResearch ? [{ kind: 100, amount: launch.researchCost, quality: 0 }] : [])
    ];
    for (const ingredient of refunds) {
      const basis = ingredient.cost;
      const costs = typeof basis === 'number' ? { market: basis } : { market: 1, ...basis };
      warehouseRepository.addResource(companyId, ingredient.kind, 0, ingredient.amount, costs);
    }

    // Re-chain remaining launch/production orders on this pad
    const remaining = productionRepository.findActiveByBuilding(buildingId, companyId);
    const cancelledStartMs = Date.parse(launch.startedAt);
    const cancelledDurationMs = launch.durationSeconds * 1000;
    const finishTimes: number[] = [];
    for (const item of remaining) {
      const originalStartMs = Date.parse(item.startedAt);
      const originalFinishMs = Date.parse(item.finishesAt);
      if (originalStartMs >= cancelledStartMs) {
        const newStartMs = originalStartMs - cancelledDurationMs;
        const newFinishMs = originalFinishMs - cancelledDurationMs;
        productionRepository.updateSchedule(item.id, companyId, new Date(newStartMs).toISOString(), new Date(newFinishMs).toISOString());
        finishTimes.push(newFinishMs);
      } else {
        finishTimes.push(originalFinishMs);
      }
    }

    // Update building busy_until
    if (finishTimes.length > 0) {
      const lastFinish = new Date(Math.max(...finishTimes)).toISOString();
      buildingRepository.updateBusyUntil(buildingId, companyId, lastFinish);
    } else {
      buildingRepository.updateBusyUntil(buildingId, companyId, null);
    }

    eventBus.publishCommitted(txCtx, 'ProductionCancelled', {
      companyId,
      buildingId,
      queueId: launch.id,
      kind: 100,
      amount: launch.researchCost,
      quality: launch.quality
    });
    return {
      success: true,
      message: 'Launch cancelled successfully',
      id: launch.id,
      status: 'CANCELLED',
      refunded: {
        rocketKind: launch.rocketKind,
        quality: launch.quality,
        amount: 1,
        researchPoints: launch.consumeResearch ? launch.researchCost : 0
      }
    };
  }, { immediate: true });
}
