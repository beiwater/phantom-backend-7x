import type { StartProductionResult } from '../../application/production/start-production.ts';
import type { CancelProductionResult } from '../../application/production/cancel-production.ts';
import type { CollectProductionResult } from '../../application/production/collect-production.ts';
import type { ProductionQueueEntity } from '../../repositories/production-repository.ts';
import type { LevelInfoDTO } from '../../domain/leveling/level-rules.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { db as database } from '../../db/database.ts';
import { toSimCompaniesBuildingDTO } from './building-dto.ts';

export interface SimCompaniesStartProductionDTO {
  message: string;
  money: number;
  building: SimCompaniesBuildingDTO;
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
  return {
    message: 'Production started successfully',
    money: 0,
    building: toSimCompaniesBuildingDTO(result.building),
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
}

export function toSimCompaniesCollectProductionDTO(
  result: CollectProductionResult
): SimCompaniesCollectProductionDTO {
  return {
    success: true,
    money: result.currentMoney,
    moneyUpdate: {
      money: result.currentMoney,
      id: Date.now()
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
  kind: number;
  quality: number;
  amount: number;
  duration: number;
  started: string;
  finishes: string;
  resource: {
    name: string;
    image: string;
    kind: number;
    quality: number;
    unitCost: number;
  } | null;
}

export function toSimCompaniesQueueDTO(
  items: ProductionQueueEntity[]
): SimCompaniesQueueItemDTO[] {
  return items.map(item => {
    const res = getResourceDef(item.kind);
    // P0-02: quality/cost always finite; legacy rows without a persisted
    // cost basis get an on-the-fly fallback from current warehouse data.
    const quality = Math.max(0, Math.floor(finiteOr(item.quality, 0)));
    const unitCost = finiteOr(item.cost, computeFallbackUnitCost(item));
    return {
      id: item.id,
      kind: item.kind,
      quality,
      amount: finiteOr(item.amount, 0),
      duration: finiteOr(item.durationSeconds, 0),
      started: item.startedAt,
      finishes: item.finishesAt,
      resource: res ? {
        name: `Resource #${item.kind}`,
        image: res.image,
        kind: item.kind,
        quality,
        unitCost
      } : null
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
