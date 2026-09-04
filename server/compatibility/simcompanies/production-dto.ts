import type { StartProductionResult } from '../../application/production/start-production.ts';
import type { CancelProductionResult } from '../../application/production/cancel-production.ts';
import type { CollectProductionResult } from '../../application/production/collect-production.ts';
import type { ProductionQueueEntity } from '../../repositories/production-repository.ts';
import type { LevelInfoDTO } from '../../domain/leveling/level-rules.ts';
import { getResourceDef, getResourceName } from '../../game-data/resources.ts';
import { db as database } from '../../db/database.ts';
import { toSimCompaniesBuildingDTO } from './building-dto.ts';
import { rocketKindForLaunchRequest } from '../../game/aerospace.ts';
import { virtualClock } from '../../core/virtual-clock.ts';

export interface SimCompaniesStartProductionDTO {
  message: string;
  money: number;
  building: SimCompaniesBuildingDTO;
  queueItem: SimCompaniesQueueItemDTO;
  id: number;
  duration: number;
  startedAt: string;
  finishesAt: string;
  resourceTransactions: Array<{
    kind: number;
    db_letter: number;
    dbLetter: number;
    quality: number;
    amount: number;
    delta?: number;
  }>;
  followerErrors: unknown[];
  simboostsDelta: number;
}

export function toSimCompaniesStartProductionDTO(
  result: StartProductionResult
): SimCompaniesStartProductionDTO {
  const queueItem = toSimCompaniesQueueDTO([result.queueItem])[0];
  return {
    message: result.message ?? 'Production started successfully',
    money: 0,
    building: toSimCompaniesBuildingDTO(result.building),
    queueItem,
    id: queueItem.id,
    duration: queueItem.duration,
    startedAt: queueItem.started,
    finishesAt: queueItem.finishes,
    resourceTransactions: result.resourceTransactions.map(tx => ({
      kind: tx.kind,
      db_letter: tx.kind,
      dbLetter: tx.kind,
      quality: tx.quality,
      amount: tx.amount,
      delta: -tx.amount
    })),
    followerErrors: [],
    simboostsDelta: 0
  };
}


export interface SimCompaniesCancelProductionDTO {
  message: string;
  money: number;
  building: SimCompaniesBuildingDTO;
  followerErrors: unknown[];
  simboostsDelta: number;
}

export function toSimCompaniesCancelProductionDTO(
  result: CancelProductionResult
): SimCompaniesCancelProductionDTO {
  return {
    message: 'Production cancelled successfully',
    money: 0,
    building: toSimCompaniesBuildingDTO(result.building),
    followerErrors: [],
    simboostsDelta: 0
  };
}

export interface SimCompaniesCollectProductionDTO {
  success: boolean;
  money: number;
  moneyUpdate: {
    money: number;
    id?: number;
  };
  achievements: unknown[];
  levelInfo: LevelInfoDTO | null;
  newBusy: null;
  resource: {
    kind: number;
    quality: number;
    amount: number;
  };
  experienceGained: number;
  levelUp: boolean;
  resourceTransactions: Array<{
    kind: number;
    db_letter: number;
    dbLetter: number;
    quality: number;
    delta: number;
    amount: number;
  }>;
  /** Launch outcome message (Issue #170). */
  message?: string;
}

export function toSimCompaniesCollectProductionDTO(
  result: CollectProductionResult
): SimCompaniesCollectProductionDTO {
  // Issue #170: a collected launch produces no resource — the response
  // carries the launch outcome message instead of a resource delta.
  if (result.launch) {
    return {
      success: true,
      money: result.currentMoney,
      moneyUpdate: {
        money: result.currentMoney,
        id: virtualClock.nowMs()
      },
      achievements: [],
      levelInfo: result.levelInfo,
      newBusy: null,
      resource: {
        kind: result.collectedItem.kind,
        quality: 0,
        amount: 0
      },
      message: result.launch.message,
      experienceGained: result.experienceGained,
      levelUp: result.levelUp,
      resourceTransactions: []
    };
  }
  return {
    success: true,
    money: result.currentMoney,
    moneyUpdate: {
      money: result.currentMoney,
      id: virtualClock.nowMs()
    },
    achievements: [],
    // P1-05: the original frontend updates the HUD level/XP bar from this
    // field right after collecting (updateLevelInfo). Must not be null.
    levelInfo: result.levelInfo,
    newBusy: null,
    resource: {
      kind: result.collectedItem.kind,
      quality: Math.max(0, Math.floor(finiteOr(result.collectedItem.quality, 0))),
      amount: finiteOr(result.collectedItem.amount, 0)
    },
    experienceGained: result.experienceGained,
    levelUp: result.levelUp,
    resourceTransactions: [{
      kind: result.collectedItem.kind,
      db_letter: result.collectedItem.kind,
      dbLetter: result.collectedItem.kind,
      quality: result.collectedItem.quality,
      delta: result.collectedItem.amount,
      amount: result.collectedItem.amount
    }]
  };
}

/**
 * P0-02: every numeric field consumed by the original frontend must be a
 * finite number — `undefined`/`null` flow into `unitCost * amount` and render
 * as "$NaN". Missing persisted values fall back to on-the-fly computation
 * from current warehouse/recipe data rather than returning null.
 */
export function finiteOr(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Fallback cost-per-unit for queue rows persisted before the cost basis
 * column existed (P0-02). Computes the weighted input cost from the CURRENT
 * recipe and warehouse cost accounting; never returns null/NaN.
 */
export function computeFallbackUnitCost(item: ProductionQueueEntity): number {
  const def = getResourceDef(item.kind);
  if (!def?.producedFrom || !item.amount || item.amount <= 0) return 0;
  const db = database;
  let totalCost = 0;
  for (const [ingKindStr, ratio] of Object.entries(def.producedFrom)) {
    const ingKind = Number(ingKindStr);
    const need = ratio * item.amount;
    const rows = db.prepare(`
      SELECT amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market
      FROM warehouse WHERE company_id = ? AND kind = ? AND amount > 0
      ORDER BY quality ASC, id ASC
    `).all(item.companyId, ingKind) as Array<{
      amount: number; cost_workers: number; cost_admin: number;
      cost_material1: number; cost_material2: number; cost_market: number;
    }>;
    let remaining = need;
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.amount) || 0, remaining);
      const unitCost = (Number(row.cost_workers) || 0) + (Number(row.cost_admin) || 0) +
        (Number(row.cost_material1) || 0) + (Number(row.cost_material2) || 0) +
        (Number(row.cost_market) || 0);
      totalCost += take * unitCost;
      remaining -= take;
    }
  }
  return item.amount > 0 ? totalCost / item.amount : 0;
}


export interface SimCompaniesQueueItemDTO {
  id: number;
  /** Queue marker used by the legacy persistence model. */
  kind: number;
  /** Direct resource kind consumed by the bundled queue-card component. */
  resourceKind: number;
  quality: number;
  amount: number;
  duration: number;
  started: string;
  finishes: string;
  /** Unit cost used by the production detail view. */
  cost: number;
  resource: {
    name: string;
    image: string;
    kind: number;
    quality: number;
    unitCost: number;
  } | null;
  economyPhase: number;
  economyPhaseStartedAt: string | null;
  economySource: string;
  productionModifier: number;
  productionOutputMultiplier: number;
  /** Rocket quality is only meaningful for aerospace research queue cards. */
  rocketQuality?: number;
}

export function toSimCompaniesQueueDTO(
  items: ProductionQueueEntity[]
): SimCompaniesQueueItemDTO[] {
  return items.map(item => {
    const building = database.prepare('SELECT kind FROM buildings WHERE id = ?').get(item.buildingId) as { kind?: string } | undefined;
    const launchRocketKind = building?.kind === 'l' && item.kind === 100
      ? rocketKindForLaunchRequest(item.kind, Number(item.amount))
      : null;
    const displayKind = launchRocketKind ?? item.kind;
    const res = getResourceDef(displayKind);
    // Keep the persisted queue marker (kind 100 and its research cost) for
    // compatibility; the nested resource is the actual rocket requirement.
    const quality = Math.max(0, Math.floor(finiteOr(item.quality, 0)));
    const unitCost = finiteOr(item.cost, computeFallbackUnitCost(item));
    return {
      id: item.id,
      kind: item.kind,
      resourceKind: item.kind,
      quality,
      amount: finiteOr(item.amount, 0),
      duration: finiteOr(item.durationSeconds, 0),
      started: item.startedAt,
      finishes: item.finishesAt,
      cost: unitCost,
      resource: res ? {
        name: getResourceName(displayKind),
        image: res.image,
        kind: displayKind,
        quality,
        unitCost
      } : null,
      economyPhase: item.economyPhase,
      economyPhaseStartedAt: item.economyPhaseStartedAt,
      economySource: item.economySource,
      productionModifier: item.productionModifier,
      productionOutputMultiplier: item.productionOutputMultiplier,
      ...(launchRocketKind !== null ? { rocketQuality: quality } : {})
    };
  });
}

export interface SimCompaniesProductionHistoryItemDTO {
  id: number;
  kind: number;
  quality: number;
  amount: number;
  outputAmount: number;
  datetime: string;
}

export function toSimCompaniesHistoryDTO(
  items: ProductionQueueEntity[]
): SimCompaniesProductionHistoryItemDTO[] {
  return items.map(row => ({
    id: row.id,
    kind: row.kind,
    quality: Math.max(0, Math.floor(finiteOr(row.quality, 0))),
    amount: finiteOr(row.amount, 0),
    outputAmount: finiteOr(row.amount, 0),
    datetime: row.startedAt
  }));
}
