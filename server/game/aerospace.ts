import { db } from '../db/database.ts';
import { getResourceDef } from './constants.ts';
import { updateCompanyMoney } from './company.ts';
import {
  consumeResourceExactWithTransactions,
  getWarehouseItemExact,
  addResource
} from './warehouse.ts';
import { runInTransaction } from '../db/transaction.ts';
import { getCompanyBoostSettings } from './simboost-settings.ts';

// Initialize Aerospace & Rocket Launch tables
db.exec(`
  CREATE TABLE IF NOT EXISTS rocket_launches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    realm_id INTEGER DEFAULT 0,
    building_id INTEGER,
    rocket_kind INTEGER NOT NULL,
    quality INTEGER DEFAULT 0,
    success INTEGER DEFAULT 1,
    launched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS launch_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    building_id INTEGER NOT NULL,
    realm_id INTEGER DEFAULT 0,
    rocket_kind INTEGER NOT NULL,
    quality INTEGER DEFAULT 0,
    status TEXT DEFAULT 'QUEUED',
    duration_seconds REAL NOT NULL,
    started_at TEXT NOT NULL,
    finishes_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_launch_queue_comp_bld ON launch_queue(company_id, building_id, status);
  CREATE INDEX IF NOT EXISTS idx_rocket_launches_comp_realm ON rocket_launches(realm_id, company_id);

  CREATE TABLE IF NOT EXISTS aerospace_sales_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    building_id INTEGER,
    resources_json TEXT,
    search_cost REAL DEFAULT 750,
    payout REAL DEFAULT 15000,
    created_at TEXT,
    expires_at TEXT,
    fulfilled INTEGER DEFAULT 0
  );
`);

export const LAUNCH_QUEUE_MAX = 30;

export interface RocketConfig {
  kind: number;
  name: string;
  minLevel: number;
  researchCost: number; // units of Aerospace Research (resource kind 100)
}

export const ROCKET_CONFIGS: Record<number, RocketConfig> = {
  91: {
    kind: 91,
    name: 'Sub-Orbital Rocket',
    minLevel: 1,
    researchCost: 400
  },
  94: {
    kind: 94,
    name: 'BFR',
    minLevel: 3,
    researchCost: 2800
  }
};

export interface QueuedLaunchItem {
  id: number;
  buildingId: number;
  companyId: number;
  rocketKind: number;
  quality: number;
  status: string;
  started: string;
  finishes: string;
  finishes_at: string;
  duration: number;
  createdAt: string;
}

export interface AerospaceSalesOrderResource {
  kind: number;
  amount: number;
  quality: number;
}

export interface AerospaceSalesOrder {
  id: number;
  resources: AerospaceSalesOrderResource[];
  searchCost: number;
  datetime: string;
  expiresAt: string;
  payout: number;
}

export interface RocketLaunchStats {
  launches: Record<string, number>;
  crashes: Record<string, number>;
}

interface DbBuildingRow {
  id: number;
  company_id: number;
  realm_id?: number;
  kind: string;
  size: number;
  category?: string;
  busy_until?: string | null;
}

interface DbLaunchQueueRow {
  id: number;
  company_id: number;
  building_id: number;
  realm_id: number;
  rocket_kind: number;
  quality: number;
  status: string;
  duration_seconds: number;
  started_at: string;
  finishes_at: string;
  created_at: string;
}

interface DbAerospaceSalesOrderRow {
  id: number;
  company_id: number;
  building_id: number;
  resources_json: string;
  search_cost: number;
  payout: number;
  created_at: string;
  expires_at: string;
  fulfilled: number;
}

// Available aerospace contract resources
const AEROSPACE_CONTRACT_RESOURCES = [
  77, // Fuselage
  78, // Wing
  79, // High-Grade E-Components
  80, // Flight Computer
  81, // Cockpit
  82, // Attitude Control
  84, // Fuel Tank
  85, // Solid Rocket
  86, // Rocket Engine
  87, // Heat Shield
  88, // Ion Drive
  89, // Jet Engine
  90, // Sub-Orbital 2nd Stage
  91, // Sub-Orbital Rocket
  92, // Orbital Booster
  93, // Starship
  94  // BFR
];

/**
 * Calculate effective launch duration according to canonical formula:
 * baseTime = 128 hours / (1 + productionModifier / 100)
 * effectiveTime = baseTime / 2^(level - 1)
 */
export function calculateLaunchDurationSeconds(level: number, productionModifier: number = 0): number {
  const safeLevel = Math.max(1, level);
  const baseTimeSeconds = (128 * 3600) / (1 + (productionModifier / 100));
  const effectiveTimeSeconds = baseTimeSeconds / Math.pow(2, safeLevel - 1);
  return Math.round(effectiveTimeSeconds);
}

/**
 * Queue a rocket launch on a Launch Pad building.
 * Validates building ownership, Launch Pad type, building level,
 * queue limit (30 max), and required rocket + research inventory.
 * Consumes resources immediately from warehouse and persists queued launch.
 */
export async function queueRocketLaunch(
  companyId: number,
  buildingId: number,
  rocketKind: number,
  quality: number = 0
): Promise<QueuedLaunchItem> {
  // 1. Fetch building and validate
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as DbBuildingRow | undefined;
  if (!building) {
    throw new Error('Building not found');
  }
  if (building.company_id !== companyId) {
    throw new Error('Building does not belong to your company');
  }
  // #156: only a real Launchpad (kind 'l') may queue rockets. Launchpad's
  // category is 'research', so matching by category admitted every lab /
  // research factory into the launch flow.
  if (building.kind !== 'l') {
    throw new Error('Building is not a Launch Pad');
  }

  // 2. Validate rocket configuration
  const config = ROCKET_CONFIGS[rocketKind];
  if (!config) {
    throw new Error(`Invalid rocket kind: ${rocketKind}. Supported kinds are 91 (Sub-Orbital Rocket) and 94 (BFR)`);
  }

  // 3. Validate building level
  const buildingLevel = Number(building.size) || 1;
  if (buildingLevel < config.minLevel) {
    throw new Error(`Requires launch pad level ${config.minLevel} or higher (current level: ${buildingLevel})`);
  }

  // 4. Validate queue capacity (maximum 30 queued launches)
  const queueCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM launch_queue
    WHERE building_id = ? AND status = 'QUEUED'
  `).get(buildingId) as { count: number };
  if (queueCountRow.count >= LAUNCH_QUEUE_MAX) {
    throw new Error(`Launch queue is full (maximum ${LAUNCH_QUEUE_MAX} queued launches)`);
  }

  // 5. Validate inventory
  const safeQuality = Math.max(0, Math.floor(quality || 0));
  const rocketStock = getWarehouseItemExact(companyId, rocketKind, safeQuality);
  if (!rocketStock || Number(rocketStock.amount) < 1) {
    throw new Error(`Insufficient rocket inventory in warehouse (resource #${rocketKind} Q${safeQuality})`);
  }

  const researchStock = getWarehouseItemExact(companyId, 100, 0);
  if (!researchStock || Number(researchStock.amount) < config.researchCost) {
    const available = Number(researchStock?.amount || 0);
    throw new Error(`Insufficient Aerospace Research (resource #100). Required: ${config.researchCost}, available: ${available}`);
  }

  // 6. Compute launch duration and scheduling
  const boostSettings = getCompanyBoostSettings(companyId);
  const prodMod = boostSettings?.productionModifier || 0;
  const durationSeconds = calculateLaunchDurationSeconds(buildingLevel, prodMod);

  const lastQueued = db.prepare(`
    SELECT finishes_at FROM launch_queue
    WHERE building_id = ? AND status = 'QUEUED'
    ORDER BY id DESC LIMIT 1
  `).get(buildingId) as { finishes_at: string } | undefined;

  const nowMs = Date.now();
  let startMs = nowMs;
  if (lastQueued && lastQueued.finishes_at) {
    const prevFinishMs = new Date(lastQueued.finishes_at).getTime();
    if (prevFinishMs > nowMs) {
      startMs = prevFinishMs;
    }
  }
  const finishMs = startMs + durationSeconds * 1000;
  const startedAt = new Date(startMs).toISOString();
  const finishesAt = new Date(finishMs).toISOString();
  const createdAt = new Date(nowMs).toISOString();

  // 7. Atomic transaction
  return runInTransaction(() => {
    // Consume rocket item from warehouse
    const consumedRocket = consumeResourceExactWithTransactions(companyId, rocketKind, safeQuality, 1);
    if (!consumedRocket) {
      throw new Error(`Failed to consume rocket resource #${rocketKind} Q${safeQuality}`);
    }

    // Consume aerospace research points from warehouse
    const consumedResearch = consumeResourceExactWithTransactions(companyId, 100, 0, config.researchCost);
    if (!consumedResearch) {
      throw new Error(`Failed to consume ${config.researchCost} Aerospace Research (resource #100)`);
    }

    // Insert launch queue record
    const insertRes = db.prepare(`
      INSERT INTO launch_queue (company_id, building_id, realm_id, rocket_kind, quality, status, duration_seconds, started_at, finishes_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)
    `).run(companyId, buildingId, building.realm_id || 0, rocketKind, safeQuality, durationSeconds, startedAt, finishesAt, createdAt);

    const launchId = Number(insertRes.lastInsertRowid);

    // Update building busy_until if needed
    if (!building.busy_until || new Date(building.busy_until).getTime() < finishMs) {
      db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(finishesAt, buildingId);
    }

    return {
      id: launchId,
      buildingId,
      companyId,
      rocketKind,
      quality: safeQuality,
      status: 'QUEUED',
      started: startedAt,
      finishes: finishesAt,
      finishes_at: finishesAt,
      duration: durationSeconds,
      createdAt
    };
  }, { immediate: true });
}

/**
 * Cancel a queued launch before it starts.
 * Refunds rocket item and aerospace research points back to the company's warehouse.
 */
export async function cancelQueuedLaunch(
  companyId: number,
  buildingId: number,
  launchId?: number
): Promise<{
  success: boolean;
  message: string;
  id: number;
  status: string;
  refunded: {
    rocketKind: number;
    quality: number;
    amount: number;
    researchPoints: number;
  };
}> {
  // 1. Fetch building and validate
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as DbBuildingRow | undefined;
  if (!building) {
    throw new Error('Building not found');
  }
  if (building.company_id !== companyId) {
    throw new Error('Building does not belong to your company');
  }

  // 2. Find target queued launch
  let targetLaunch: DbLaunchQueueRow | undefined;
  if (launchId !== undefined && launchId !== null) {
    targetLaunch = db.prepare(`
      SELECT * FROM launch_queue
      WHERE id = ? AND building_id = ? AND company_id = ? AND status = 'QUEUED'
    `).get(launchId, buildingId, companyId) as DbLaunchQueueRow | undefined;
  } else {
    targetLaunch = db.prepare(`
      SELECT * FROM launch_queue
      WHERE building_id = ? AND company_id = ? AND status = 'QUEUED'
      ORDER BY id DESC LIMIT 1
    `).get(buildingId, companyId) as DbLaunchQueueRow | undefined;
  }
  if (!targetLaunch) {
    throw new Error('Queued launch not found or already started/cancelled');
  }

  const config = ROCKET_CONFIGS[targetLaunch.rocket_kind];
  const researchCost = config?.researchCost || (targetLaunch.rocket_kind === 94 ? 2800 : 400);

  return runInTransaction(() => {
    // Mark as cancelled
    db.prepare(`UPDATE launch_queue SET status = 'CANCELLED' WHERE id = ?`).run(targetLaunch.id);

    // Refund rocket to warehouse
    addResource(companyId, targetLaunch.rocket_kind, targetLaunch.quality, 1);

    // Refund research units to warehouse
    addResource(companyId, 100, 0, researchCost);

    // Re-sequence subsequent queued launches if any
    const remaining = db.prepare(`
      SELECT * FROM launch_queue
      WHERE building_id = ? AND status = 'QUEUED'
      ORDER BY id ASC
    `).all(buildingId) as unknown as DbLaunchQueueRow[];

    const nowMs = Date.now();
    let currentStartMs = nowMs;
    for (const item of remaining) {
      const durationMs = Number(item.duration_seconds) * 1000;
      const newStartAt = new Date(currentStartMs).toISOString();
      const newFinishAt = new Date(currentStartMs + durationMs).toISOString();
      db.prepare(`
        UPDATE launch_queue
        SET started_at = ?, finishes_at = ?
        WHERE id = ?
      `).run(newStartAt, newFinishAt, item.id);
      currentStartMs += durationMs;
    }

    // Update building busy_until
    if (remaining.length > 0) {
      const lastFinish = new Date(currentStartMs).toISOString();
      db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(lastFinish, buildingId);
    } else {
      db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(buildingId);
    }

    return {
      success: true,
      message: 'Launch cancelled successfully',
      id: targetLaunch.id,
      status: 'CANCELLED',
      refunded: {
        rocketKind: targetLaunch.rocket_kind,
        quality: targetLaunch.quality,
        amount: 1,
        researchPoints: researchCost
      }
    };
  }, { immediate: true });
}

/**
 * Get company's active launch queue.
 */
export function getCompanyLaunchQueue(companyId: number, buildingId?: number): QueuedLaunchItem[] {
  let query = `SELECT * FROM launch_queue WHERE company_id = ? AND status = 'QUEUED'`;
  const params: unknown[] = [companyId];
  if (buildingId) {
    query += ` AND building_id = ?`;
    params.push(buildingId);
  }
  query += ` ORDER BY id ASC`;

  const rows = db.prepare(query).all(...params) as unknown as DbLaunchQueueRow[];
  return rows.map(r => ({
    id: r.id,
    buildingId: r.building_id,
    companyId: r.company_id,
    rocketKind: r.rocket_kind,
    quality: Number(r.quality) || 0,
    status: r.status,
    started: r.started_at,
    finishes: r.finishes_at,
    finishes_at: r.finishes_at,
    duration: Number(r.duration_seconds),
    createdAt: r.created_at
  }));
}

// Pre-seeded baseline stats for launches and crashes
export function getRocketLaunchStats(
  realmId: number,
  companyId?: number | null,
  isMe: boolean = false
): RocketLaunchStats {
  const launches: Record<string, number> = {};
  const crashes: Record<string, number> = {};

  // Baseline global simulated activity
  if (!isMe && (!companyId || companyId === 0)) {
    const baseLaunches91: Record<number, number> = { 0: 450, 1: 320, 2: 210, 3: 140, 4: 85, 5: 42, 6: 18 };
    const baseLaunches94: Record<number, number> = { 0: 180, 1: 140, 2: 95, 3: 60, 4: 35, 5: 16, 6: 8 };

    for (const [qStr, count] of Object.entries(baseLaunches91)) {
      const q = Number(qStr);
      const key = `91-${q}`;
      const failProb = 0.5 / Math.pow(2, q);
      const crashCount = Math.round(count * failProb);
      launches[key] = count;
      crashes[key] = crashCount;
    }

    for (const [qStr, count] of Object.entries(baseLaunches94)) {
      const q = Number(qStr);
      const key = `94-${q}`;
      const failProb = 0.5 / Math.pow(2, q);
      const crashCount = Math.round(count * failProb);
      launches[key] = count;
      crashes[key] = crashCount;
    }
  }

  // Include DB recorded launches
  let query = 'SELECT rocket_kind, quality, success FROM rocket_launches WHERE realm_id = ?';
  const params: unknown[] = [realmId];
  if (companyId) {
    query += ' AND company_id = ?';
    params.push(companyId);
  }

  const rows = db.prepare(query).all(...params) as unknown as Array<{
    rocket_kind: number;
    quality: number;
    success: number;
  }>;

  for (const r of rows) {
    const key = `${r.rocket_kind}-${r.quality}`;
    launches[key] = (launches[key] || 0) + 1;
    if (r.success === 0) {
      crashes[key] = (crashes[key] || 0) + 1;
    }
  }

  return { launches, crashes };
}

// Execute rocket launch immediately (direct/legacy)
export function launchRocket(
  companyId: number,
  realmId: number,
  buildingId: number,
  rocketKind: number,
  quality: number = 0
): { success: boolean; message: string; patentsEarned: number } {
  // Consumes rocket from inventory
  if (!consumeResourceExactWithTransactions(companyId, rocketKind, quality, 1)) {
    return { success: false, message: 'Rocket not found in warehouse', patentsEarned: 0 };
  }

  // Failure probability: 0.5 / 2^quality
  const failureProb = 0.5 / Math.pow(2, quality);
  const isCrash = Math.random() < failureProb;
  const success = !isCrash;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO rocket_launches (company_id, realm_id, building_id, rocket_kind, quality, success, launched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(companyId, realmId, buildingId, rocketKind, quality, success ? 1 : 0, now);

  const patents = success ? (rocketKind === 94 ? 28 : 4) : 0;
  return {
    success,
    message: success ? 'Rocket launched successfully!' : 'Rapid Unscheduled Disassembly (Rocket explosion on launchpad)',
    patentsEarned: patents
  };
}

// Parse DB row into AerospaceSalesOrder
function parseSalesOrderRow(row: DbAerospaceSalesOrderRow): AerospaceSalesOrder {
  let resources: AerospaceSalesOrderResource[] = [];
  try {
    resources = JSON.parse(row.resources_json || '[]');
  } catch {
    resources = [];
  }
  return {
    id: row.id,
    resources,
    searchCost: row.search_cost,
    datetime: row.created_at,
    expiresAt: row.expires_at,
    payout: row.payout
  };
}

// Get active sales orders for a sales office building
export function getAerospaceSalesOrders(buildingId: number, companyId: number): AerospaceSalesOrder[] {
  let orders = db.prepare(`
    SELECT * FROM aerospace_sales_orders
    WHERE building_id = ? AND fulfilled = 0
  `).all(buildingId) as unknown as DbAerospaceSalesOrderRow[];

  // Generate starter orders if none exist
  if (orders.length === 0) {
    generateNewSalesOrder(buildingId, companyId, false);
    orders = db.prepare(`
      SELECT * FROM aerospace_sales_orders
      WHERE building_id = ? AND fulfilled = 0
    `).all(buildingId) as unknown as DbAerospaceSalesOrderRow[];
  }

  return orders.map(parseSalesOrderRow);
}

// Generate new random sales order
export function generateNewSalesOrder(
  buildingId: number,
  companyId: number,
  chargeSearchCost: boolean = true
): AerospaceSalesOrder {
  const searchCost = 750;
  if (chargeSearchCost) {
    updateCompanyMoney(companyId, -searchCost);
  }

  const count = 1 + Math.floor(Math.random() * 2);
  const items: AerospaceSalesOrderResource[] = [];
  let totalBaseCost = 0;

  for (let i = 0; i < count; i++) {
    const kind = AEROSPACE_CONTRACT_RESOURCES[Math.floor(Math.random() * AEROSPACE_CONTRACT_RESOURCES.length)];
    const def = getResourceDef(kind);
    const cost = (def && typeof (def as { cost?: number }).cost === 'number') ? (def as { cost?: number }).cost! : 1000;
    const amount = Math.max(1, Math.floor(10000 / cost));
    const quality = Math.floor(Math.random() * 2);
    items.push({ kind, amount, quality });
    totalBaseCost += cost * amount * (1 + quality * 0.15);
  }

  const payout = Math.round(totalBaseCost * 1.45 * 100) / 100;
  const now = new Date();
  const expires = new Date(now.getTime() + 47 * 3600 * 1000); // 47 hours expiration

  const insertRes = db.prepare(`
    INSERT INTO aerospace_sales_orders (company_id, building_id, resources_json, search_cost, payout, created_at, expires_at, fulfilled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(companyId, buildingId, JSON.stringify(items), searchCost, payout, now.toISOString(), expires.toISOString());

  return {
    id: Number(insertRes.lastInsertRowid),
    resources: items,
    searchCost,
    datetime: now.toISOString(),
    expiresAt: expires.toISOString(),
    payout
  };
}

export function fulfillAerospaceSalesOrder(
  buildingId: number,
  orderId: number,
  companyId: number
): { success: boolean; error?: string; payout: number; newMoney?: number } {
  const row = db.prepare('SELECT * FROM aerospace_sales_orders WHERE id = ? AND building_id = ? AND fulfilled = 0')
    .get(orderId, buildingId) as DbAerospaceSalesOrderRow | undefined;

  if (!row) {
    return { success: false, error: 'Sales order not found or already fulfilled', payout: 0 };
  }

  const order = parseSalesOrderRow(row);

  // Check warehouse stock for all items
  for (const item of order.resources) {
    const stock = getWarehouseItemExact(companyId, item.kind, item.quality);
    if (!stock || Number(stock.amount) < item.amount || Number(stock.quality) < item.quality) {
      return { success: false, error: `Required quality Q${item.quality} and quantity (${item.amount}) for resource #${item.kind} not met`, payout: 0 };
    }
  }

  // Consume resources
  for (const item of order.resources) {
    if (!consumeResourceExactWithTransactions(companyId, item.kind, item.quality, item.amount)) {
      return { success: false, error: `Insufficient inventory for resource #${item.kind}`, payout: 0 };
    }
  }

  // Credit money
  const newMoney = updateCompanyMoney(companyId, order.payout);

  db.prepare('UPDATE aerospace_sales_orders SET fulfilled = 1 WHERE id = ?').run(orderId);

  return {
    success: true,
    payout: order.payout,
    newMoney
  };
}
