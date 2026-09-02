/**
 * Market buy orders (bid side) use cases (Issue #109 build-out).
 * All SQL lives in market-repository (architecture gate: application layer
 * is raw-SQL free).
 *
 * Semantics:
 * - place: money escrowed at placement (single transaction, ledger row);
 *   fails if insufficient money
 * - cancel: refund remaining escrow
 * - sell-to-bid: sweeps highest-price bids first (price-time), self-trade
 *   prevention identical to asks, 4% exchange fee, goods delivered to the
 *   bidder, market_trades rows + per-fill post-commit events.
 */
import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction, type TransactionContext } from '../../db/transaction.ts';
import { eventBus } from '../../events/event-bus.ts';
import { ValidationError, ConflictError, NotFoundError, SelfTradeProhibitedError } from '../../errors/domain-error.ts';
import { marketTradeRepository } from '../../repositories/market-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { recordCashLedger } from '../../game/cash-ledger.ts';

const EXCHANGE_FEE_RATE = 0.04;

export interface PlaceBuyOrderInput {
  kind: number;
  price: number;
  quantity: number;
  quality?: number;
}

export interface PlacedBuyOrderDTO {
  id: number;
  kind: number;
  quantity: number;
  quality: number;
  price: number;
  posted: string;
  money: number;
}

export async function placeBuyOrder(ctx: GameContext, input: PlaceBuyOrderInput): Promise<PlacedBuyOrderDTO> {
  const kind = Number(input.kind);
  const price = Number(input.price);
  const quantity = Number(input.quantity);
  const quality = Number(input.quality ?? 0);
  if (!Number.isSafeInteger(kind) || kind <= 0) throw new ValidationError(`Unknown resource kind: ${input.kind}`);
  if (!getResourceDef(kind)) throw new ValidationError(`Unknown resource kind: ${kind}`);
  if (!Number.isFinite(price) || price <= 0) throw new ValidationError('Invalid price');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError('Invalid quantity');
  if (!Number.isInteger(quality) || quality < 0 || quality > 12) throw new ValidationError('Invalid quality');

  return runInTransaction((tx: TransactionContext): PlacedBuyOrderDTO => {
    const buyer = companyRepository.findById(ctx.companyId);
    if (!buyer) throw new NotFoundError('Buyer company not found');
    const escrow = Math.round(price * quantity * 100) / 100;
    if (buyer.money < escrow) {
      throw new ConflictError(`Insufficient money: need ${escrow}, have ${buyer.money}`);
    }

    companyRepository.debitMoney(ctx.companyId, escrow);
    recordCashLedger({
      companyId: ctx.companyId,
      amount: -escrow,
      category: 'm',
      description: `Buy order escrow: ${quantity} units of resource #${kind}`,
      descriptionKey: `market-buy-${kind}`
    });

    const now = new Date().toISOString();
    const orderId = marketTradeRepository.insertBuyOrder(ctx.companyId, kind, quality, quantity, price, now);

    tx.addAfterCommitHook(() => {
      eventBus.emit('MarketOrderPlaced', {
        companyId: ctx.companyId,
        orderId,
        kind,
        quality,
        quantity,
        price
      });
    });

    const company = companyRepository.findById(ctx.companyId);
    return {
      id: orderId,
      kind,
      quantity,
      quality,
      price,
      posted: now,
      money: company ? company.money : buyer.money - escrow
    };
  }, { immediate: true });
}

export async function cancelBuyOrder(ctx: GameContext, orderId: number): Promise<{ money: number; moneyDelta: number }> {
  return runInTransaction((tx: TransactionContext): { money: number; moneyDelta: number } => {
    const order = marketTradeRepository.findActiveBuyOrder(orderId);
    if (!order || order.buyerId !== ctx.companyId) {
      throw new NotFoundError('Buy order not found');
    }
    const refund = Math.round(order.price * order.quantity * 100) / 100;
    marketTradeRepository.cancelBuyOrderRow(orderId);
    companyRepository.creditMoney(ctx.companyId, refund);
    recordCashLedger({
      companyId: ctx.companyId,
      amount: refund,
      category: 'm',
      description: `Buy order cancelled: refund of resource #${order.kind} bid`,
      descriptionKey: `market-buy-cancel-${order.kind}`
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
    return { money: company ? company.money : 0, moneyDelta: refund };
  }, { immediate: true });
}

export interface SellToBidInput {
  resource: number;
  quality?: number;
  quantity: number;
  minPrice?: number | null;
  resourceId?: number;
}

export interface SellToBidResult {
  money: number;
  moneyDelta: number;
  amountSold: number;
  filledBids: Array<{ orderId: number; amount: number; price: number }>;
}

/** Sell inventory into standing buy orders (highest price first, price-time). */
export async function sellToBids(ctx: GameContext, input: SellToBidInput): Promise<SellToBidResult> {
  const kind = Number(input.resource);
  const quality = Number(input.quality ?? 0);
  const quantity = Number(input.quantity);
  const minPrice = Number.isFinite(Number(input.minPrice)) && Number(input.minPrice) > 0 ? Number(input.minPrice) : 0;
  if (!getResourceDef(kind)) throw new ValidationError(`Unknown resource kind: ${kind}`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError('Invalid quantity');

  return runInTransaction(async (tx: TransactionContext): Promise<SellToBidResult> => {
    const seller = companyRepository.findById(ctx.companyId);
    if (!seller) throw new NotFoundError('Seller company not found');

    const item = input.resourceId
      ? warehouseRepository.findById(input.resourceId)
      : warehouseRepository.findByCompanyAndResource(ctx.companyId, kind, quality);
    if (!item || item.companyId !== ctx.companyId || item.amount < quantity) {
      throw new ConflictError(`Insufficient inventory: have ${item ? item.amount : 0}, need ${quantity}`);
    }

    const bids = marketTradeRepository.listOpenBids(kind, quality, minPrice, ctx.companyId);

    let remaining = quantity;
    let gross = 0;
    let totalFee = 0;
    let amountSold = 0;
    const filledBids: Array<{ orderId: number; amount: number; price: number }> = [];

    for (const bid of bids) {
      if (remaining <= 0) break;
      const buyerComp = companyRepository.findById(bid.buyerId);
      if (buyerComp && buyerComp.playerId !== null && buyerComp.playerId === seller.playerId) {
        throw new SelfTradeProhibitedError();
      }

      const takeAmount = Math.min(bid.quantity, remaining);
      const proceeds = takeAmount * bid.price;
      const fee = Math.round(proceeds * EXCHANGE_FEE_RATE * 100) / 100;

      marketTradeRepository.closeOrReduceBuyOrder(bid.id, bid.quantity - takeAmount);

      // Deliver goods to the bidder (default warehouse bucket).
      warehouseRepository.addResource(bid.buyerId, kind, quality, takeAmount, { market: bid.price });

      // Escrow was taken at placement; pay it to the seller minus the fee.
      companyRepository.creditMoney(ctx.companyId, Math.round((proceeds - fee) * 100) / 100);
      recordCashLedger({
        companyId: ctx.companyId,
        amount: Math.round((proceeds - fee) * 100) / 100,
        category: 'm',
        description: `Sold ${takeAmount} units of resource #${kind} to bid #${bid.id}`,
        descriptionKey: `market-sell-to-bid-${kind}`
      });

      const tradedAt = new Date().toISOString();
      marketTradeRepository.recordFill({
        kind,
        quality,
        price: bid.price,
        amount: takeAmount,
        fee,
        buyerId: bid.buyerId,
        sellerId: ctx.companyId,
        tradedAt
      });

      tx.addAfterCommitHook(() => {
        eventBus.emit('MarketTradeCompleted', {
          buyerCompanyId: bid.buyerId,
          sellerCompanyId: ctx.companyId,
          kind,
          amount: takeAmount,
          price: bid.price,
          fee
        });
      });

      filledBids.push({ orderId: bid.id, amount: takeAmount, price: bid.price });
      gross += proceeds;
      totalFee += fee;
      amountSold += takeAmount;
      remaining -= takeAmount;
    }

    if (amountSold <= 0) {
      throw new ConflictError('No matching buy orders');
    }

    // Debit the seller's inventory for what actually sold (partial fills leave the rest).
    warehouseRepository.consumeExact(ctx.companyId, kind, quality, amountSold);

    const company = companyRepository.findById(ctx.companyId);
    return {
      money: company ? company.money : 0,
      moneyDelta: Math.round((gross - totalFee) * 100) / 100,
      amountSold,
      filledBids
    };
  }, { immediate: true });
}

/** Own standing buy orders. */
export function listOwnBuyOrders(companyId: number): PlacedBuyOrderDTO[] {
  return marketTradeRepository.listOwnBuyOrders(companyId).map(r => ({
    id: r.id,
    kind: r.kind,
    quantity: r.quantity,
    quality: r.quality,
    price: r.price,
    posted: r.postedAt,
    money: 0
  }));
}

/** Active bid book for a resource (other companies' buy orders). */
export function listBidBook(kind: number, quality: number, excludeCompanyId?: number | null): PlacedBuyOrderDTO[] {
  return marketTradeRepository.listBidBook(kind, quality, excludeCompanyId ?? null).map(r => ({
    id: r.id,
    kind: r.kind,
    quantity: r.quantity,
    quality: r.quality,
    price: r.price,
    posted: r.postedAt,
    money: 0
  }));
}
