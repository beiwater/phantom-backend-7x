import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { NotFoundError } from '../errors/domain-error.ts';

export interface BuildingEntity {
  id: number;
  companyId: number;
  position: string;
  kind: string;
  size: number;
  name: string;
  cost: number;
  category: string;
  busyUntil: string | null;
  createdAt: string;
}

export interface BuildingDbRow {
  id: number;
  company_id: number;
  position: string;
  kind: string;
  size: number;
  name: string;
  cost: number;
  category: string;
  busy_until: string | null;
  created_at: string;
}

function mapBuildingRow(row: BuildingDbRow): BuildingEntity {
  return {
    id: row.id,
    companyId: row.company_id,
    position: row.position,
    kind: row.kind,
    size: row.size,
    name: row.name,
    cost: row.cost,
    category: row.category,
    busyUntil: row.busy_until,
    createdAt: row.created_at
  };
}

export class BuildingRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findById(buildingId: number): BuildingEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM buildings WHERE id = ?'
    ).get(buildingId) as BuildingDbRow | undefined;

    return row ? mapBuildingRow(row) : null;
  }

  findByCompany(companyId: number): BuildingEntity[] {
    const rows = this.database.prepare(
      'SELECT * FROM buildings WHERE company_id = ? ORDER BY CAST(position AS INTEGER) ASC, id ASC'
    ).all(companyId) as BuildingDbRow[];

    return rows.map(mapBuildingRow);
  }

  findByCompanyAndPosition(companyId: number, position: string): BuildingEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM buildings WHERE company_id = ? AND position = ? LIMIT 1'
    ).get(companyId, position) as BuildingDbRow | undefined;

    return row ? mapBuildingRow(row) : null;
  }

  countByCompany(companyId: number): number {
    const row = this.database.prepare(
      'SELECT COUNT(*) as count FROM buildings WHERE company_id = ?'
    ).get(companyId) as { count: number };

    return row.count;
  }

  create(data: {
    companyId: number;
    position: string;
    kind: string;
    size: number;
    name: string;
    cost: number;
    category: string;
    createdAt: string;
  }): BuildingEntity {
    const result = this.database.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      data.companyId,
      data.position,
      data.kind,
      data.size,
      data.name,
      data.cost,
      data.category,
      data.createdAt
    ) as BuildingDbRow;

    return mapBuildingRow(result);
  }

  updateSize(buildingId: number, companyId: number, newSize: number): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings
      SET size = ?
      WHERE id = ? AND company_id = ?
      RETURNING *
    `).get(newSize, buildingId, companyId) as BuildingDbRow | undefined;

    if (!result) {
      throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    }
    return mapBuildingRow(result);
  }

  updateName(buildingId: number, companyId: number, newName: string): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings
      SET name = ?
      WHERE id = ? AND company_id = ?
      RETURNING *
    `).get(newName, buildingId, companyId) as BuildingDbRow | undefined;

    if (!result) {
      throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    }
    return mapBuildingRow(result);
  }

  updateBusyUntil(buildingId: number, companyId: number, busyUntil: string | null): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings
      SET busy_until = ?
      WHERE id = ? AND company_id = ?
      RETURNING *
    `).get(busyUntil, buildingId, companyId) as BuildingDbRow | undefined;

    if (!result) {
      throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    }
    return mapBuildingRow(result);
  }

  delete(buildingId: number, companyId: number): boolean {
    const result = this.database.prepare(`
      DELETE FROM buildings
      WHERE id = ? AND company_id = ?
    `).run(buildingId, companyId);

    return result.changes === 1;
  }
}

export const buildingRepository = new BuildingRepository();
