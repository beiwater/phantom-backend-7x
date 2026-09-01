/**
 * PlaceMarketOrder use case (Issue #105 Phase 3 / Issue #104 Stage 2).
 * Single authoritative implementation of posting a sell order on the
 * exchange. Inventory consumption, transport consumption and order insert
 * happen inside ONE transaction (Issue #68). No fee at posting — the 4%
 * exchange fee is charged from seller proceeds at fill time (Issue #100).
 */
import type { GameContext } from '../../context/game-context.ts';
import type { ResourceTransactionEntity } from '../../repositories/warehouse-repository.ts';
import type { MarketOrderEntity } from '../../repositories/market-repository.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { eventBus } from '../../events/event-bus.ts';
import { ValidationError, ConflictError } from '../../errors/domain-error.ts';
import { validateSellOrderInput, computeTransportNeeded } from '../../domain/market/market-rules.ts';
import { marketRepository } from '../../repositories/market-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { getResourceDef } from '../../game-data/resources.ts';

export interface PlaceMarketOrderInput {
  resourceId?: number;
  kind: number;
  price: number;
  quantity: number;
  quality?: number;
}

/** Compatibility shape consumed by market-routes / the original frontend. */
export interface PlacedSellOrderDTO {
  id: number;
  kind: number;
  quantity: number;
  quality: number;
  price: number;
  datetimeDecayUpdated: string;
  posted: string;
  fees: number;
}

export interface PlaceMarketOrderResult {
  sellOrder: PlacedSellOrderDTO;
  money: number | null;
  resourceTransactions: Array<ResourceTransactionEntity & { dbLetter?: number; delta?: number; amount: number }>;
}

/** Compatibility mapping for the original frontend (kept out of repository). */
function toCompatibilityShape(order: MarketOrderEntity): PlacedSellOrderDTO {
  return {
    id: order.id,
    kind: order.kind,
    quantity: order.quantity,
    quality: order.quality,
    price: order.price,
    datetimeDecayUpdated: order.postedAt,
    posted: order.postedAt,
    fees: order.fees
  };
}

export async function placeMarketOrder(ctx: GameContext, input: PlaceMarketOrderInput): Promise<PlaceMarketOrderResult> {
  const { kind, quantity, price, quality } = validateSellOrderInput(input);

  const resDef = getResourceDef(kind);
  if (!resDef) {
    throw new ValidationError(`Unknown resource kind: ${kind}`);
  }

  const transportNeeded = computeTransportNeeded(resDef.transportation || 0, quantity);

  return runInTransaction(tx => {
    // Snapshot the unit cost basis before consuming (order cancel restores it).
    const item = input.resourceId
      ? warehouseRepository.findById(input.resourceId)
      : warehouseRepository.findByCompanyAndResource(ctx.companyId, kind, quality);
    if (input.resourceId) {
      if (!item || item.companyId !== ctx.companyId || item.kind !== kind || item.quality !== quality) {
        throw new ValidationError('Selected inventory does not match the market order');
      }
    }
    if (!item || item.amount < quantity) {
      throw new ConflictError(`Insufficient inventory: have ${item ? item.amount : 0}, need ${quantity}`);
    }

    const consumed = warehouseRepository.consumeExact(ctx.companyId, kind, quality, quantity);
    if (transportNeeded > 0) {
      try {
        warehouseRepository.consumeExact(ctx.companyId, 13, 0, transportNeeded);
      } catch {
        throw new ConflictError(`Insufficient transport: need ${transportNeeded}`);
      }
    }

    // Issue #100: no fee at posting — fees stays 0 until fills occur.
    const order = marketRepository.insert({
      sellerId: ctx.companyId,
      kind,
      quality,
      quantity,
      price,
      postedAt: new Date().toISOString(),
      costWorkers: item.costWorkers,
      costAdmin: item.costAdmin,
      costMaterial1: item.costMaterial1,
      costMaterial2: item.costMaterial2,
      costMarket: item.costMarket
    });

    tx.addAfterCommitHook(() => {
      eventBus.emit('MarketOrderPlaced', {
        companyId: ctx.companyId,
        orderId: order.id,
        kind,
        quality,
        quantity,
        price
      });
    });

    return {
      sellOrder: toCompatibilityShape(order),
      resourceTransactions: consumed.map(t => ({ ...t, dbLetter: t.kind, delta: -t.amount, amount: -t.amount }))
    } as PlaceMarketOrderResult;
  }, { immediate: true }).then(partial => {
    // Money is a pure post-commit query; companyRepository money read does
    // not mutate and the ledger row was already written inside the tx path
    // only when money moved (it did not here).
    const company = companyRepository.findById(ctx.companyId);
    return {
      sellOrder: partial.sellOrder,
      money: company ? company.money : null,
      resourceTransactions: partial.resourceTransactions
    };
  });
}
