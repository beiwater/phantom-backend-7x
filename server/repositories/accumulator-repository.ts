import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { NotFoundError } from '../errors/domain-error.ts';

export interface AccumulatorState {
  buildingId: number;
  companyId: number;
  resourceKind: number;
  value: number;
  costTotal: number;
  updatedAt: string;
}

interface AccumulatorDbRow {
  building_id: number;
  company_id: number;
  resource_kind: number;
  value: number;
  cost_total: number;
  updated_at: string;
}

function mapRow(row: AccumulatorDbRow): AccumulatorState {
  return {
    buildingId: Number(row.building_id),
    companyId: Number(row.company_id),
    resourceKind: Number(row.resource_kind),
    value: Number(row.value) || 0,
    costTotal: Number(row.cost_total) || 0,
    updatedAt: row.updated_at
  };
}

export class AccumulatorRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findByBuilding(buildingId: number, companyId: number): AccumulatorState | null {
    const row = this.database.prepare(`
      SELECT building_id, company_id, resource_kind, value, cost_total, updated_at
      FROM accumulator_states
      WHERE building_id = ? AND company_id = ?
    `).get(buildingId, companyId) as AccumulatorDbRow | undefined;
    return row ? mapRow(row) : null;
  }

  ensureForBuilding(
    buildingId: number,
    companyId: number,
    resourceKind: number
  ): AccumulatorState {
    const now = virtualClock.nowIso();
    this.database.prepare(`
      INSERT OR IGNORE INTO accumulator_states
        (building_id, company_id, resource_kind, value, cost_total, updated_at)
      VALUES (?, ?, ?, 0, 0, ?)
    `).run(buildingId, companyId, resourceKind, now);
    const state = this.findByBuilding(buildingId, companyId);
    if (!state) {
      throw new NotFoundError(`Accumulator for building ${buildingId} not found`);
    }
    return state;
  }

  updateProgress(
    buildingId: number,
    companyId: number,
    value: number,
    costTotal: number
  ): AccumulatorState {
    const updated = this.database.prepare(`
      UPDATE accumulator_states
      SET value = ?, cost_total = ?, updated_at = ?
      WHERE building_id = ? AND company_id = ?
      RETURNING building_id, company_id, resource_kind, value, cost_total, updated_at
    `).get(
      value,
      costTotal,
      virtualClock.nowIso(),
      buildingId,
      companyId
    ) as AccumulatorDbRow | undefined;
    if (!updated) {
      throw new NotFoundError(`Accumulator for building ${buildingId} not found`);
    }
    return mapRow(updated);
  }

  deleteForBuilding(buildingId: number, companyId: number): boolean {
    const result = this.database.prepare(
      'DELETE FROM accumulator_states WHERE building_id = ? AND company_id = ?'
    ).run(buildingId, companyId);
    return result.changes === 1;
  }
}

export const accumulatorRepository = new AccumulatorRepository();
