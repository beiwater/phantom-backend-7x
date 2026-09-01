/**
 * CancelMarketOrder use case (Issue #105 Phase 3 / Issue #104 Stage 2).
 * Single authoritative implementation of cancelling a resting sell order.
 * Deactivation and inventory restoration (at the original cost basis) happen
 * inside ONE transaction (Issue #68). No fee on cancellation (Issue #100).
 */
import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction, type TransactionContext } from '../../db/transaction.ts';
import { eventBus } from '../../events/event-bus.ts';
import { ValidationError, NotFoundError } from '../../errors/domain-error.ts';
import { marketRepository } from '../../repositories/market-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';

export interface CancelMarketOrderInput {
  orderId: number;
}

export interface CancelMarketOrderResult {
  sellOrder: {
    id: number;
    kind: number;
    quantity: number;
    quality: number;
    price: number;
    datetimeDecayUpdated: string;
    posted: string;
    fees: number;
  };
  money: number | null;
  warehouseAmount: number;
}

export async function cancelMarketOrder(ctx: GameContext, input: CancelMarketOrderInput): Promise<CancelMarketOrderResult> {
  const orderId = Number(input.orderId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new ValidationError(`Invalid market order id: ${input.orderId}`);
  }

  return runInTransaction(async (tx: TransactionContext): Promise<CancelMarketOrderResult> => {
    const order = marketRepository.findOwnedActiveOrder(orderId, ctx.companyId);
    if (!order) {
      throw new ValidationError('Market order not found or no longer active');
    }

    // Mark inactive before refunding; the transaction rolls back if the
    // refund fails.
    if (!marketRepository.deactivateOwnedActiveOrder(orderId, ctx.companyId)) {
      throw new ValidationError('Market order is no longer active');
    }

    warehouseRepository.addResource(ctx.companyId, order.kind, order.quality, order.quantity, {
      workers: order.costWorkers,
      admin: order.costAdmin,
      material1: order.costMaterial1,
      material2: order.costMaterial2,
      market: order.costMarket || 1.0
    });

    tx.addAfterCommitHook(() => {
      eventBus.emit('MarketOrderCancelled', {
        companyId: ctx.companyId,
        orderId,
        kind: order.kind,
        quality: order.quality,
        quantity: order.quantity
      });
    });

    const company = companyRepository.findById(ctx.companyId);
    const warehouse = warehouseRepository.findByCompanyAndResource(ctx.companyId, order.kind, order.quality);

    return {
      sellOrder: {
        id: order.id,
        kind: order.kind,
        quantity: order.quantity,
        quality: order.quality,
        price: order.price,
        datetimeDecayUpdated: order.postedAt,
        posted: order.postedAt,
        fees: order.fees
      },
      money: company ? company.money : null,
      warehouseAmount: warehouse ? warehouse.amount : 0
    };
  }, { immediate: true });
}
