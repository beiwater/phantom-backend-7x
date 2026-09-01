/**
 * Event → notification bridge (Issue #107 build-out).
 * Subscribes to post-commit domain events and persists player-facing feed
 * entries. Events are emitted from addAfterCommitHook, so failures here
 * cannot corrupt a transaction.
 */
import { eventBus } from '../events/event-bus.ts';
import { gameNotificationsRepository } from '../repositories/game-notifications-repository.ts';

let wired = false;

export function wireGameNotifications(): void {
  if (wired) return;
  wired = true;

  eventBus.subscribe('MarketTradeCompleted', p => {
    const now = new Date().toISOString();
    if (p.buyerCompanyId) {
      gameNotificationsRepository.insert(p.buyerCompanyId, 'market-buy', {
        kind: p.kind,
        amount: p.amount,
        price: p.price
      }, now);
    }
    if (p.sellerCompanyId && p.sellerCompanyId !== p.buyerCompanyId) {
      gameNotificationsRepository.insert(p.sellerCompanyId, 'market-sold', {
        kind: p.kind,
        amount: p.amount,
        price: p.price
      }, now);
    }
  });

  eventBus.subscribe('RetailSaleCompleted', p => {
    if (p.companyId) {
      gameNotificationsRepository.insert(p.companyId, 'retail-sale', {
        resourceKind: p.resourceKind,
        quality: p.quality,
        units: p.units,
        revenue: p.revenue
      }, new Date().toISOString());
    }
  });

  eventBus.subscribe('MarketOrderPlaced', p => {
    if (p.companyId) {
      gameNotificationsRepository.insert(p.companyId, 'market-order-placed', {
        kind: p.kind,
        quantity: p.quantity,
        price: p.price
      }, new Date().toISOString());
    }
  });

  eventBus.subscribe('MarketOrderCancelled', p => {
    if (p.companyId) {
      gameNotificationsRepository.insert(p.companyId, 'market-order-cancelled', {
        orderId: p.orderId
      }, new Date().toISOString());
    }
  });

  eventBus.subscribe('ProductionCollected', p => {
    gameNotificationsRepository.insert(p.companyId, 'production-collected', {
      kind: p.kind,
      quality: p.quality,
      amount: p.amount
    }, new Date().toISOString());
  });

  eventBus.subscribe('BuildingConstructed', p => {
    gameNotificationsRepository.insert(p.companyId, 'building-constructed', {
      buildingId: p.buildingId,
      kind: p.kind
    }, new Date().toISOString());
  });
}
