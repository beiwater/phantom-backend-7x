/**
 * Market repository (Issue #105 Phase 3 / Issue #104 Stage 2).
 * All market_orders SQL lives here; application use cases and routes must
 * not execute market table mutations inline. Knows nothing about frontend
 * compatibility DTOs — that mapping stays in the use case layer.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { NotFoundError } from '../errors/domain-error.ts';

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
    const updated = remaining <= 0
      ? (this.findById(orderId)?.sellerId === 999900
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
