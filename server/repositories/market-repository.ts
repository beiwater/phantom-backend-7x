/**
 * Market repository (Issue #105 Phase 3 / Issue #104 Stage 2).
 * All market_orders SQL lives here; application use cases and routes must
 * not execute market table mutations inline. Knows nothing about frontend
 * compatibility DTOs — that mapping stays in the use case layer.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { NotFoundError } from '../errors/domain-error.ts';
import { CONFIG } from '../config.ts';

export interface MarketOrderEntity {
  id: number;
  sellerId: number;
  kind: number;
  quality: number;
  quantity: number;
  price: number;
  fees: number;
  postedAt: string;
  active: boolean;
  costWorkers: number;
  costAdmin: number;
  costMaterial1: number;
  costMaterial2: number;
  costMarket: number;
}

export interface MarketOrderDbRow {
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

function mapOrderRow(row: MarketOrderDbRow): MarketOrderEntity {
  return {
    id: row.id,
    sellerId: row.seller_id,
    kind: row.kind,
    quality: row.quality,
    quantity: row.quantity,
    price: row.price,
    fees: row.fees,
    postedAt: row.posted_at,
    active: Boolean(row.active),
    costWorkers: Number(row.cost_workers) || 0,
    costAdmin: Number(row.cost_admin) || 0,
    costMaterial1: Number(row.cost_material1) || 0,
    costMaterial2: Number(row.cost_material2) || 0,
    costMarket: row.cost_market === undefined || row.cost_market === null ? 0 : Number(row.cost_market)
  };
}

export interface InsertMarketOrderInput {
  sellerId: number;
  kind: number;
  quality: number;
  quantity: number;
  price: number;
  postedAt: string;
  costWorkers: number;
  costAdmin: number;
  costMaterial1: number;
  costMaterial2: number;
  costMarket: number;
}

export class MarketRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findById(orderId: number): MarketOrderEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM market_orders WHERE id = ?'
    ).get(orderId) as MarketOrderDbRow | undefined;
    return row ? mapOrderRow(row) : null;
  }

  findActiveSellOrdersForBook(realmId: number, resourceKind: number, limit: number = 200): MarketOrderEntity[] {
    const rows = this.database.prepare(`
      SELECT m.* FROM market_orders m
      LEFT JOIN companies c ON m.seller_id = c.company_id
      WHERE m.kind = ? AND m.active = 1 AND m.quantity > 0
        AND (m.seller_id = 999900 OR c.realm_id = ? OR c.realm_id IS NULL)
      ORDER BY m.price ASC, m.quality DESC, m.id ASC
      LIMIT ?
    `).all(resourceKind, realmId, limit) as MarketOrderDbRow[];
    return rows.map(mapOrderRow);
  }

  findLowestActivePrice(kind: number, realmId: number): number | null {
    const row = this.database.prepare(`
      SELECT MIN(m.price) as minPrice FROM market_orders m
      LEFT JOIN companies c ON m.seller_id = c.company_id
      WHERE m.kind = ? AND m.active = 1 AND m.quantity > 0
        AND (m.seller_id = 999900 OR c.realm_id = ? OR c.realm_id IS NULL)
    `).get(kind, realmId) as { minPrice: number | null } | undefined;
    return row && row.minPrice !== null ? row.minPrice : null;
  }

  findActiveBySeller(companyId: number): MarketOrderEntity[] {
    const rows = this.database.prepare(`
      SELECT * FROM market_orders
      WHERE seller_id = ? AND active = 1
      ORDER BY id DESC
    `).all(companyId) as MarketOrderDbRow[];
    return rows.map(mapOrderRow);
  }

  /** Match fillable asks for a take-order, cheapest first, best quality tiebreak. */
  findFillableAsks(resourceKind: number, priceCap: number, minQuality: number): MarketOrderEntity[] {
    const cap = Number.isFinite(priceCap) ? priceCap : Number.MAX_SAFE_INTEGER;
    const rows = this.database.prepare(`
      SELECT * FROM market_orders
      WHERE kind = ? AND active = 1 AND price <= ? AND quality >= ? AND quantity > 0
      ORDER BY price ASC, quality DESC, id ASC
    `).all(resourceKind, cap, minQuality) as MarketOrderDbRow[];
    return rows.map(mapOrderRow);
  }

  insert(input: InsertMarketOrderInput): MarketOrderEntity {
    const res = this.database.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active, cost_workers, cost_admin, cost_material1, cost_material2, cost_market)
      VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      input.sellerId,
      input.kind,
      input.quality,
      input.quantity,
      input.price,
      input.postedAt,
      input.costWorkers,
      input.costAdmin,
      input.costMaterial1,
      input.costMaterial2,
      input.costMarket
    );
    const id = Number(res.lastInsertRowid);
    const order = this.findById(id);
    if (!order) {
      throw new NotFoundError(`Market order ${id} not found right after insert`);
    }
    return order;
  }

  /**
   * Fill part of an order. `remaining` <= 0 closes the order, except for the
   * NPC supplier (999900) whose book rows never close — they reset to the
   * 100000 depth the seeder uses. Returns false if the order row changed
   * concurrently inside this transaction (caller may skip the fill).
   */
  applyFill(orderId: number, takeAmount: number, remaining: number): boolean {
    const isNpc = this.findById(orderId)?.sellerId === 999900;
    const updated = remaining <= 0
      ? (isNpc && CONFIG.NPC_MARKET_INFINITE
        ? this.database.prepare('UPDATE market_orders SET quantity = 100000 WHERE id = ? AND active = 1 AND quantity >= ?')
          .run(orderId, takeAmount)
        : this.database.prepare('UPDATE market_orders SET quantity = 0, active = 0 WHERE id = ? AND active = 1 AND quantity >= ?')
          .run(orderId, takeAmount))
      : this.database.prepare('UPDATE market_orders SET quantity = ? WHERE id = ? AND active = 1 AND quantity >= ?')
        .run(remaining, orderId, takeAmount);
    return updated.changes === 1;
  }

  addFees(orderId: number, fee: number): void {
    this.database.prepare('UPDATE market_orders SET fees = fees + ? WHERE id = ?').run(fee, orderId);
  }

  /** Cancel: mark inactive; returns false when already inactive/foreign. */
  deactivateOwnedActiveOrder(orderId: number, sellerId: number): boolean {
    const updated = this.database.prepare(`
      UPDATE market_orders SET active = 0
      WHERE id = ? AND seller_id = ? AND active = 1 AND quantity > 0
    `).run(orderId, sellerId);
    return updated.changes === 1;
  }

  findOwnedActiveOrder(orderId: number, sellerId: number): MarketOrderEntity | null {
    const row = this.database.prepare(`
      SELECT * FROM market_orders
      WHERE id = ? AND seller_id = ? AND active = 1 AND quantity > 0
    `).get(orderId, sellerId) as MarketOrderDbRow | undefined;
    return row ? mapOrderRow(row) : null;
  }
}

export const marketRepository = new MarketRepository();

export interface MarketReferencePriceEntity {
  kind: number;
  quality: number;
  vwap: number;
  date: string;
}

export class MarketTradeRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  // --- Buy orders (bid side) ---------------------------------------------

  insertBuyOrder(companyId: number, kind: number, quality: number, quantity: number, price: number, postedAt: string): number {
    const res = this.database.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active, is_npc, is_buy)
      VALUES (?, ?, ?, ?, ?, 0, ?, 1, 0, 1)
    `).run(companyId, kind, quality, quantity, price, postedAt);
    return Number(res.lastInsertRowid);
  }

  findActiveBuyOrder(orderId: number): { id: number; buyerId: number; kind: number; quality: number; quantity: number; price: number } | undefined {
    const row = this.database
      .prepare('SELECT * FROM market_orders WHERE id = ? AND active = 1 AND is_buy = 1')
      .get(orderId) as {
        id: number;
        seller_id: number;
        kind: number;
        quality: number;
        quantity: number;
        price: number;
      } | undefined;
    return row
      ? {
          id: Number(row.id),
          buyerId: Number(row.seller_id),
          kind: Number(row.kind),
          quality: Number(row.quality),
          quantity: Number(row.quantity),
          price: Number(row.price)
        }
      : undefined;
  }

  closeOrReduceBuyOrder(orderId: number, newQuantity: number): void {
    if (newQuantity > 0) {
      this.database.prepare('UPDATE market_orders SET quantity = ? WHERE id = ?').run(newQuantity, orderId);
    } else {
      this.database.prepare('UPDATE market_orders SET active = 0, quantity = 0 WHERE id = ?').run(orderId);
    }
  }

  cancelBuyOrderRow(orderId: number): void {
    this.database.prepare('UPDATE market_orders SET active = 0 WHERE id = ?').run(orderId);
  }

  /** Standing bids for resource/quality, highest price first, excluding one company. */
  listOpenBids(kind: number, quality: number, minPrice: number, excludeCompanyId: number): Array<{
    id: number;
    buyerId: number;
    quantity: number;
    price: number;
  }> {
    const rows = this.database.prepare(`
      SELECT id, seller_id AS buyer_id, quantity, price
      FROM market_orders
      WHERE active = 1 AND is_buy = 1 AND kind = ? AND quality = ? AND price >= ?
        AND seller_id != ?
      ORDER BY price DESC, id ASC
    `).all(kind, quality, minPrice, excludeCompanyId) as Array<{
      id: number;
      buyer_id: number;
      quantity: number;
      price: number;
    }>;
    return rows.map(r => ({
      id: Number(r.id),
      buyerId: Number(r.buyer_id),
      quantity: Number(r.quantity),
      price: Number(r.price)
    }));
  }

  listOwnBuyOrders(companyId: number): Array<{
    id: number;
    kind: number;
    quality: number;
    quantity: number;
    price: number;
    postedAt: string;
  }> {
    const rows = this.database.prepare(`
      SELECT id, kind, quality, quantity, price, posted_at FROM market_orders
      WHERE seller_id = ? AND active = 1 AND is_buy = 1
      ORDER BY id DESC
    `).all(companyId) as Array<{
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
      quality: Number(r.quality),
      quantity: Number(r.quantity),
      price: Number(r.price),
      postedAt: r.posted_at
    }));
  }

  listBidBook(kind: number, quality: number, excludeCompanyId: number | null): Array<{
    id: number;
    kind: number;
    quality: number;
    quantity: number;
    price: number;
    postedAt: string;
  }> {
    const rows = this.database.prepare(`
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
      quality: Number(r.quality),
      quantity: Number(r.quantity),
      price: Number(r.price),
      postedAt: r.posted_at
    }));
  }

  recordFill(entry: {
    kind: number;
    quality: number;
    price: number;
    amount: number;
    fee: number;
    buyerId: number;
    sellerId: number;
    tradedAt: string;
  }): void {
    this.database.prepare(`
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

  /** Issue #100: daily VWAP per resource+quality over the latest trading day. */
  findDailyReferencePrices(realmId?: number): MarketReferencePriceEntity[] {
    const rows = this.database.prepare(`
      SELECT t.kind, t.quality, t.trade_date,
             SUM(t.price * t.amount) AS notional,
             SUM(t.amount) AS volume
      FROM market_trades t
      LEFT JOIN companies buyer ON buyer.company_id = t.buyer_id
      LEFT JOIN companies seller ON seller.company_id = t.seller_id
      WHERE (? IS NULL OR buyer.realm_id = ? OR seller.realm_id = ?)
      GROUP BY t.kind, t.quality, t.trade_date
    `).all(realmId ?? null, realmId ?? null, realmId ?? null) as Array<{ kind: number; quality: number; trade_date: string; notional: number; volume: number }>;

    const latestByPair = new Map<string, { kind: number; quality: number; trade_date: string; notional: number; volume: number }>();
    for (const row of rows) {
      const key = `${row.kind}:${row.quality}`;
      const existing = latestByPair.get(key);
      if (!existing || row.trade_date > existing.trade_date) {
        latestByPair.set(key, row);
      }
    }

    return Array.from(latestByPair.values())
      .map(row => ({
        kind: row.kind,
        quality: row.quality,
        vwap: Math.round((row.notional / row.volume) * 1e6) / 1e6,
        date: row.trade_date
      }))
      .sort((a, b) => (a.kind - b.kind) || (a.quality - b.quality));
  }
  findDailyReferencePriceHistory(kind: number, realmId?: number): Array<{
    kind: number;
    quality: number;
    date: string;
    vwap: number;
    volume: number;
  }> {
    const rows = this.database.prepare(`
      SELECT t.kind, t.quality, t.trade_date,
             SUM(t.price * t.amount) AS notional,
             SUM(t.amount) AS volume
      FROM market_trades t
      LEFT JOIN companies buyer ON buyer.company_id = t.buyer_id
      LEFT JOIN companies seller ON seller.company_id = t.seller_id
      WHERE t.kind = ?
        AND (? IS NULL OR buyer.realm_id = ? OR seller.realm_id = ?)
      GROUP BY t.kind, t.quality, t.trade_date
      HAVING SUM(t.amount) > 0
      ORDER BY t.trade_date ASC, t.quality ASC
    `).all(kind, realmId ?? null, realmId ?? null, realmId ?? null) as Array<{
      kind: number;
      quality: number;
      trade_date: string;
      notional: number;
      volume: number;
    }>;
    return rows.map(row => ({
      kind: Number(row.kind),
      quality: Number(row.quality),
      date: row.trade_date,
      vwap: Math.round((Number(row.notional) / Number(row.volume)) * 1e6) / 1e6,
      volume: Number(row.volume)
    }));
  }
}

export const marketTradeRepository = new MarketTradeRepository();
