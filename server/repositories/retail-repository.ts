/**
 * Retail repository (Issue #105 Phase 4 / Issue #104 Stage 3).
 * All retail_orders SQL lives here. Knows nothing about frontend DTOs.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface RetailOrderEntity {
  id: number;
  buildingId: number;
  companyId: number;
  resourceKind: number;
  quality: number;
  qualityBonus: number;
  units: number;
  unitPrice: number;
  cost: number;
  revenueCredited: boolean;
  finishedAt: string | null;
  createdAt: string;
  economyPhase: number;
  economyPhaseStartedAt: string | null;
  economySource: string;
}

export interface RetailOrderDbRow {
  id: number;
  building_id: number;
  company_id: number;
  resource_kind: number;
  quality: number;
  quality_bonus?: number | null;
  units: number;
  unit_price: number;
  cost: number;
  revenue_credited?: number | null;
  finished_at: string | null;
  created_at: string;
  economy_phase: number | null;
  economy_phase_started_at: string | null;
  economy_source: string | null;
}

export function mapRetailOrderRow(row: RetailOrderDbRow): RetailOrderEntity {
  return {
    id: row.id,
    buildingId: row.building_id,
    companyId: row.company_id,
    resourceKind: row.resource_kind,
    quality: Number(row.quality) || 0,
    qualityBonus: Number(row.quality_bonus) || 0,
    units: Number(row.units),
    unitPrice: Number(row.unit_price),
    cost: Number(row.cost),
    revenueCredited: Number(row.revenue_credited) === 1,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    economyPhase: Number(row.economy_phase ?? 1),
    economyPhaseStartedAt: row.economy_phase_started_at,
    economySource: row.economy_source || 'migration'
  };
}

export interface RetailDailySalesSummary {
  date: string;
  units: number;
  revenue: number;
}
export interface InsertRetailOrderInput {
  buildingId: number;
  companyId: number;
  resourceKind: number;
  quality?: number;
  qualityBonus?: number;
  units: number;
  unitPrice: number;
  cost?: number;
  revenueCredited?: boolean;
  finishedAt?: string | null;
  createdAt?: string;
  economyPhase?: number;
  economyPhaseStartedAt?: string | null;
  economySource?: string;
}

export class RetailRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findById(orderId: number): RetailOrderEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM retail_orders WHERE id = ?'
    ).get(orderId) as RetailOrderDbRow | undefined;
    return row ? mapRetailOrderRow(row) : null;
  }

  findByCompany(companyId: number): RetailOrderEntity[] {
    const rows = this.database.prepare(
      'SELECT * FROM retail_orders WHERE company_id = ? ORDER BY id DESC'
    ).all(companyId) as RetailOrderDbRow[];
    return rows.map(mapRetailOrderRow);
  }

  findByCompanyAndBuilding(companyId: number, buildingId: number): RetailOrderEntity[] {
    const rows = this.database.prepare(`
      SELECT * FROM retail_orders
      WHERE company_id = ? AND building_id = ?
      ORDER BY id DESC
    `).all(companyId, buildingId) as RetailOrderDbRow[];
    return rows.map(mapRetailOrderRow);
  }

  insert(input: InsertRetailOrderInput): RetailOrderEntity {
    const result = this.database.prepare(`
      INSERT INTO retail_orders
        (building_id, company_id, resource_kind, quality, quality_bonus, units, unit_price, cost, revenue_credited,
         finished_at, created_at, economy_phase, economy_phase_started_at, economy_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.buildingId,
      input.companyId,
      input.resourceKind,
      input.quality ?? 0,
      input.qualityBonus ?? 0,
      input.units,
      input.unitPrice,
      input.cost ?? 0,
      input.revenueCredited ? 1 : 0,
      input.finishedAt,
      input.createdAt,
      input.economyPhase ?? 1,
      input.economyPhaseStartedAt ?? null,
      input.economySource ?? 'scheduler'
    );
    const order = this.findById(Number(result.lastInsertRowid));
    if (!order) {
      throw new Error('Retail order vanished right after insert');
    }
    return order;
  }

  /** Delete returns false when the order no longer exists for this company. */
  deleteOwned(orderId: number, companyId: number): boolean {
    const deleted = this.database.prepare(
      'DELETE FROM retail_orders WHERE id = ? AND company_id = ?'
    ).run(orderId, companyId);
    return deleted.changes === 1;
  }
  /** Persist a completed sale before the transient order is removed. */
  recordSale(input: {
    realmId: number;
    companyId: number;
    resourceKind: number;
    quality: number;
    units: number;
    unitPrice: number;
    revenue: number;
    soldAt: string;
  }): void {
    this.database.prepare(`
      INSERT INTO retail_sales_history
        (realm_id, company_id, resource_kind, quality, units, unit_price, revenue, sold_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.realmId,
      input.companyId,
      input.resourceKind,
      input.quality,
      input.units,
      input.unitPrice,
      input.revenue,
      input.soldAt
    );
  }

  /** Settled retail sales from both the history and legacy order projections. */
  findDailySalesSummary(realmId: number, fromDate: string, toDate: string, resourceKind?: number): RetailDailySalesSummary[] {
    const rows = this.database.prepare(`
      SELECT sales.date,
             COALESCE(SUM(sales.units), 0) AS units,
             COALESCE(SUM(sales.revenue), 0) AS revenue
      FROM (
        SELECT substr(r.finished_at, 1, 10) AS date,
               r.units AS units,
               r.units * r.unit_price AS revenue
        FROM retail_orders r
        JOIN companies c ON c.company_id = r.company_id
        WHERE c.realm_id = ?
          AND COALESCE(r.revenue_credited, 0) = 1
          AND r.finished_at IS NOT NULL
          AND substr(r.finished_at, 1, 10) BETWEEN ? AND ?
          AND (? IS NULL OR r.resource_kind = ?)
        UNION ALL
        SELECT substr(h.sold_at, 1, 10) AS date,
               h.units AS units,
               h.revenue AS revenue
        FROM retail_sales_history h
        WHERE h.realm_id = ?
          AND substr(h.sold_at, 1, 10) BETWEEN ? AND ?
          AND (? IS NULL OR h.resource_kind = ?)
      ) sales
      GROUP BY sales.date
      ORDER BY sales.date ASC
    `).all(
      realmId,
      fromDate,
      toDate,
      resourceKind ?? null,
      resourceKind ?? null,
      realmId,
      fromDate,
      toDate,
      resourceKind ?? null,
      resourceKind ?? null
    ) as Array<{
      date: string;
      units: number;
      revenue: number;
    }>;
    return rows.map(row => ({
      date: row.date,
      units: Number(row.units) || 0,
      revenue: Number(row.revenue) || 0
    }));
  }


  /** First owned sales-category building (used when no building is specified). */
  findFirstSalesBuilding(companyId: number): { id: number; kind: string; size: number } | null {
    const row = this.database.prepare(`
      SELECT id, kind, size FROM buildings
      WHERE company_id = ? AND category = 'sales'
      ORDER BY id ASC
      LIMIT 1
    `).get(companyId) as { id: number; kind: string; size: number } | undefined;
    return row ?? null;
  }
}

export const retailRepository = new RetailRepository();
