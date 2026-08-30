import { db } from '../db/database.ts';
import { getProductionQualityCap } from './research.ts';
import { getBuildingById, formatBuilding } from './buildings.ts';
import { getResourceDef, calculateProductionTime } from './constants.ts';
import { consumeResource, addResource, getWarehouseItem } from './warehouse.ts';

export interface QueueRow {
  id: number;
  building_id: number;
  company_id: number;
  kind: number;
  quality: number;
  amount: number;
  duration_seconds: number;
  started_at: string;
  finishes_at: string;
  resolved: number;
}

export function formatQueueItem(q: QueueRow) {
  const res = getResourceDef(q.kind);
  return {
    id: q.id,
    kind: q.kind,
    amount: q.amount,
    duration: q.duration_seconds,
    started: q.started_at,
    finishes: q.finishes_at,
    resource: res ? {
      name: `Resource #${q.kind}`,
      image: res.image
    } : null
  };
}

export function resolveFinishedProduction(companyId: number) {
  const now = new Date().toISOString();
  const finished = db.prepare(`
    SELECT * FROM production_queues
    WHERE company_id = ? AND finishes_at <= ? AND resolved = 0
  `).all(companyId, now) as unknown as Array<QueueRow & { quality?: number }>;

  for (const q of finished) {
    db.prepare('UPDATE production_queues SET resolved = 1 WHERE id = ?').run(q.id);
    // Legacy committed sqlite may lack the quality column: default 0.
    addResource(q.company_id, q.kind, q.quality ?? 0, q.amount, { workers: 10, admin: 1 });
  }
}

export function getBuildingQueue(companyId: number, buildingId: number) {
  resolveFinishedProduction(companyId);

  const rows = db.prepare(`
    SELECT * FROM production_queues
    WHERE building_id = ? AND resolved = 0
    ORDER BY id ASC
  `).all(buildingId) as unknown as QueueRow[];

  return rows.map(formatQueueItem);
}

export function queueProduction(companyId: number, buildingId: number, resourceKind: number, amount: number) {
  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  const resDef = getResourceDef(resourceKind);
  if (!resDef) {
    throw new Error(`Unknown resource kind: ${resourceKind}`);
  }

  // Check and consume input materials
  if (resDef.producedFrom) {
    for (const [reqKindStr, reqPerUnit] of Object.entries(resDef.producedFrom)) {
      const reqKind = Number(reqKindStr);
      const totalReq = reqPerUnit * amount;
      const stock = getWarehouseItem(companyId, reqKind, 0);
      if (!stock || stock.amount < totalReq) {
        throw new Error(`Insufficient materials: need ${totalReq} of resource #${reqKind}`);
      }
    }

    // Consume materials
    for (const [reqKindStr, reqPerUnit] of Object.entries(resDef.producedFrom)) {
      const reqKind = Number(reqKindStr);
      const totalReq = reqPerUnit * amount;
      consumeResource(companyId, reqKind, 0, totalReq);
    }
  }

  const duration = calculateProductionTime(resourceKind, amount, building.size);
  // Quality achievable at queue time, driven by the research quality cap (#39).
  const quality = getProductionQualityCap(companyId, resourceKind);
  const now = new Date();
  const finishDate = new Date(now.getTime() + duration * 1000);

  const res = db.prepare(`
    INSERT INTO production_queues (building_id, company_id, kind, quality, amount, duration_seconds, started_at, finishes_at, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(buildingId, companyId, resourceKind, quality, amount, duration, now.toISOString(), finishDate.toISOString());

  // Update building busy_until
  db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(finishDate.toISOString(), buildingId);

  const updatedBuilding = getBuildingById(buildingId);
  const queue = getBuildingQueue(companyId, buildingId);

  return {
    queue,
    building: updatedBuilding ? formatBuilding(updatedBuilding) : null
  };
}

export function cancelQueueItem(companyId: number, buildingId: number, queueId: number) {
  const q = db.prepare(`
    SELECT * FROM production_queues WHERE id = ? AND building_id = ? AND company_id = ? AND resolved = 0
  `).get(queueId, buildingId, companyId) as unknown as QueueRow | undefined;

  if (!q) {
    throw new Error('Queue item not found');
  }

  if (new Date(q.finishes_at).getTime() <= Date.now()) {
    throw new Error('Queue item no longer cancellable');
  }

  db.exec('BEGIN');
  try {
    // Refund input materials
    const resDef = getResourceDef(q.kind);
    if (resDef && resDef.producedFrom) {
      for (const [reqKindStr, reqPerUnit] of Object.entries(resDef.producedFrom)) {
        const reqKind = Number(reqKindStr);
        const totalReq = reqPerUnit * q.amount;
        addResource(companyId, reqKind, 0, totalReq);
      }
    }

    const del = db.prepare('DELETE FROM production_queues WHERE id = ? AND resolved = 0').run(queueId);
    if (del.changes === 0) {
      throw new Error('Queue item no longer cancellable');
    }
    db.exec('COMMIT');
  } catch (err: unknown) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getBuildingQueue(companyId, buildingId);
}
