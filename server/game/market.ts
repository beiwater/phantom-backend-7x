import { db } from '../db/database.ts';
import { getResourceDef, CONSTANTS_RESOURCES } from './constants.ts';
import { consumeResourceExact, consumeResourceExactWithTransactions, addResource, getWarehouseItemById, getWarehouseItemExact } from './warehouse.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';
import { DomainError } from '../errors/domain-error.ts';

export interface MarketOrderRow {
  id: number;
  seller_id: number;
  kind: number;
  quality: number;
  quantity: number;
  price: number;
  fees: number;
  posted_at: string;
  active: number;
  cost_workers?: number;
  cost_admin?: number;
  cost_material1?: number;
  cost_material2?: number;
  cost_market?: number;
}

export function formatMarketOrder(o: MarketOrderRow) {
  const seller = getCompanyById(o.seller_id) || {
    company_id: o.seller_id,
    name: o.seller_id === 999900 ? 'Market Supplier' : 'Market Trader',
    realm_id: 0,
    logo: ''
  };

  return {
    id: o.id,
    kind: o.kind,
    quantity: o.quantity,
    quality: o.quality,
    price: o.price,
    datetimeDecayUpdated: o.posted_at,
    seller: {
      id: seller.company_id,
      company: seller.name,
      realmId: seller.realm_id ?? 0,
      logo: seller.logo || '',
      certificates: 0,
      contest_wins: 0,
      npc: o.seller_id === 999900,
      courseId: null,
      ip: 'private'
    },
    posted: o.posted_at,
    fees: o.fees
  };
}

export function getMarketTicker(realmId: number) {
  const tickerList: Array<{ kind: number; image: string; price: number; is_up: boolean; realmId: number }> = [];

  for (const [kindStr, def] of Object.entries(CONSTANTS_RESOURCES)) {
    const kind = Number(kindStr);
    if (def.isExchangeTradable === false) continue;

    const lowest = db.prepare(`
      SELECT MIN(m.price) as minPrice FROM market_orders m
      LEFT JOIN companies c ON m.seller_id = c.company_id
      WHERE m.kind = ? AND m.active = 1 AND m.quantity > 0
        AND (m.seller_id = 999900 OR c.realm_id = ? OR c.realm_id IS NULL)
    `).get(kind, realmId) as { minPrice: number | null } | undefined;

    const price = (lowest && lowest.minPrice !== null) ? lowest.minPrice : 1.0;

    tickerList.push({
      kind,
      image: def.image,
      price,
      is_up: true,
      realmId
    });
  }

  return tickerList;
}

export function getMarketOrdersForResource(realmId: number, resourceKind: number) {
  const rows = db.prepare(`
    SELECT m.* FROM market_orders m
    LEFT JOIN companies c ON m.seller_id = c.company_id
    WHERE m.kind = ? AND m.active = 1 AND m.quantity > 0
      AND (m.seller_id = 999900 OR c.realm_id = ? OR c.realm_id IS NULL)
    ORDER BY m.price ASC, m.quality DESC, m.id ASC
    LIMIT 200
  `).all(resourceKind, realmId) as unknown as MarketOrderRow[];

  return rows.map(formatMarketOrder);
}

export function getCompanyMarketOrders(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM market_orders
    WHERE seller_id = ? AND active = 1
    ORDER BY id DESC
  `).all(companyId) as unknown as MarketOrderRow[];

  return rows.map(formatMarketOrder);
}

// --- Issue #100: tick grid, exchange fee, trade ledger & reference prices ---

// Exchange price tick grid (formulas_market.md §2, entry.js U0). Each price
// band has a fixed tick; a posted order price must be a whole multiple of the
// tick for the band its price falls into.
const PRICE_TICK_BANDS: ReadonlyArray<{ minPrice: number; tick: number }> = [
  { minPrice: 20000, tick: 500 },
  { minPrice: 10000, tick: 100 },
  { minPrice: 5000, tick: 25 },
  { minPrice: 1000, tick: 10 },
  { minPrice: 500, tick: 5 },
  { minPrice: 200, tick: 2 },
  { minPrice: 100, tick: 1 },
  { minPrice: 50, tick: 0.5 },
  { minPrice: 20, tick: 0.25 },
  { minPrice: 5, tick: 0.1 },
  { minPrice: 2, tick: 0.05 },
  { minPrice: 1, tick: 0.01 },
  { minPrice: 0.5, tick: 0.005 },
  { minPrice: 0, tick: 0.001 }
];

export function getPriceTickSize(price: number): number {
  for (const band of PRICE_TICK_BANDS) {
    if (price >= band.minPrice) return band.tick;
  }
  return 0.001;
}

// Exchange fee: 4% on both realms (formulas_market.md §1/§3), charged as
// fee = ceil(amount × price × 0.04) against the SELLER's proceeds at fill
// time — never at posting, never on cancellation. The epsilon snap keeps
// Math.ceil honest when amount × price × 0.04 is an exact integer up to
// float noise (e.g. 25 × 0.04 → 1.0000000000000002).
export const EXCHANGE_FEE_RATE = 0.04;

export function computeExchangeFee(amount: number, price: number): number {
  return Math.ceil(Math.round(amount * price * EXCHANGE_FEE_RATE * 1e6) / 1e6);
}

// Issue #100: append one fill to the market_trades ledger. trade_date is the
// UTC day key used to group daily VWAPs.
export function recordMarketTrade(entry: {
  kind: number;
  quality: number;
  price: number;
  amount: number;
  fee: number;
  buyerId: number | null;
  sellerId: number | null;
  tradedAt: string;
}): void {
  db.prepare(`
    INSERT INTO market_trades (kind, quality, price, amount, fee, buyer_id, seller_id, trade_date, traded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.kind,
    entry.quality,
    entry.price,
    entry.amount,
    entry.fee,
    entry.buyerId,
    entry.sellerId,
    entry.tradedAt.slice(0, 10),
    entry.tradedAt
  );
}

export interface MarketReferencePrice {
  kind: number;
  quality: number;
  vwap: number;
  date: string;
}

// Issue #100: daily VWAP reference price per resource+quality —
// vwap = Σ(price × amount) / Σ(amount) over the most recent UTC trading day
// that has fills for the pair.
export function getMarketReferencePrices(): { referencePrices: MarketReferencePrice[] } {
  const rows = db.prepare(`
    SELECT kind, quality, trade_date,
           SUM(price * amount) AS notional,
           SUM(amount) AS volume
    FROM market_trades
    GROUP BY kind, quality, trade_date
  `).all() as Array<{ kind: number; quality: number; trade_date: string; notional: number; volume: number }>;

  const latestByPair = new Map<string, { kind: number; quality: number; trade_date: string; notional: number; volume: number }>();
  for (const row of rows) {
    const key = `${row.kind}:${row.quality}`;
    const existing = latestByPair.get(key);
    if (!existing || row.trade_date > existing.trade_date) {
      latestByPair.set(key, row);
    }
  }

  const referencePrices: MarketReferencePrice[] = Array.from(latestByPair.values())
    .map(row => ({
      kind: row.kind,
      quality: row.quality,
      vwap: Math.round((row.notional / row.volume) * 1e6) / 1e6,
      date: row.trade_date
    }))
    .sort((a, b) => (a.kind - b.kind) || (a.quality - b.quality));

  return { referencePrices };
}

export function postMarketOrder(
  companyId: number,
  params: { resourceId?: number; kind: number; price: number; quantity: number; quality?: number }
) {
  const kind = Number(params.kind);
  const quantity = Number(params.quantity);
  const price = Number(params.price);
  const quality = params.quality === undefined ? 0 : Number(params.quality);

  if (!Number.isSafeInteger(kind) || kind <= 0 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid quantity or price');
  }
  if (!Number.isInteger(quality) || quality < 0 || quality > 12) {
    throw new Error('Invalid quality');
  }

  const resDef = getResourceDef(kind);
  if (!resDef) {
    throw new Error(`Unknown resource kind: ${kind}`);
  }

  let item = params.resourceId ? getWarehouseItemById(params.resourceId) : null;
  if (params.resourceId) {
    if (!item || item.company_id !== companyId || item.kind !== kind || item.quality !== quality) {
      throw new Error('Selected inventory does not match the market order');
    }
  } else {
    item = getWarehouseItemExact(companyId, kind, quality);
  }

  if (!item || item.amount < quantity) {
    throw new Error(`Insufficient inventory: have ${item ? item.amount : 0}, need ${quantity}`);
  }

  const transportPerUnit = resDef.transportation || 0;
  const transportNeeded = Math.ceil(transportPerUnit * quantity);

  // Issue #100: exchange prices must sit on the tick grid for their price
  // range (formulas_market.md §2, entry.js U0). Off-grid prices are rejected.
  const tick = getPriceTickSize(price);
  if (Math.abs(price / tick - Math.round(price / tick)) > 1e-6) {
    throw new DomainError(
      `Price ${price} is not a multiple of the ${tick} tick size for its price range`,
      400,
      'PRICE_TICK_INVALID'
    );
  }

  // Snapshot the unit cost basis before consuming
  const costWorkers = Number(item.cost_workers) || 0;
  const costAdmin = Number(item.cost_admin) || 0;
  const costMaterial1 = Number(item.cost_material1) || 0;
  const costMaterial2 = Number(item.cost_material2) || 0;
  const costMarket = item.cost_market !== undefined && item.cost_market !== null ? Number(item.cost_market) : 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    const resourceTransactions = consumeResourceExactWithTransactions(companyId, kind, quality, quantity);
    if (!resourceTransactions) {
      throw new Error(`Insufficient inventory: have ${item.amount}, need ${quantity}`);
    }
    if (transportNeeded > 0 && !consumeResourceExact(companyId, 13, 0, transportNeeded)) {
      throw new Error(`Insufficient transport: need ${transportNeeded}`);
    }

    // Issue #100: no fee at posting — the 4% exchange fee is deducted from
    // the seller's proceeds at fill time (formulas_market.md §3). fees stays
    // 0 until fills occur.
    const now = new Date().toISOString();
    const res = db.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active, cost_workers, cost_admin, cost_material1, cost_material2, cost_market)
      VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?, ?)
    `).run(companyId, kind, quality, quantity, price, now, costWorkers, costAdmin, costMaterial1, costMaterial2, costMarket);

    db.exec('COMMIT');
    const orderId = Number(res.lastInsertRowid);
    const orderRow = db.prepare('SELECT * FROM market_orders WHERE id = ?').get(orderId) as unknown as MarketOrderRow;
    const company = getCompanyById(companyId);

    return {
      sellOrder: formatMarketOrder(orderRow),
      money: company ? company.money : null,
      resourceTransactions
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function cancelMarketOrder(companyId: number, orderId: number) {
  db.exec('BEGIN IMMEDIATE');
  let order: MarketOrderRow | null = null;
  try {
    order = db.prepare(`
      SELECT * FROM market_orders
      WHERE id = ? AND seller_id = ? AND active = 1 AND quantity > 0
    `).get(orderId, companyId) as unknown as MarketOrderRow | null;
    if (!order) {
      throw new Error('Market order not found or no longer active');
    }

    // Mark inactive before refunding; the transaction rolls back if the refund fails.
    const updatedOrder = db.prepare(`
      UPDATE market_orders SET active = 0
      WHERE id = ? AND seller_id = ? AND active = 1 AND quantity > 0
    `).run(orderId, companyId);
    if (updatedOrder.changes !== 1) {
      throw new Error('Market order is no longer active');
    }
    addResource(companyId, order.kind, order.quality, order.quantity, {
      workers: Number(order.cost_workers) || 0,
      admin: Number(order.cost_admin) || 0,
      material1: Number(order.cost_material1) || 0,
      material2: Number(order.cost_material2) || 0,
      market: order.cost_market !== undefined && order.cost_market !== null ? Number(order.cost_market) : 1.0
    });
    db.exec('COMMIT');
  } catch (err: unknown) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (!order) {
    throw new Error('Market order was cancelled without a loaded order');
  }
  const updated = db.prepare('SELECT * FROM market_orders WHERE id = ?').get(orderId) as unknown as MarketOrderRow;
  const company = getCompanyById(companyId);
  const warehouse = db.prepare('SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?')
    .get(companyId, order.kind, order.quality) as unknown as { amount: number } | undefined;

  return {
    sellOrder: formatMarketOrder(updated),
    money: company ? company.money : null,
    warehouseAmount: warehouse ? Number(warehouse.amount) : 0
  };
}

export function takeMarketOrder(
  buyerCompanyId: number,
  params: { resource: number; quantity: number; quality?: number; maxPrice?: number | null; money?: number }
) {
  const resourceKind = Number(params.resource);
  const quantityRequested = Number(params.quantity);
  const minQuality = Number(params.quality ?? 0);

  // P0-08: the client's "buy missing construction materials" flow
  // (buyResources → POST /api/v2/market-order/take/) sends NO maxPrice at all
  // — the purchase is bounded only by the company's cash. A missing maxPrice
  // previously failed validation and the buy button always errored.
  const hasMaxPrice = params.maxPrice !== undefined && params.maxPrice !== null;
  const maxPrice = hasMaxPrice ? Number(params.maxPrice) : Number.POSITIVE_INFINITY;

  if (!Number.isSafeInteger(resourceKind) || resourceKind <= 0 || !getResourceDef(resourceKind)) {
    throw new Error('Unknown resource kind');
  }
  if (!Number.isFinite(quantityRequested) || quantityRequested <= 0) {
    throw new Error('Invalid purchase quantity');
  }
  if (hasMaxPrice && (!Number.isFinite(maxPrice) || maxPrice <= 0)) {
    throw new Error('Invalid maximum price');
  }
  if (!Number.isInteger(minQuality) || minQuality < 0 || minQuality > 12) {
    throw new Error('Invalid quality');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const buyer = getCompanyById(buyerCompanyId);
    if (!buyer) {
      throw new Error('Buyer company not found');
    }

    const priceCap = hasMaxPrice
      ? maxPrice
      : (Number.isFinite(Number(params.money)) && Number(params.money) > 0
        ? Number(params.money)
        : Number.MAX_SAFE_INTEGER);
    const orders = db.prepare(`
      SELECT * FROM market_orders
      WHERE kind = ? AND active = 1 AND price <= ? AND quality >= ? AND quantity > 0
      ORDER BY price ASC, quality DESC, id ASC
    `).all(resourceKind, priceCap, minQuality) as unknown as MarketOrderRow[];

    let quantityToBuy = quantityRequested;
    let totalCost = 0;
    let totalBought = 0;
    const transactions: Array<{ kind: number; quality: number; amount: number; price: number; fee: number; sellerId: number }> = [];

    for (const order of orders) {
      if (quantityToBuy <= 0) break;

      // Issue #85: Self-Trading (Wash Trading) Prevention
      const sellerComp = order.seller_id !== 999900 ? getCompanyById(order.seller_id) : null;
      const isSameCompany = order.seller_id === buyerCompanyId;
      const isSamePlayer = Boolean(
        buyer.player_id &&
        sellerComp?.player_id &&
        buyer.player_id === sellerComp.player_id
      );
      if ((isSameCompany || isSamePlayer) && order.seller_id !== 999900) {
        throw new DomainError('Cannot purchase your own market order', 400, 'SELF_TRADE_PROHIBITED');
      }

      const available = Number(order.quantity);
      const takeAmount = Math.min(available, quantityToBuy);
      const cost = takeAmount * Number(order.price);
      if (!Number.isFinite(takeAmount) || !Number.isFinite(cost) || takeAmount <= 0) continue;
      if (Number(buyer.money) < totalCost + cost) break;

      const remaining = available - takeAmount;
      const updated = remaining <= 0
        ? (order.seller_id === 999900
          ? db.prepare('UPDATE market_orders SET quantity = 100000 WHERE id = ? AND active = 1 AND quantity >= ?')
            .run(order.id, takeAmount)
          : db.prepare('UPDATE market_orders SET quantity = 0, active = 0 WHERE id = ? AND active = 1 AND quantity >= ?')
            .run(order.id, takeAmount))
        : db.prepare('UPDATE market_orders SET quantity = ? WHERE id = ? AND active = 1 AND quantity >= ?')
          .run(remaining, order.id, takeAmount);
      if (updated.changes !== 1) continue;

      // Issue #100: the 4% exchange fee is deducted from the SELLER's
      // proceeds at fill time (formulas_market.md §3); the buyer always pays
      // the full amount × price.
      let fillFee = 0;
      if (order.seller_id !== 999900) {
        fillFee = computeExchangeFee(takeAmount, Number(order.price));
        updateCompanyMoney(order.seller_id, cost - fillFee);
        db.prepare('UPDATE market_orders SET fees = fees + ? WHERE id = ?').run(fillFee, order.id);
      }

      totalCost += cost;
      totalBought += takeAmount;
      quantityToBuy -= takeAmount;
      transactions.push({
        kind: resourceKind,
        quality: order.quality,
        amount: takeAmount,
        price: Number(order.price),
        fee: fillFee,
        sellerId: order.seller_id
      });
    }

    if (totalBought <= 0) {
      throw new Error('No available market orders match your criteria or insufficient funds');
    }

    const newMoney = updateCompanyMoney(buyerCompanyId, -totalCost);
    // P0-08: reclassify the buyer's generic 'g' ledger row (written by
    // updateCompanyMoney) as a MARKET purchase ('m') so the accounting page
    // reports it correctly.
    db.prepare(`
      UPDATE cash_ledger
      SET category = 'm', description = ?, description_key = ?
      WHERE id = (SELECT MAX(id) FROM cash_ledger WHERE company_id = ? AND category = 'g' AND amount = ?)
    `).run(`Market purchase of ${totalBought} units of resource #${resourceKind}`, `market-${resourceKind}`, buyerCompanyId, -totalCost);
    for (const tx of transactions) {
      addResource(buyerCompanyId, tx.kind, tx.quality, tx.amount, { market: tx.price });
    }
    // Issue #100: record every fill in the trade ledger backing the daily
    // VWAP reference prices.
    const tradedAt = new Date().toISOString();
    for (const tx of transactions) {
      recordMarketTrade({
        kind: tx.kind,
        quality: tx.quality,
        price: tx.price,
        amount: tx.amount,
        fee: tx.fee,
        buyerId: buyerCompanyId,
        sellerId: tx.sellerId,
        tradedAt
      });
    }
    db.exec('COMMIT');

    return {
      money: newMoney,
      moneyDelta: -totalCost,
      amountBought: totalBought,
      resourceTransactions: transactions.map(t => ({
        kind: t.kind,
        db_letter: t.kind,
        dbLetter: t.kind,
        quality: t.quality,
        delta: t.amount,
        amount: t.amount
      }))
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
