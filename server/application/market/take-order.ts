/**
 * TakeMarketOrder use case (Issue #105 Phase 3 / Issue #104 Stage 2).
 * Single authoritative implementation of filling resting asks. Order fills,
 * buyer debit, seller credits (minus 4% exchange fee), inventory delivery,
 * cash-ledger reclassification and VWAP trade ledger all happen inside ONE
 * transaction (Issue #68); domain events fire post-commit only.
 */
import type { GameContext } from '../../context/game-context.ts';
import { db } from '../../db/connection.ts';
import { runInTransaction, type TransactionContext } from '../../db/transaction.ts';
import { eventBus } from '../../events/event-bus.ts';
import { validateTakeOrderInput, computeExchangeFee, isSelfTrade } from '../../domain/market/market-rules.ts';
import { ValidationError, NotFoundError, SelfTradeProhibitedError } from '../../errors/domain-error.ts';
import { marketRepository, marketTradeRepository } from '../../repositories/market-repository.ts';
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
        throw new SelfTradeProhibitedError();
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

    // P0-08: the market slice writes its own authoritative MARKET ledger row
    // (the repository debit is ledger-silent by design); the legacy path
    // reclassified a generic 'g' row, the use case records 'm' directly.
    db.prepare(`
      INSERT INTO cash_ledger (company_id, amount, category, description, description_key, details, created_at)
      VALUES (?, ?, 'm', ?, ?, '', ?)
    `).run(
      ctx.companyId,
      -totalCost,
      `Market purchase of ${totalBought} units of resource #${resourceKind}`,
      `market-${resourceKind}`,
      new Date().toISOString().replace('Z', '+00:00')
    );

    for (const fill of fills) {
      warehouseRepository.addResource(ctx.companyId, fill.kind, fill.quality, fill.amount, { market: fill.price });
    }

    // Issue #100: record every fill in the trade ledger backing the daily
    // VWAP reference prices.
    const tradedAt = new Date().toISOString();
    for (const fill of fills) {
      marketTradeRepository.recordFill({
        kind: fill.kind,
        quality: fill.quality,
        price: fill.price,
        amount: fill.amount,
        fee: fill.fee,
        buyerId: ctx.companyId,
        sellerId: fill.sellerId,
        tradedAt
      });
    }

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
