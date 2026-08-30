import { db } from '../db/database.ts';
import { getResourceDef } from './constants.ts';
import { updateCompanyMoney } from './company.ts';
import { consumeResource, getWarehouseItem } from './warehouse.ts';

// Initialize Aerospace & Rocket Launch tables
db.exec(`
  CREATE TABLE IF NOT EXISTS rocket_launches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    realm_id INTEGER DEFAULT 0,
    building_id INTEGER,
    rocket_kind INTEGER,
    quality INTEGER DEFAULT 0,
    success INTEGER DEFAULT 1,
    launched_at TEXT
  );

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

// Pre-seeded baseline stats for launches and crashes
export function getRocketLaunchStats(
  realmId: number,
  companyId?: number | null,
  isMe: boolean = false
): RocketLaunchStats {
  const launches: Record<string, number> = {};
  const crashes: Record<string, number> = {};

  // Baseline global simulated activity
  if (!isMe) {
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
  if (isMe && companyId) {
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

// Execute rocket launch
export function launchRocket(
  companyId: number,
  realmId: number,
  buildingId: number,
  rocketKind: number,
  quality: number = 0
): { success: boolean; message: string; patentsEarned: number } {
  // Consumes rocket from inventory
  if (!consumeResource(companyId, rocketKind, quality, 1)) {
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
    const cost = def?.cost || 1000;
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
    const stock = getWarehouseItem(companyId, item.kind, item.quality);
    if (!stock || stock.amount < item.amount || stock.quality < item.quality) {
      return { success: false, error: `Required quality Q${item.quality} and quantity (${item.amount}) for resource #${item.kind} not met`, payout: 0 };
    }
  }

  // Consume resources
  for (const item of order.resources) {
    if (!consumeResource(companyId, item.kind, item.quality, item.amount)) {
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
