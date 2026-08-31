import type { StartProductionResult } from '../../application/production/start-production.ts';
import type { CancelProductionResult } from '../../application/production/cancel-production.ts';
import type { CollectProductionResult } from '../../application/production/collect-production.ts';
import type { ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { toSimCompaniesBuildingDTO, type SimCompaniesBuildingDTO } from './building-dto.ts';
import { getResourceDef } from '../../game-data/resources.ts';

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
  levelInfo: null;
  newBusy: null;
  resource: {
    kind: number;
    quality: number;
    amount: number;
  };
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
    levelInfo: null,
    newBusy: null,
    resource: {
      kind: result.collectedItem.kind,
      quality: result.collectedItem.quality,
      amount: result.collectedItem.amount
    },
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

export interface SimCompaniesQueueItemDTO {
  id: number;
  kind: number;
  amount: number;
  duration: number;
  started: string;
  finishes: string;
  resource: {
    name: string;
    image: string;
  } | null;
}

export function toSimCompaniesQueueDTO(
  items: ProductionQueueEntity[]
): SimCompaniesQueueItemDTO[] {
  return items.map(item => {
    const res = getResourceDef(item.kind);
    return {
      id: item.id,
      kind: item.kind,
      amount: item.amount,
      duration: item.durationSeconds,
      started: item.startedAt,
      finishes: item.finishesAt,
      resource: res ? {
        name: `Resource #${item.kind}`,
        image: res.image
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
    quality: row.quality,
    amount: row.amount,
    outputAmount: row.amount,
    datetime: row.startedAt
  }));
}
