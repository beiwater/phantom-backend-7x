import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { NotFoundError } from '../errors/domain-error.ts';
import type { ConstructionMaterialCostSegment, ResourceCostSnapshot } from './warehouse-repository.ts';

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
  upkeepActive: boolean;
  /** Issue #96: count of industrial robots installed on this building (0 = not robotized). */
  robotsInstalled: number;
  /** Display quality of the installed robots (informational; uninstall returns Q0). */
  robotsQuality: number;
  /** Specialized product the robotized building is locked to (null = not robotized). */
  lockedProduct: number | null;
  /** Per-construction/upgrade material quantities and their consumed cost buckets. */
  constructionMaterialCostSnapshots: ConstructionMaterialCostSegment[];
  /** Cost buckets of the installed robot inventory, or null for legacy/no snapshot. */
  robotInstallCostSnapshots: ResourceCostSnapshot[] | null;
  createdAt: string;
}

export interface BuildingDbRow {
  [column: string]: SQLOutputValue;
  id: SQLOutputValue;
  company_id: SQLOutputValue;
  position: SQLOutputValue;
  kind: SQLOutputValue;
  size: SQLOutputValue;
  name: SQLOutputValue;
  cost: SQLOutputValue;
  category: SQLOutputValue;
  busy_until: SQLOutputValue;
  upkeep_active: SQLOutputValue;
  robots_installed: SQLOutputValue;
  robots_quality: SQLOutputValue;
  locked_product: SQLOutputValue;
  construction_material_cost_snapshots_json: SQLOutputValue;
  robot_install_cost_snapshots_json: SQLOutputValue;
  created_at: SQLOutputValue;
}

function mapBuildingRow(row: BuildingDbRow): BuildingEntity {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    position: String(row.position),
    kind: String(row.kind),
    size: Number(row.size),
    name: String(row.name),
    cost: Number(row.cost),
    category: String(row.category),
    busyUntil: row.busy_until === null ? null : String(row.busy_until),
    upkeepActive: !!Number(row.upkeep_active),
    robotsInstalled: Number(row.robots_installed) || 0,
    robotsQuality: Number(row.robots_quality) || 0,
    lockedProduct: row.locked_product === null || row.locked_product === undefined ? null : Number(row.locked_product),
    constructionMaterialCostSnapshots: row.construction_material_cost_snapshots_json === null
      ? []
      : JSON.parse(String(row.construction_material_cost_snapshots_json)) as ConstructionMaterialCostSegment[],
    robotInstallCostSnapshots: row.robot_install_cost_snapshots_json === null
      ? null
      : JSON.parse(String(row.robot_install_cost_snapshots_json)) as ResourceCostSnapshot[],
    createdAt: String(row.created_at)
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
    // P0-07: "B<n>" star-unlocked lots are stored verbatim; they must NOT be
    // matched against base position "<n>" (previously B0 collided with slot 0).
    const rawPos = String(position ?? '').trim();
    const row = this.database.prepare(
      'SELECT * FROM buildings WHERE company_id = ? AND position = ? LIMIT 1'
    ).get(companyId, rawPos) as BuildingDbRow | undefined;

    return row ? mapBuildingRow(row) : null;
  }

  countByCompany(companyId: number): number {
    const row = this.database.prepare(
      'SELECT COUNT(*) as count FROM buildings WHERE company_id = ?'
    ).get(companyId) as { count: SQLOutputValue };

    return Number(row.count);
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
    abundance?: number;
    originalAbundance?: number;
  }): BuildingEntity {
    // Issue #93: abundance defaults keep non-extractor buildings (and legacy
    // callers that omit the fields) at a fully rich 100% deposit.
    const result = this.database.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at, abundance, original_abundance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      data.companyId,
      data.position,
      data.kind,
      data.size,
      data.name,
      data.cost,
      data.category,
      data.createdAt,
      data.abundance ?? 100,
      data.originalAbundance ?? data.abundance ?? 100
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
  updatePosition(buildingId: number, companyId: number, newPosition: string): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings
      SET position = ?
      WHERE id = ? AND company_id = ?
      RETURNING *
    `).get(newPosition, buildingId, companyId) as BuildingDbRow | undefined;

    if (!result) {
      throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    }
    return mapBuildingRow(result);
  }

  updateUpkeep(buildingId: number, companyId: number, busyUntil: string | null, upkeepActive: boolean): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings
      SET busy_until = ?, upkeep_active = ?
      WHERE id = ? AND company_id = ?
      RETURNING *
    `).get(busyUntil, upkeepActive ? 1 : 0, buildingId, companyId) as BuildingDbRow | undefined;

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

  /**
   * Issue #96: persist the robotics state of a building. Passing a zero count
   * with a null locked product fully clears the robotization (uninstall).
   */
  updateRobotics(
    buildingId: number,
    companyId: number,
    robotics: { robotsInstalled: number; robotsQuality: number; lockedProduct: number | null }
  ): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings
      SET robots_installed = ?,
          robots_quality = ?,
          locked_product = ?
      WHERE id = ? AND company_id = ?
      RETURNING *
    `).get(
      robotics.robotsInstalled,
      robotics.robotsQuality,
      robotics.lockedProduct,
      buildingId,
      companyId
    ) as BuildingDbRow | undefined;

    if (!result) {
      throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    }
    return mapBuildingRow(result);
  }

  appendConstructionMaterialCostSnapshot(
    buildingId: number,
    companyId: number,
    segment: ConstructionMaterialCostSegment
  ): BuildingEntity {
    const row = this.database.prepare(`
      SELECT construction_material_cost_snapshots_json FROM buildings
      WHERE id = ? AND company_id = ?
    `).get(buildingId, companyId) as { construction_material_cost_snapshots_json: SQLOutputValue } | undefined;
    if (!row) throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    const previous = row.construction_material_cost_snapshots_json === null
      ? []
      : JSON.parse(String(row.construction_material_cost_snapshots_json)) as ConstructionMaterialCostSegment[];
    const result = this.database.prepare(`
      UPDATE buildings SET construction_material_cost_snapshots_json = ?
      WHERE id = ? AND company_id = ? RETURNING *
    `).get(JSON.stringify([...previous, segment]), buildingId, companyId) as BuildingDbRow | undefined;
    if (!result) throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    return mapBuildingRow(result);
  }

  setConstructionMaterialCostSnapshots(
    buildingId: number,
    companyId: number,
    snapshots: ConstructionMaterialCostSegment[]
  ): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings SET construction_material_cost_snapshots_json = ?
      WHERE id = ? AND company_id = ? RETURNING *
    `).get(JSON.stringify(snapshots), buildingId, companyId) as BuildingDbRow | undefined;
    if (!result) throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
    return mapBuildingRow(result);
  }

  setRobotInstallCostSnapshots(
    buildingId: number,
    companyId: number,
    snapshots: ResourceCostSnapshot[] | null
  ): BuildingEntity {
    const result = this.database.prepare(`
      UPDATE buildings SET robot_install_cost_snapshots_json = ?
      WHERE id = ? AND company_id = ? RETURNING *
    `).get(snapshots === null ? null : JSON.stringify(snapshots), buildingId, companyId) as BuildingDbRow | undefined;
    if (!result) throw new NotFoundError(`Building with id ${buildingId} not found for company ${companyId}`);
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
