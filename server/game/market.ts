import { db } from '../db/database.ts';
import { getResourceDef, CONSTANTS_RESOURCES } from './constants.ts';
import { consumeResourceExact, consumeResourceExactWithTransactions, addResource, getWarehouseItemById, getWarehouseItemExact } from './warehouse.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';

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
      realmId: 0,
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
      SELECT MIN(price) as minPrice FROM market_orders WHERE kind = ? AND active = 1 AND quantity > 0
    `).get(kind) as { minPrice: number | null } | undefined;

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
    SELECT * FROM market_orders
    WHERE kind = ? AND active = 1 AND quantity > 0
    ORDER BY price ASC, quality DESC, id ASC
    LIMIT 200
  `).all(resourceKind) as unknown as MarketOrderRow[];

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
  const totalValue = price * quantity;
  const fee = Math.max(1, Math.round(totalValue * 0.03));

  db.exec('BEGIN');
  try {
    const resourceTransactions = consumeResourceExactWithTransactions(companyId, kind, quality, quantity);
    if (!resourceTransactions) {
      throw new Error(`Insufficient inventory: have ${item.amount}, need ${quantity}`);
    }
    if (transportNeeded > 0 && !consumeResourceExact(companyId, 13, 0, transportNeeded)) {
      throw new Error(`Insufficient transport: need ${transportNeeded}`);
    }

    const newMoney = updateCompanyMoney(companyId, -fee);
    const now = new Date().toISOString();
    const res = db.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(companyId, kind, quality, quantity, price, fee, now);

    db.exec('COMMIT');
    const orderId = Number(res.lastInsertRowid);
    const orderRow = db.prepare('SELECT * FROM market_orders WHERE id = ?').get(orderId) as unknown as MarketOrderRow;

    return {
      sellOrder: formatMarketOrder(orderRow),
      money: newMoney,
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
    addResource(companyId, order.kind, order.quality, order.quantity);
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
  params: { resource: number; quantity: number; quality?: number; maxPrice: number; money?: number }
) {
  const resourceKind = Number(params.resource);
  const quantityRequested = Number(params.quantity);
  const maxPrice = Number(params.maxPrice);
  const minQuality = Number(params.quality ?? 0);

  if (!Number.isSafeInteger(resourceKind) || resourceKind <= 0 || !getResourceDef(resourceKind)) {
    throw new Error('Unknown resource kind');
  }
  if (!Number.isFinite(quantityRequested) || quantityRequested <= 0) {
    throw new Error('Invalid purchase quantity');
  }
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
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

    const orders = db.prepare(`
      SELECT * FROM market_orders
      WHERE kind = ? AND active = 1 AND price <= ? AND quality >= ? AND quantity > 0
      ORDER BY price ASC, quality DESC, id ASC
    `).all(resourceKind, maxPrice, minQuality) as unknown as MarketOrderRow[];

    let quantityToBuy = quantityRequested;
    let totalCost = 0;
    let totalBought = 0;
    const transactions: Array<{ kind: number; quality: number; amount: number; price: number }> = [];

    for (const order of orders) {
      if (quantityToBuy <= 0) break;

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

      if (order.seller_id !== 999900) {
        updateCompanyMoney(order.seller_id, cost);
      }

      totalCost += cost;
      totalBought += takeAmount;
      quantityToBuy -= takeAmount;
      transactions.push({
        kind: resourceKind,
        quality: order.quality,
        amount: takeAmount,
        price: order.price
      });
    }

    if (totalBought <= 0) {
      throw new Error('No available market orders match your criteria or insufficient funds');
    }

    const newMoney = updateCompanyMoney(buyerCompanyId, -totalCost);
    for (const tx of transactions) {
      addResource(buyerCompanyId, tx.kind, tx.quality, tx.amount, { market: tx.price * tx.amount });
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
