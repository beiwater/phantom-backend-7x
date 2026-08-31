import { db } from '../db/database.ts';
import { getProductionQualityCap } from './research.ts';
import { getBuildingById, formatBuilding } from './buildings.ts';
import { getResourceDef, calculateProductionTime } from './constants.ts';
import {
  consumeResourceWithTransactions,
  addResource,
  getWarehouseItem,
  type ResourceTransaction
} from './warehouse.ts';

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
  if (finished.length === 0) return;

  db.exec('BEGIN');
  try {
    for (const q of finished) {
      const claimed = db.prepare(`
        UPDATE production_queues SET resolved = 1
        WHERE id = ? AND company_id = ? AND resolved = 0
      `).run(q.id, companyId);
      if (claimed.changes !== 1) continue;
      // Legacy committed sqlite may lack the quality column: default 0.
      addResource(q.company_id, q.kind, q.quality ?? 0, q.amount, { workers: 10, admin: 1 });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getBuildingQueue(companyId: number, buildingId: number) {

  const rows = db.prepare(`
    SELECT * FROM production_queues
    WHERE building_id = ? AND company_id = ? AND resolved = 0
    ORDER BY id ASC
  `).all(buildingId, companyId) as unknown as QueueRow[];
  return rows.map(formatQueueItem);
}

export function queueProduction(companyId: number, buildingId: number, resourceKind: number, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Production amount must be greater than zero');
  }

  // Finished automatic queues must be resolved before checking whether the
  // building can accept a new job.
  resolveFinishedProduction(companyId);

  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  const resDef = getResourceDef(resourceKind);
  if (!resDef) {
    throw new Error(`Unknown resource kind: ${resourceKind}`);
  }
  if (!resDef.producedAt || resDef.producedAt !== building.kind) {
    throw new Error(`Resource ${resourceKind} cannot be produced in building type '${building.kind}'`);
  }

  // Reject queueing while the building is busy (construction, upgrade, or active production)
  const now = new Date();
  const busyUntilMs = building.busy_until ? new Date(building.busy_until).getTime() : 0;
  if (busyUntilMs > now.getTime()) {
    throw new Error('Building is busy with ongoing construction, upgrade, or production');
  }

  const resourceTransactions: ResourceTransaction[] = [];

  // Preflight all input materials before opening the mutation transaction.
  if (resDef.producedFrom) {
    for (const [reqKindStr, reqPerUnit] of Object.entries(resDef.producedFrom)) {
      const reqKind = Number(reqKindStr);
      const totalReq = reqPerUnit * amount;
      const stock = getWarehouseItem(companyId, reqKind, 0);
      if (!stock || stock.amount < totalReq) {
        throw new Error(`Insufficient materials: need ${totalReq} of resource #${reqKind}`);
      }
    }
  }

  const duration = calculateProductionTime(resourceKind, amount, building.size);
  // Quality achievable at queue time, driven by the research quality cap (#39).
  const quality = getProductionQualityCap(companyId, resourceKind);
  const finishDate = new Date(now.getTime() + duration * 1000);

  db.exec('BEGIN');
  try {
    if (resDef.producedFrom) {
      for (const [reqKindStr, reqPerUnit] of Object.entries(resDef.producedFrom)) {
        const reqKind = Number(reqKindStr);
        const totalReq = reqPerUnit * amount;
        const transactions = consumeResourceWithTransactions(companyId, reqKind, 0, totalReq);
        if (!transactions) {
          throw new Error(`Insufficient materials: need ${totalReq} of resource #${reqKind}`);
        }
        resourceTransactions.push(...transactions);
      }
    }

    db.prepare(`
      INSERT INTO production_queues (building_id, company_id, kind, quality, amount, duration_seconds, started_at, finishes_at, resolved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(buildingId, companyId, resourceKind, quality, amount, duration, now.toISOString(), finishDate.toISOString());

    // Extend building busy_until past any existing busy window.
    const busyUntil = new Date(Math.max(busyUntilMs, finishDate.getTime()));
    const updated = db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ? AND company_id = ?')
      .run(busyUntil.toISOString(), buildingId, companyId);
    if (updated.changes !== 1) {
      throw new Error('Building not found');
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const updatedBuilding = getBuildingById(buildingId);
  const queue = getBuildingQueue(companyId, buildingId);

  return {
    queue,
    building: updatedBuilding ? formatBuilding(updatedBuilding) : null,
    resourceTransactions
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

  // Recompute busy_until from the latest remaining unresolved queue item
  const latest = db.prepare(`
    SELECT finishes_at FROM production_queues
    WHERE building_id = ? AND resolved = 0
    ORDER BY finishes_at DESC, id DESC
    LIMIT 1
  `).get(buildingId) as { finishes_at: string } | undefined;
  db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(
    latest ? latest.finishes_at : null, buildingId
  );
  return getBuildingQueue(companyId, buildingId);
}
