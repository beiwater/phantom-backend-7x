/**
 * Market buy orders (Issue #109 build-out).
 *
 * A buy order (bid) posts money-escrowed demand: the poster's cash is
 * debited at placement and refunded on cancel; any player whose sell order
 * matches the bid can "sell to bid". Implementation reuses market_orders
 * with a side column ('buy' | 'sell'); sell rows keep side='sell'.
 *
 * Semantics kept deliberately simple and matching the official UX:
 * - place: escrow quantity*price (no fee); fails if insufficient money
 * - cancel: refund remaining escrow
 * - take (sell-to-bid): sweeps highest-price bids first (price-time), only
 *   bids of OTHER companies (self-trade prevention identical to asks),
 *   credits the seller minus the same 4% exchange fee, and fulfils bids
 *   fully or partially.
 */
import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction, type TransactionContext } from '../../db/transaction.ts';
import { eventBus } from '../../events/event-bus.ts';
import { ValidationError, ConflictError, NotFoundError, SelfTradeProhibitedError } from '../../errors/domain-error.ts';
import { marketRepository } from '../../repositories/market-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { db } from '../../db/connection.ts';
import { recordCashLedger } from '../../game/cash-ledger.ts';

const EXCHANGE_FEE_RATE = 0.04;

function isSelfTrade(buyerCompanyId: number, buyerPlayerId: number | undefined, sellerCompanyId: number, sellerPlayerId: number | undefined): boolean {
  return buyerCompanyId === sellerCompanyId || (buyerPlayerId !== undefined && buyerPlayerId !== null && buyerPlayerId === sellerPlayerId);
}

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
    const res = db.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active, is_npc, is_buy)
      VALUES (?, ?, ?, ?, ?, 0, ?, 1, 0, 1)
    `).run(ctx.companyId, kind, quality, quantity, price, now);
    const orderId = Number(res.lastInsertRowid);

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
    const order = db.prepare('SELECT * FROM market_orders WHERE id = ? AND active = 1 AND is_buy = 1')
      .get(orderId) as { id: number; seller_id: number; kind: number; quality: number; quantity: number; price: number } | undefined;
    if (!order || Number(order.seller_id) !== ctx.companyId) {
      throw new NotFoundError('Buy order not found');
    }
    const refund = Math.round(Number(order.price) * Number(order.quantity) * 100) / 100;
    db.prepare('UPDATE market_orders SET active = 0 WHERE id = ?').run(orderId);
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
        kind: Number(order.kind),
        quality: Number(order.quality),
        quantity: Number(order.quantity)
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

    // Standing buy orders for this resource/quality, highest price first.
    // seller_id on a buy row is the BUYER (poster). Exclude own bids.
    const bids = db.prepare(`
      SELECT id, seller_id AS buyer_id, quantity, price
      FROM market_orders
      WHERE active = 1 AND is_buy = 1 AND kind = ? AND quality = ? AND price >= ?
        AND seller_id != ?
      ORDER BY price DESC, id ASC
    `).all(kind, quality, minPrice, ctx.companyId) as Array<{
      id: number;
      buyer_id: number;
      quantity: number;
      price: number;
    }>;

    let remaining = quantity;
    let gross = 0;
    let totalFee = 0;
    let amountSold = 0;
    const filledBids: Array<{ orderId: number; amount: number; price: number }> = [];

    for (const bid of bids) {
      if (remaining <= 0) break;
      const buyerComp = companyRepository.findById(Number(bid.buyer_id));
      if (isSelfTrade(ctx.companyId, seller.playerId, Number(bid.buyer_id), buyerComp?.playerId)) {
        throw new SelfTradeProhibitedError();
      }
      const takeAmount = Math.min(Number(bid.quantity), remaining);
      const proceeds = takeAmount * Number(bid.price);
      const fee = Math.round(proceeds * EXCHANGE_FEE_RATE * 100) / 100;

      // Reduce or close the bid.
      const left = Number(bid.quantity) - takeAmount;
      if (left > 0) {
        db.prepare('UPDATE market_orders SET quantity = ? WHERE id = ?').run(left, bid.id);
      } else {
        db.prepare('UPDATE market_orders SET active = 0, quantity = 0 WHERE id = ?').run(bid.id);
      }

      // Deliver goods to the bidder (default warehouse bucket, cost basis 0).
      warehouseRepository.addResource(Number(bid.buyer_id), kind, quality, takeAmount, { market: Number(bid.price) });

      // Escrow was already taken at placement; pay the bidder's escrow to the seller.
      companyRepository.creditMoney(ctx.companyId, proceeds - fee);
      recordCashLedger({
        companyId: ctx.companyId,
        amount: Math.round((proceeds - fee) * 100) / 100,
        category: 'm',
        description: `Sold ${takeAmount} units of resource #${kind} to bid #${bid.id}`,
        descriptionKey: `market-sell-to-bid-${kind}`
      });

      const tradedAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO market_trades (kind, quality, price, amount, fee, buyer_id, seller_id, trade_date, traded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(kind, quality, Number(bid.price), takeAmount, fee, Number(bid.buyer_id), ctx.companyId,
        tradedAt.slice(0, 10), tradedAt);

      tx.addAfterCommitHook(() => {
        eventBus.emit('MarketTradeCompleted', {
          buyerCompanyId: Number(bid.buyer_id),
          sellerCompanyId: ctx.companyId,
          kind,
          amount: takeAmount,
          price: Number(bid.price),
          fee
        });
      });

      filledBids.push({ orderId: bid.id, amount: takeAmount, price: Number(bid.price) });
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
  const rows = db.prepare(`
    SELECT id, kind, quality, quantity, price, posted_at FROM market_orders
    WHERE seller_id = ? AND active = 1 AND is_buy = 1
    ORDER BY id DESC
  `).all(companyId) as Array<{ id: number; kind: number; quality: number; quantity: number; price: number; posted_at: string }>;
  return rows.map(r => ({
    id: Number(r.id),
    kind: Number(r.kind),
    quantity: Number(r.quantity),
    quality: Number(r.quality),
    price: Number(r.price),
    posted: r.posted_at,
    money: 0
  }));
}

/** Active bid book for a resource (other companies' buy orders). */
export function listBidBook(kind: number, quality: number, excludeCompanyId?: number | null): PlacedBuyOrderDTO[] {
  const rows = db.prepare(`
    SELECT id, kind, quality, quantity, price, posted_at FROM market_orders
    WHERE active = 1 AND is_buy = 1 AND kind = ? AND quality = ?
      AND (? IS NULL OR seller_id != ?)
    ORDER BY price DESC, id ASC
    LIMIT 200
  `).all(kind, quality, excludeCompanyId ?? null, excludeCompanyId ?? null) as Array<{
    id: number;
    kind: number;
    quality: number;
    quantity: number;
    price: number;
    posted_at: string;
  }>;
  return rows.map(r => ({
    id: Number(r.id),
    kind: Number(r.kind),
    quantity: Number(r.quantity),
    quality: Number(r.quality),
    price: Number(r.price),
    posted: r.posted_at,
    money: 0
  }));
}
