import type { TransactionContext } from '../db/transaction.ts';

export interface DomainEventMap {
  ProductionStarted: {
    companyId: number;
    buildingId: number;
    queueId: number;
    kind: number;
    amount: number;
    quality: number;
    startedAt: string;
    finishesAt: string;
  };
  ProductionCancelled: {
    companyId: number;
    buildingId: number;
    queueId: number;
    kind: number;
    amount: number;
    quality: number;
  };
  ProductionCollected: {
    companyId: number;
    buildingId: number;
    queueId: number;
    kind: number;
    quality: number;
    amount: number;
    collectedAt: string;
  };
  ProductionRushed: {
    companyId: number;
    buildingId: number;
    queueId: number;
    simboostsCost: number;
  };
  BuildingConstructed: {
    companyId: number;
    buildingId: number;
    kind: string;
    position: string;
    cost: number;
  };
  BuildingUpgraded: {
    companyId: number;
    buildingId: number;
    newSize: number;
    cost: number;
  };
  BuildingDemolished: {
    companyId: number;
    buildingId: number;
    refund: number;
  };
  BuildingRenamed: {
    companyId: number;
    buildingId: number;
    name: string;
  };
  MarketOrderPlaced: {
    companyId: number;
    orderId: number;
    kind: number;
    quality: number;
    quantity: number;
    price: number;
  };

  MarketOrderCancelled: {
    companyId: number;
    orderId: number;
    kind: number;
    quality: number;
    quantity: number;
  };

  MarketTradeCompleted: {
    buyerCompanyId: number;
    sellerCompanyId: number;
    kind: number;
    quality: number;
    amount: number;
    price: number;
  };
  RetailSaleCompleted: {
    companyId: number;
    buildingId: number;
    resourceKind: number;
    quality: number;
    units: number;
    revenue: number;
  };
  RobotsInstalled: {
    companyId: number;
    buildingId: number;
    robotsInstalled: number;
    robotsQuality: number;
    lockedProduct: number;
  };
  RobotsUninstalled: {
    companyId: number;
    buildingId: number;
    returnedRobots: number;
  };
}

export type EventKey = keyof DomainEventMap;
export type EventListener<K extends EventKey> = (payload: DomainEventMap[K]) => void | Promise<void>;

export class EventBus {
  private listeners = new Map<EventKey, Set<EventListener<any>>>();

  subscribe<K extends EventKey>(event: K, listener: EventListener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);

    return () => {
      set?.delete(listener);
    };
  }

  emit<K extends EventKey>(event: K, payload: DomainEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    for (const listener of set) {
      try {
        const result = listener(payload);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error(`[EventBus async listener error for ${String(event)}]:`, err);
          });
        }
      } catch (err) {
        console.error(`[EventBus sync listener error for ${String(event)}]:`, err);
      }
    }
  }

  /**
   * Enqueue a domain event to be emitted only when the specified transaction commits.
   * If the transaction rolls back, this event is never published.
   */
  publishCommitted<K extends EventKey>(
    ctx: TransactionContext,
    event: K,
    payload: DomainEventMap[K]
  ): void {
    ctx.addAfterCommitHook(() => {
      this.emit(event, payload);
    });
  }

  clearListeners(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();
