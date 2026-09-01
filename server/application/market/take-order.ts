/**
 * TakeMarketOrder use case (Issue #105 Phase 3 / Issue #104 Stage 2).
 * Single authoritative implementation of filling resting asks. Order fills,
 * buyer debit, seller credits (minus 4% exchange fee), inventory delivery,
 * cash-ledger reclassification and VWAP trade ledger all happen inside ONE
 * transaction (Issue #68); domain events fire post-commit only.
 */
import type { GameContext } from '../../context/game-context.ts';
import type { MarketOrderEntity } from '../../repositories/market-repository.ts';
import { db } from '../../db/connection.ts';
import { runInTransaction, type TransactionContext } from '../../db/transaction.ts';
import { eventBus } from '../../events/event-bus.ts';
import { ValidationError, NotFoundError } from '../../errors/domain-error.ts';
import {
  validateTakeOrderInput,
  computeExchangeFee,
  isSelfTrade
} from '../../domain/market/market-rules.ts';
import { marketRepository } from '../../repositories/market-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';

export interface TakeMarketOrderInput {
  resource: number;
  quantity: number;
  quality?: number;
  maxPrice?: number | null;
  money?: number;
}

export interface MarketFillRecord {
  kind: number;
  quality: number;
  amount: number;
  price: number;
  fee: number;
  sellerId: number;
}

export interface TakeMarketOrderResult {
  money: number;
  moneyDelta: number;
  amountBought: number;
  resourceTransactions: Array<{
    kind: number;
    db_letter: number;
    dbLetter: number;
    quality: number;
    delta: number;
    amount: number;
  }>;
}

export async function takeMarketOrder(ctx: GameContext, input: TakeMarketOrderInput): Promise<TakeMarketOrderResult> {
  const { resourceKind, quantity, minQuality, maxPrice } = validateTakeOrderInput(input);

  return runInTransaction(async (tx: TransactionContext): Promise<TakeMarketOrderResult> => {
    const buyer = companyRepository.findById(ctx.companyId);
    if (!buyer) {
      throw new NotFoundError('Buyer company not found');
    }

    // P0-08: cash-only flow — when maxPrice is absent, the `money` field (or
    // the whole cash balance) bounds the sweep.
    const priceCap = Number.isFinite(maxPrice)
      ? maxPrice
      : (Number.isFinite(Number(input.money)) && Number(input.money) > 0
        ? Number(input.money)
        : Number.MAX_SAFE_INTEGER);

    const orders = marketRepository.findFillableAsks(resourceKind, priceCap, minQuality);

    let quantityToBuy = quantity;
    let totalCost = 0;
    let totalBought = 0;
    const fills: MarketFillRecord[] = [];

    for (const order of orders) {
      if (quantityToBuy <= 0) break;

      // Issue #85: Self-Trading (Wash Trading) Prevention
      const sellerComp = order.sellerId !== 999900 ? companyRepository.findById(order.sellerId) : null;
      if (isSelfTrade(ctx.companyId, buyer.playerId, order.sellerId, sellerComp?.playerId)) {
        throw new ValidationError('Cannot purchase your own market order');
      }

      const available = order.quantity;
      const takeAmount = Math.min(available, quantityToBuy);
      const cost = takeAmount * order.price;
      if (!Number.isFinite(takeAmount) || !Number.isFinite(cost) || takeAmount <= 0) continue;
      if (buyer.money < totalCost + cost) break;

      const remaining = available - takeAmount;
      if (!marketRepository.applyFill(order.id, takeAmount, remaining)) continue;

      // Issue #100: the 4% exchange fee is deducted from the SELLER's
      // proceeds at fill time; the buyer always pays the full amount × price.
      let fillFee = 0;
      if (order.sellerId !== 999900) {
        fillFee = computeExchangeFee(takeAmount, order.price);
        companyRepository.creditMoney(order.sellerId, cost - fillFee);
        marketRepository.addFees(order.id, fillFee);
      }

      totalCost += cost;
      totalBought += takeAmount;
      quantityToBuy -= takeAmount;
      fills.push({
        kind: resourceKind,
        quality: order.quality,
        amount: takeAmount,
        price: order.price,
        fee: fillFee,
        sellerId: order.sellerId
      });
    }

    if (totalBought <= 0) {
      throw new ValidationError('No available market orders match your criteria or insufficient funds');
    }

    const newMoney = companyRepository.debitMoney(ctx.companyId, totalCost);

    // P0-08: reclassify the buyer's generic 'g' ledger row (written by the
    // money debit path) as a MARKET purchase 'm' so the accounting page
    // reports it correctly.
    recordMarketPurchaseLedger(ctx.companyId, totalCost, totalBought, resourceKind);

    for (const fill of fills) {
      warehouseRepository.addResource(ctx.companyId, fill.kind, fill.quality, fill.amount, { market: fill.price });
    }

    // Issue #100: record every fill in the trade ledger backing the daily
    // VWAP reference prices.
    const tradedAt = new Date().toISOString();
    recordMarketFills(fills, ctx.companyId, tradedAt);

    tx.addAfterCommitHook(() => {
      for (const fill of fills) {
        eventBus.emit('MarketTradeCompleted', {
          buyerCompanyId: ctx.companyId,
          sellerCompanyId: fill.sellerId,
          kind: fill.kind,
          quality: fill.quality,
          amount: fill.amount,
          price: fill.price
        });
      }
    });

    return {
      money: newMoney,
      moneyDelta: -totalCost,
      amountBought: totalBought,
      resourceTransactions: fills.map(t => ({
        kind: t.kind,
        db_letter: t.kind,
        dbLetter: t.kind,
        quality: t.quality,
        delta: t.amount,
        amount: t.amount
      }))
    };
  }, { immediate: true });
}

// --- Transaction-scoped SQL helpers (market_trades + cash ledger) ----------
// These belong to the market aggregate's write model; the repository owns
// them once the trade ledger gains its own repository (follow-up slice).

function recordMarketPurchaseLedger(companyId: number, totalCost: number, totalBought: number, resourceKind: number): void {
  db.prepare(`
    UPDATE cash_ledger
    SET category = 'm', description = ?, description_key = ?
    WHERE id = (SELECT MAX(id) FROM cash_ledger WHERE company_id = ? AND category = 'g' AND amount = ?)
  `).run(
    `Market purchase of ${totalBought} units of resource #${resourceKind}`,
    `market-${resourceKind}`,
    companyId,
    -totalCost
  );
}

function recordMarketFills(
  fills: MarketFillRecord[],
  buyerId: number,
  tradedAt: string
): void {
  const stmt = db.prepare(`
    INSERT INTO market_trades (kind, quality, price, amount, fee, buyer_id, seller_id, trade_date, traded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const fill of fills) {
    stmt.run(
      fill.kind,
      fill.quality,
      fill.price,
      fill.amount,
      fill.fee,
      buyerId,
      fill.sellerId,
      tradedAt.slice(0, 10),
      tradedAt
    );
  }
}

// Keep the repository entity type exported for downstream consumers of the
// market slice's write model.
export type { MarketOrderEntity };
