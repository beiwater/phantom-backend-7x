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

export interface InsertRetailOrderInput {
  buildingId: number;
  companyId: number;
  resourceKind: number;
  quality: number;
  units: number;
  unitPrice: number;
  cost: number;
  finishedAt: string;
  createdAt: string;
  economyPhase?: number;
  economyPhaseStartedAt?: string | null;
  economySource?: string;
  revenueCredited?: boolean;
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
        (building_id, company_id, resource_kind, quality, units, unit_price, cost, revenue_credited,
         finished_at, created_at, economy_phase, economy_phase_started_at, economy_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.buildingId,
      input.companyId,
      input.resourceKind,
      input.quality,
      input.units,
      input.unitPrice,
      input.cost,
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
