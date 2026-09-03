import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { virtualClock } from '../core/virtual-clock.ts';

/**
 * Persisted per-company SimBoost settings.
 *
 * Backs the Headquarters > SimBoosts screen (P1-02) and the
 * PA "fair" money-for-SimBoosts exchange (P0-04). Values live in a
 * dedicated table so they survive refreshes; GET endpoints only read,
 * writes happen inside the caller's transaction.
 */

export interface CompanyBoostSettings {
  productionModifier: number;
  salesModifier: number;
  exchangedToday: number;
  exchangeDate: string;
}

/** SimBoosts required per 1% point moved by the realign slider. */
const REALIGN_COST_CHEAP = 75;
const REALIGN_COST_EXPENSIVE = 100;
export { REALIGN_COST_CHEAP, REALIGN_COST_EXPENSIVE };

/** Cash per SimBoost exchanged and the per-day cap, matching the official realm rules. */
export const EXCHANGE_CASH_PER_SIMBOOST = 250;
export const EXCHANGE_DAILY_LIMIT = 10000;

/**
 * UTC calendar date used as the exchange-limit bucket key. The official
 * server resets its exchangedToday counter on UTC midnight.
 */
function exchangeDateBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function ensureRow(companyId: number): void {
  db.prepare(`
    INSERT INTO company_boost_settings (company_id, production_modifier, sales_modifier, exchanged_today, exchange_date)
    VALUES (?, 0, 0, 0, '')
    ON CONFLICT(company_id) DO NOTHING
  `).run(companyId);
}

/** Read persisted settings; missing rows read as neutral defaults without writing (GET must not mutate). */
export function getCompanyBoostSettings(companyId: number): CompanyBoostSettings {
  const row = db.prepare(
    'SELECT production_modifier, sales_modifier, exchanged_today, exchange_date FROM company_boost_settings WHERE company_id = ?'
  ).get(companyId) as
    | { production_modifier: number; sales_modifier: number; exchanged_today: number; exchange_date: string }
    | undefined;

  if (!row) {
    return { productionModifier: 0, salesModifier: 0, exchangedToday: 0, exchangeDate: '' };
  }
  return {
    productionModifier: Number(row.production_modifier) || 0,
    salesModifier: Number(row.sales_modifier) || 0,
    exchangedToday: Number(row.exchanged_today) || 0,
    exchangeDate: row.exchange_date || ''
  };
}

/** Exchanged-cash counter for the current UTC day (0 when the stored bucket is stale). */
export function getExchangedToday(companyId: number, now: Date = virtualClock.now()): number {
  const settings = getCompanyBoostSettings(companyId);
  if (settings.exchangeDate !== exchangeDateBucket(now)) {
    return 0;
  }
  return settings.exchangedToday;
}

/**
 * Persist the production/sales bonus realignment (P1-02). The caller has
 * already debited SimBoosts inside the same transaction when cost > 0.
 */
export function saveCompanyBoostModifiers(
  companyId: number,
  productionModifier: number,
  salesModifier: number
): CompanyBoostSettings {
  ensureRow(companyId);
  db.prepare(`
    UPDATE company_boost_settings
    SET production_modifier = ?, sales_modifier = ?
    WHERE company_id = ?
  `).run(Math.round(productionModifier), Math.round(salesModifier), companyId);
  return getCompanyBoostSettings(companyId);
}

/**
 * Count `cash` dollars against the daily exchange limit inside the caller's
 * transaction. Stale buckets are reset atomically here.
 */
export function recordExchange(companyId: number, cash: number, now: Date = virtualClock.now()): number {
  ensureRow(companyId);
  const today = exchangeDateBucket(now);
  const result = db.prepare(`
    UPDATE company_boost_settings
    SET exchanged_today = CASE WHEN exchange_date = ? THEN exchanged_today + ? ELSE ? END,
        exchange_date = ?
    WHERE company_id = ?
  `).run(today, cash, cash, today, companyId);
  if (result.changes !== 1) {
    throw new Error('Failed to record exchange usage');
  }
  return getExchangedToday(companyId, now);
}

/** Daily cap on completed boost-package purchases per company (C-5 money-faucet guard). */
export const DAILY_PURCHASE_LIMIT = 20;

/** Purchases made today (UTC bucket); 0 when the stored bucket is stale. */
export function getPurchasesToday(companyId: number, now: Date = virtualClock.now()): number {
  const row = db.prepare(
    'SELECT purchases_today, purchase_date FROM company_boost_settings WHERE company_id = ?'
  ).get(companyId) as { purchases_today: number; purchase_date: string } | undefined;
  if (!row || row.purchase_date !== exchangeDateBucket(now)) {
    return 0;
  }
  return Number(row.purchases_today) || 0;
}

/**
 * Count one package purchase against the daily limit inside the caller's
 * transaction. Stale buckets are reset atomically here.
 */
export function recordPurchase(companyId: number, now: Date = virtualClock.now()): number {
  ensureRow(companyId);
  const today = exchangeDateBucket(now);
  const result = db.prepare(`
    UPDATE company_boost_settings
    SET purchases_today = CASE WHEN purchase_date = ? THEN purchases_today + 1 ELSE 1 END,
        purchase_date = ?
    WHERE company_id = ?
  `).run(today, today, companyId);
  if (result.changes !== 1) {
    throw new Error('Failed to record purchase usage');
  }
  return getPurchasesToday(companyId, now);
}

/**
 * SimBoost cost to move the realign slider by `move` points, mirroring the
 * official client: moving into negative territory costs 100/point, else 75/point.
 */
export function realignCost(productionModifier: number, salesModifier: number, move: number): number {
  let cost = 0;
  let prod = productionModifier;
  let sales = salesModifier;
  let remaining = move;
  while (remaining !== 0) {
    if (remaining < 0) {
      sales--;
      cost += sales < 0 ? REALIGN_COST_EXPENSIVE : REALIGN_COST_CHEAP;
      remaining++;
    } else {
      prod--;
      cost += prod < 0 ? REALIGN_COST_EXPENSIVE : REALIGN_COST_CHEAP;
      remaining--;
    }
  }
  return cost;
}

/**
 * Apply a realignment atomically: debit SimBoosts, persist both modifiers.
 * Throws on insufficient SimBoosts (rolled back).
 */
export function realignCompanyBonus(
  companyId: number,
  move: number,
  debitSimBoosts: (companyId: number, cost: number) => number
): { productionModifier: number; salesModifier: number; cost: number } {
  return runInTransaction(() => {
    const current = getCompanyBoostSettings(companyId);
    const cost = realignCost(current.productionModifier, current.salesModifier, move);
    if (cost > 0) {
      debitSimBoosts(companyId, cost);
    }
    const saved = saveCompanyBoostModifiers(
      companyId,
      current.productionModifier + move,
      current.salesModifier - move
    );
    return {
      productionModifier: saved.productionModifier,
      salesModifier: saved.salesModifier,
      cost
    };
  }, { immediate: true });
}

export interface FairExchangeInput {
  companyId: number;
  cash: number;
  getCompanyMoney: (companyId: number) => { money: number; simboosts: number } | null;
  debitMoney: (companyId: number, cash: number) => number;
  creditSimBoosts: (companyId: number, simBoosts: number) => number;
  now?: Date;
}

export interface FairExchangeResult {
  done: true;
  money: number;
  simBoosts: number;
  cashExchanged: number;
  simBoostsReceived: number;
  exchangedToday: number;
}

/**
 * P0-04 PA "fair" exchange: trade company cash for SimBoosts at the official
 * rate (250 cash per SimBoost, kh constant in the client), respecting the
 * realm-phase daily exchange limit. Runs atomically and is idempotent against
 * double clicks because the debit + credit + counter bump commit as one unit;
 * a rejected request mutates nothing.
 */
export function exchangeMoneyForSimboosts(input: FairExchangeInput): FairExchangeResult {
  const { companyId, cash, getCompanyMoney, debitMoney, creditSimBoosts } = input;
  const now = input.now ?? virtualClock.now();

  if (!Number.isFinite(cash) || cash <= 0) {
    throw new Error('Exchange amount must be a positive number');
  }

  return runInTransaction(() => {
    const company = getCompanyMoney(companyId);
    if (!company) {
      throw new Error('Company not found');
    }

    const simBoostsToReceive = Math.floor(cash / EXCHANGE_CASH_PER_SIMBOOST);
    if (simBoostsToReceive < 1) {
      throw new Error(`Minimum exchange is ${EXCHANGE_CASH_PER_SIMBOOST} cash`);
    }

    const alreadyExchanged = getExchangedToday(companyId, now);
    if (alreadyExchanged + cash > EXCHANGE_DAILY_LIMIT) {
      throw new Error('You cannot exchange that many simboosts today');
    }

    if (company.money < cash) {
      throw new Error('Insufficient cash for this exchange');
    }

    const newMoney = debitMoney(companyId, cash);
    const newSimBoosts = creditSimBoosts(companyId, simBoostsToReceive);
    const exchangedToday = recordExchange(companyId, cash, now);

    return {
      done: true as const,
      money: newMoney,
      simBoosts: newSimBoosts,
      cashExchanged: cash,
      simBoostsReceived: simBoostsToReceive,
      exchangedToday
    };
  }, { immediate: true });
}
