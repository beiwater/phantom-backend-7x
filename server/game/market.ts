import { db } from '../db/database.ts';
import { getResourceDef, CONSTANTS_RESOURCES } from './constants.ts';
import { consumeResource, addResource, getWarehouseItemById, getWarehouseItem } from './warehouse.ts';
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
    name: 'Market Trader',
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
      npc: false,
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
    if (!def.isExchangeTradable) continue;

    // Find lowest active price
    const lowest = db.prepare(`
      SELECT MIN(price) as minPrice FROM market_orders WHERE kind = ? AND active = 1
    `).get(kind) as { minPrice: number | null } | undefined;

    const basePrice = (def.unitsSoldAnHour && def.unitsSoldAnHour > 0) ? (100 / def.unitsSoldAnHour) : 5.0;
    const price = (lowest && lowest.minPrice !== null) ? lowest.minPrice : Math.round(basePrice * 100) / 100;

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
  const quality = Number(params.quality || 0);

  if (quantity <= 0 || price <= 0) {
    throw new Error('Invalid quantity or price');
  }

  const resDef = getResourceDef(kind);
  if (!resDef) {
    throw new Error(`Unknown resource kind: ${kind}`);
  }

  // Check warehouse
  let item = params.resourceId ? getWarehouseItemById(params.resourceId) : null;
  if (!item || item.company_id !== companyId) {
    item = getWarehouseItem(companyId, kind, quality);
  }

  if (!item || item.amount < quantity) {
    throw new Error(`Insufficient inventory: have ${item ? item.amount : 0}, need ${quantity}`);
  }

  // Deduct goods from warehouse
  consumeResource(companyId, kind, quality, quantity);

  // Deduct transport units
  const transportPerUnit = resDef.transportation || 0;
  const transportNeeded = Math.ceil(transportPerUnit * quantity);
  if (transportNeeded > 0) {
    consumeResource(companyId, 13, 0, transportNeeded);
  }

  // Market fee: 3% of total listing value
  const totalValue = price * quantity;
  const fee = Math.max(1, Math.round(totalValue * 0.03));
  const newMoney = updateCompanyMoney(companyId, -fee);

  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(companyId, kind, quality, quantity, price, fee, now);

  const orderId = Number(res.lastInsertRowid);
  const orderRow = db.prepare('SELECT * FROM market_orders WHERE id = ?').get(orderId) as unknown as MarketOrderRow;

  return {
    sellOrder: formatMarketOrder(orderRow),
    money: newMoney
  };
}

export function takeMarketOrder(
  buyerCompanyId: number,
  params: { resource: number; quantity: number; quality?: number; maxPrice: number; money?: number }
) {
  const resourceKind = Number(params.resource);
  let quantityToBuy = Number(params.quantity);
  const maxPrice = Number(params.maxPrice);
  const minQuality = Number(params.quality || 0);

  if (quantityToBuy <= 0) {
    throw new Error('Invalid purchase quantity');
  }

  const buyer = getCompanyById(buyerCompanyId);
  if (!buyer) {
    throw new Error('Buyer company not found');
  }

  // Find matching market orders
  const orders = db.prepare(`
    SELECT * FROM market_orders
    WHERE kind = ? AND active = 1 AND price <= ? AND quality >= ? AND quantity > 0
    ORDER BY price ASC, quality DESC, id ASC
  `).all(resourceKind, maxPrice, minQuality) as unknown as MarketOrderRow[];

  let totalCost = 0;
  let totalBought = 0;
  const transactions: Array<{ kind: number; quality: number; amount: number; price: number }> = [];

  for (const order of orders) {
    if (quantityToBuy <= 0) break;

    const available = order.quantity;
    const takeAmount = Math.min(available, quantityToBuy);
    const cost = takeAmount * order.price;

    if (buyer.money < totalCost + cost) {
      break;
    }

    totalCost += cost;
    totalBought += takeAmount;
    quantityToBuy -= takeAmount;

    // Update order
    const remaining = available - takeAmount;
    if (remaining <= 0) {
      db.prepare('UPDATE market_orders SET quantity = 0, active = 0 WHERE id = ?').run(order.id);
    } else {
      db.prepare('UPDATE market_orders SET quantity = ? WHERE id = ?').run(remaining, order.id);
    }

    // Pay seller
    updateCompanyMoney(order.seller_id, cost);

    // Record transaction
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

  // Deduct money from buyer
  const newMoney = updateCompanyMoney(buyerCompanyId, -totalCost);

  // Add purchased items to buyer warehouse
  for (const tx of transactions) {
    addResource(buyerCompanyId, tx.kind, tx.quality, tx.amount, { market: tx.price * tx.amount });
  }

  return {
    money: newMoney,
    resourceTransactions: transactions.map(t => ({
      kind: t.kind,
      quality: t.quality,
      amount: t.amount
    }))
  };
}
