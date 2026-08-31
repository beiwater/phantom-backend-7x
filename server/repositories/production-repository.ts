import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { NotFoundError } from '../errors/domain-error.ts';

export interface ProductionQueueEntity {
  id: number;
  buildingId: number;
  companyId: number;
  kind: number;
  quality: number;
  cost: number | null;
  durationSeconds: number;
  startedAt: string;
  finishesAt: string;
  resolved: boolean;
}

export interface ProductionQueueDbRow {
  id: number;
  building_id: number;
  company_id: number;
  kind: number;
  quality: number;
  cost: number | null;
  amount: number;
  started_at: string;
  finishes_at: string;
  resolved: number;
}

function mapQueueRow(row: ProductionQueueDbRow): ProductionQueueEntity {
  return {
    id: row.id,
    buildingId: row.building_id,
    companyId: row.company_id,
    kind: row.kind,
    quality: row.quality ?? 0,
    cost: row.cost === null || row.cost === undefined ? null : Number(row.cost),
    amount: row.amount,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    finishesAt: row.finishes_at,
    resolved: Boolean(row.resolved)
  };
}

export class ProductionRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findById(queueId: number): ProductionQueueEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM production_queues WHERE id = ?'
    ).get(queueId) as ProductionQueueDbRow | undefined;

    return row ? mapQueueRow(row) : null;
  }

  findActiveByBuilding(buildingId: number, companyId: number): ProductionQueueEntity[] {
    const rows = this.database.prepare(`
      SELECT * FROM production_queues
      WHERE building_id = ? AND company_id = ? AND resolved = 0
      ORDER BY id ASC
    `).all(buildingId, companyId) as ProductionQueueDbRow[];

    return rows.map(mapQueueRow);
  }

  findLatestActiveByBuilding(buildingId: number, companyId: number): ProductionQueueEntity | null {
    const row = this.database.prepare(`
      SELECT * FROM production_queues
      WHERE building_id = ? AND company_id = ? AND resolved = 0
      ORDER BY finishes_at DESC, id DESC
      LIMIT 1
    `).get(buildingId, companyId) as ProductionQueueDbRow | undefined;

    return row ? mapQueueRow(row) : null;
  }

  findHistoryByBuilding(buildingId: number, limit: number = 20): ProductionQueueEntity[] {
    const rows = this.database.prepare(`
      SELECT * FROM production_queues
      WHERE building_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(buildingId, limit) as ProductionQueueDbRow[];

    return rows.map(mapQueueRow);
  }

  findFinishedUnresolved(companyId: number, asOfDate: string = new Date().toISOString()): ProductionQueueEntity[] {
    const rows = this.database.prepare(`
      SELECT * FROM production_queues
      WHERE company_id = ? AND resolved = 0 AND finishes_at <= ?
      ORDER BY finishes_at ASC, id ASC
    `).all(companyId, asOfDate) as ProductionQueueDbRow[];

    return rows.map(mapQueueRow);
  }

  create(data: {
    buildingId: number;
    companyId: number;
    kind: number;
    quality: number;
    cost?: number | null;
    amount: number;
  }): ProductionQueueEntity {
    const result = this.database.prepare(`
      INSERT INTO production_queues (
        building_id, company_id, kind, quality, cost, amount, duration_seconds, started_at, finishes_at, resolved
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      RETURNING *
    `).get(
      data.buildingId,
      data.companyId,
      data.kind,
      data.quality,
      data.cost ?? null,
      data.amount,
      data.durationSeconds,
      data.startedAt,
      data.finishesAt
    ) as ProductionQueueDbRow;

    return mapQueueRow(result);
  }

  /**
   * Atomically mark a production queue item as resolved.
   * Returns true if successfully updated, false if already resolved or not found.
   */
  markResolved(queueId: number, companyId: number): boolean {
    const result = this.database.prepare(`
      UPDATE production_queues
      SET resolved = 1
      WHERE id = ? AND company_id = ? AND resolved = 0
    `).run(queueId, companyId);

    return result.changes === 1;
  }

  delete(queueId: number, companyId: number): boolean {
    const result = this.database.prepare(`
      DELETE FROM production_queues
      WHERE id = ? AND company_id = ?
    `).run(queueId, companyId);

    return result.changes === 1;
  }

  finishImmediately(queueId: number, companyId: number, nowIso: string = new Date().toISOString()): ProductionQueueEntity {
    const result = this.database.prepare(`
      UPDATE production_queues
      SET finishes_at = ?
      WHERE id = ? AND company_id = ? AND resolved = 0
      RETURNING *
    `).get(nowIso, queueId, companyId) as ProductionQueueDbRow | undefined;

    if (!result) {
      throw new NotFoundError(`Active queue item ${queueId} not found for company ${companyId}`);
    }
    return mapQueueRow(result);
  }
}

export const productionRepository = new ProductionRepository();
