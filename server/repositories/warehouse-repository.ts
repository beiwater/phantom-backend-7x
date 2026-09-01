import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { InsufficientInventoryError } from '../errors/domain-error.ts';

export interface WarehouseEntity {
  id: number;
  companyId: number;
  kind: number;
  quality: number;
  amount: number;
  costWorkers: number;
  costAdmin: number;
  costMaterial1: number;
  costMaterial2: number;
  costMarket: number;
  updatedAt: string;
}

export interface WarehouseDbRow {
  id: number;
  company_id: number;
  kind: number;
  quality: number;
  amount: number;
  cost_workers: number;
  cost_admin: number;
  cost_material1: number;
  cost_material2: number;
  cost_market: number;
  updated_at: string;
}

export interface ResourceTransactionEntity {
  kind: number;
  quality: number;
  amount: number;
  cost: number;
}

export interface CostBreakdown {
  workers?: number;
  admin?: number;
  material1?: number;
  material2?: number;
  market?: number;
}

function mapWarehouseRow(row: WarehouseDbRow): WarehouseEntity {
  return {
    id: row.id,
    companyId: row.company_id,
    kind: row.kind,
    quality: row.quality ?? 0,
    amount: row.amount,
    costWorkers: row.cost_workers,
    costAdmin: row.cost_admin,
    costMaterial1: row.cost_material1,
    costMaterial2: row.cost_material2,
    costMarket: row.cost_market,
    updatedAt: row.updated_at
  };
}

export class WarehouseRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findByCompany(companyId: number): WarehouseEntity[] {
    const rows = this.database.prepare(
      'SELECT * FROM warehouse WHERE company_id = ? AND amount > 0 ORDER BY kind ASC, quality ASC'
    ).all(companyId) as WarehouseDbRow[];

    return rows.map(mapWarehouseRow);
  }

  findByCompanyAndResource(companyId: number, kind: number, quality: number = 0): WarehouseEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?'
    ).get(companyId, kind, quality) as WarehouseDbRow | undefined;

    return row ? mapWarehouseRow(row) : null;
  }

  findById(rowId: number): WarehouseEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM warehouse WHERE id = ?'
    ).get(rowId) as WarehouseDbRow | undefined;

    return row ? mapWarehouseRow(row) : null;
  }

  hasSufficientMaterials(companyId: number, requirements: Array<{ kind: number; amount: number; quality?: number }>): boolean {
    for (const req of requirements) {
      const q = req.quality ?? 0;
      const item = this.findByCompanyAndResource(companyId, req.kind, q);
      if (!item || item.amount < req.amount) {
        return false;
      }
    }
    return true;
  }

  /** Total available amount for a kind, optionally exact-quality. */
  getAvailableAmount(
    companyId: number,
    kind: number,
    mode: 'exact' | 'range',
    quality: number
  ): number {
    const where = mode === 'exact' ? 'AND quality = ?' : '';
    const params = mode === 'exact' ? [companyId, kind, quality] : [companyId, kind];
    const row = this.database
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM warehouse
         WHERE company_id = ? AND kind = ? AND amount > 0 ${where}`
      )
      .get(...params) as { total: number | bigint };
    return Number(row?.total) || 0;
  }

  /**
   * Restaurant-style FIFO batch read: exact quality or ordered by quality
   * direction. Returns raw batch rows with their cost components.
   */
  listBatchesForConsumption(
    companyId: number,
    kind: number,
    mode: 'exact' | 'high' | 'low',
    quality: number
  ): Array<Record<string, number>> {
    const where = mode === 'exact' ? 'AND quality = ?' : '';
    const order = mode === 'high' ? 'quality DESC, id ASC' : 'quality ASC, id ASC';
    const params = mode === 'exact' ? [companyId, kind, quality] : [companyId, kind];
    return this.database
      .prepare(
        `SELECT id, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market
         FROM warehouse
         WHERE company_id = ? AND kind = ? AND amount > 0 ${where}
         ORDER BY ${order}`
      )
      .all(...params) as Array<Record<string, number>>;
  }

  /** Debit one batch row; guarded so concurrent consumption cannot go negative. */
  debitBatch(batchId: number, amount: number): void {
    this.database
      .prepare('UPDATE warehouse SET amount = amount - ?, updated_at = ? WHERE id = ? AND amount >= ?')
      .run(amount, new Date().toISOString(), batchId, amount);
  }

  addResource(
    companyId: number,
    kind: number,
    quality: number,
    amount: number,
    cost: CostBreakdown = {}
  ): WarehouseEntity {
    if (amount <= 0) {
      throw new Error(`addResource amount must be positive: ${amount}`);
    }

    const now = new Date().toISOString();
    const existing = this.database.prepare(
      'SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?'
    ).get(companyId, kind, quality) as WarehouseDbRow | undefined;

    if (existing) {
      const oldAmount = Number(existing.amount);
      const newAmount = oldAmount + amount;
      const wWorkers = ((existing.cost_workers * oldAmount) + ((cost.workers || 0) * amount)) / newAmount;
      const wAdmin = ((existing.cost_admin * oldAmount) + ((cost.admin || 0) * amount)) / newAmount;
      const wMat1 = ((existing.cost_material1 * oldAmount) + ((cost.material1 || 0) * amount)) / newAmount;
      const wMat2 = ((existing.cost_material2 * oldAmount) + ((cost.material2 || 0) * amount)) / newAmount;
      const wMarket = ((existing.cost_market * oldAmount) + ((cost.market || 0) * amount)) / newAmount;

      const updated = this.database.prepare(`
        UPDATE warehouse
        SET amount = ?,
            cost_workers = ?,
            cost_admin = ?,
            cost_material1 = ?,
            cost_material2 = ?,
            cost_market = ?,
            updated_at = ?
        WHERE id = ?
        RETURNING *
      `).get(
        newAmount,
        wWorkers,
        wAdmin,
        wMat1,
        wMat2,
        wMarket,
        now,
        existing.id
      ) as WarehouseDbRow;

      return mapWarehouseRow(updated);
    }

    const inserted = this.database.prepare(`
      INSERT INTO warehouse (
        company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      companyId,
      kind,
      quality,
      amount,
      cost.workers || 0,
      cost.admin || 0,
      cost.material1 || 0,
      cost.material2 || 0,
      cost.market || 1.0,
      now
    ) as WarehouseDbRow;

    return mapWarehouseRow(inserted);
  }

  /**
   * Consume resource of an exact quality, throwing InsufficientInventoryError if not enough.
   */
  consumeExact(
    companyId: number,
    kind: number,
    quality: number,
    amount: number
  ): ResourceTransactionEntity[] {
    if (amount <= 0) return [];

    const item = this.database.prepare(
      'SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?'
    ).get(companyId, kind, quality) as WarehouseDbRow | undefined;

    if (!item || item.amount < amount) {
      throw new InsufficientInventoryError(
        `Insufficient inventory for resource ${kind} Q${quality}: required ${amount}, available ${item?.amount ?? 0}`
      );
    }

    const newAmount = item.amount - amount;
    const now = new Date().toISOString();

    this.database.prepare(`
      UPDATE warehouse
      SET amount = ?, updated_at = ?
      WHERE id = ?
    `).run(newAmount, now, item.id);

    const unitCost = item.cost_workers + item.cost_admin + item.cost_material1 + item.cost_material2 + item.cost_market;

    return [{
      kind,
      quality,
      amount,
      cost: unitCost
    }];
  }

  /**
   * Consume resource with fallback to higher qualities if needed.
   */
  consumeWithTransactions(
    companyId: number,
    kind: number,
    minQuality: number,
    amount: number
  ): ResourceTransactionEntity[] {
    if (amount <= 0) return [];

    const rows = this.database.prepare(`
      SELECT * FROM warehouse
      WHERE company_id = ? AND kind = ? AND quality >= ? AND amount > 0
      ORDER BY quality ASC
    `).all(companyId, kind, minQuality) as WarehouseDbRow[];

    const totalAvailable = rows.reduce((sum, r) => sum + r.amount, 0);
    if (totalAvailable < amount) {
      throw new InsufficientInventoryError(
        `Insufficient inventory for resource ${kind} (min Q${minQuality}): required ${amount}, available ${totalAvailable}`
      );
    }

    let remaining = amount;
    const transactions: ResourceTransactionEntity[] = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(row.amount, remaining);
      const newAmount = row.amount - take;

      this.database.prepare(`
        UPDATE warehouse
        SET amount = ?, updated_at = ?
        WHERE id = ?
      `).run(newAmount, now, row.id);

      const unitCost = row.cost_workers + row.cost_admin + row.cost_material1 + row.cost_material2 + row.cost_market;

      transactions.push({
        kind: row.kind,
        quality: row.quality ?? 0,
        amount: take,
        cost: unitCost
      });

      remaining -= take;
    }

    return transactions;
  }
}

export const warehouseRepository = new WarehouseRepository();
