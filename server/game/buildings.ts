import { db } from '../db/database.ts';
import {
  CONSTANTS_BUILDINGS,
  CONSTRUCTION_MATERIALS,
  DEMOLITION_REFUND_RATE,
  getResourceDef
} from './constants.ts';
import { getWarehouseItem, consumeResource } from './warehouse.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';

export interface BuildingRow {
  id: number;
  company_id: number;
  position: string;
  kind: string;
  size: number;
  name: string;
  cost: number;
  category: string;
  created_at: string;
  busy_until: string | null;
}

interface ProductionQueueBusyRow {
  id: number;
  kind: number;
  quality: number;
  amount: number;
  duration_seconds: number;
  started_at: string;
  finishes_at: string;
}

function getProductionBusy(buildingId: number) {
  const queue = db.prepare(`
    SELECT id, kind, quality, amount, duration_seconds, started_at, finishes_at
    FROM production_queues
    WHERE building_id = ? AND resolved = 0
    ORDER BY id DESC
    LIMIT 1
  `).get(buildingId) as ProductionQueueBusyRow | undefined;

  if (!queue) return null;

  const resource = getResourceDef(queue.kind);
  const canFetch = new Date(queue.finishes_at).getTime() <= Date.now();

  return {
    id: queue.id,
    started: queue.started_at,
    duration: Number(queue.duration_seconds),
    accelerationFactor: 1,
    category: 'r',
    canFetch,
    manualResolve: false,
    resource: {
      kind: queue.kind,
      quality: Number(queue.quality) || 0,
      amount: Number(queue.amount),
      amountAvailableNow: canFetch ? Number(queue.amount) : 0,
      image: resource?.image || ''
    }
  };
}

const BUILDING_NAMES: Record<string, string> = {
  P: 'Farm',
  G: 'Grocery store',
  E: 'Power plant',
  W: 'Water reservoir',
  M: 'Mine',
  Q: 'Quarry',
  F: 'Plantation',
  '6': 'Beverage factory',
  T: 'Fashion factory',
  v: 'Forest nursery',
  e: 'Slaughterhouse',
  i: 'Mill',
  j: 'Bakery',
  Y: 'Materials processing',
  g: 'General contractor',
  '8': 'Shipping depot',
  '1': 'Concrete plant',
  O: 'Oil rig',
  R: 'Refinery',
  S: 'Gas station',
  C: 'Car dealership',
  H: 'Hardware store'
};

export function getBuildingMeta(kind: string) {
  const b = CONSTANTS_BUILDINGS[kind] as { name?: string; costUnits?: number; category?: string } | undefined;
  const name = b?.name || BUILDING_NAMES[kind] || 'Building';
  const cost = b ? ((b.costUnits || 2) * 3450) : 6900;
  const category = b?.category || 'production';
  return { name, cost, category };
}

export function formatBuilding(b: BuildingRow) {
  const meta = getBuildingMeta(b.kind);
  return {
    id: b.id,
    busy: b.busy_until ? (new Date(b.busy_until).getTime() > Date.now() ? b.busy_until : null) : null,
    category: b.category || meta.category || 'production',
    company: {
      id: b.company_id,
      name: "Private Co",
      logo: ""
    },
    cost: b.cost || meta.cost || 6900,
    costUnits: 2,
    country: "AU",
    created: b.created_at || new Date().toISOString(),
    isUnderConstruction: false,
    kind: b.kind,
    level: b.size || 1,
    name: b.name || meta.name || 'Building',
    position: String(b.position),
    realm: 0,
    size: b.size || 1,
    workers: (b.size || 1) * 10
  };
}

export function getCompanyBuildings(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM buildings WHERE company_id = ? ORDER BY CAST(position AS INTEGER) ASC
  `).all(companyId) as unknown as BuildingRow[];

  return rows.map(formatBuilding);
}

export function getBuildingById(buildingId: number): BuildingRow | null {
  const row = db.prepare(`
    SELECT * FROM buildings WHERE id = ?
  `).get(buildingId) as unknown as BuildingRow | undefined;
  return row || null;
}

export function getConstructionMaterials(sizeUnits: number): Array<{ kind: number; amount: number }> {
  return CONSTRUCTION_MATERIALS.map(m => ({ kind: m.kind, amount: m.perUnit * sizeUnits }));
}

// Check all requirements, then consume; throws a clear error on any shortage
function requireMaterials(companyId: number, requirements: Array<{ kind: number; amount: number }>) {
  for (const req of requirements) {
    const stock = getWarehouseItem(companyId, req.kind, 0);
    if (!stock || stock.amount < req.amount) {
      throw new Error(`Insufficient materials: need ${req.amount} of resource #${req.kind}`);
    }
  }
  for (const req of requirements) {
    consumeResource(companyId, req.kind, 0, req.amount);
  }
}

export function constructBuilding(companyId: number, kind: string, position: string) {
  const meta = getBuildingMeta(kind);
  const comp = getCompanyById(companyId);
  if (!comp || comp.money < meta.cost) {
    throw new Error('Not enough money to construct building');
  }

  // Check and consume construction materials before deducting money
  requireMaterials(companyId, getConstructionMaterials(1));

  // Deduct money
  const newMoney = updateCompanyMoney(companyId, -meta.cost);
  const now = new Date().toISOString();
  const busyUntil = new Date(Date.now() + 10 * 1000).toISOString();

  // Clean up any old building at this position
  db.prepare('DELETE FROM buildings WHERE company_id = ? AND position = ?').run(companyId, String(position));

  const res = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, busy_until, created_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(companyId, String(position), String(kind), String(meta.name), Number(meta.cost), String(meta.category), busyUntil, now);
  const newId = Number(res.lastInsertRowid);
  const building = getBuildingById(newId);

  return {
    building: building ? formatBuilding(building) : null,
    cost: meta.cost,
    moneyUpdate: newMoney
  };
}

export function upgradeBuilding(companyId: number, buildingId: number, sizeDelta: number) {
  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  const meta = getBuildingMeta(building.kind);
  const unitCost = meta.cost || 5000;

  if (sizeDelta > 0) {
    // Upgrade: cost scales with the target size, charged once for the whole delta
    const cost = unitCost * sizeDelta;
    const comp = getCompanyById(companyId);
    if (!comp || comp.money < cost) {
      throw new Error('Not enough money to upgrade building');
    }

    // Check and consume construction materials before deducting money
    requireMaterials(companyId, getConstructionMaterials(sizeDelta));

    const newMoney = updateCompanyMoney(companyId, -cost);
    const newSize = building.size + sizeDelta;
    const busyUntil = new Date(Date.now() + 10 * 1000).toISOString();
    db.prepare('UPDATE buildings SET size = ?, busy_until = ? WHERE id = ?').run(newSize, busyUntil, buildingId);
    const updated = getBuildingById(buildingId);
    return {
      building: updated ? formatBuilding(updated) : null,
      cost,
      moneyUpdate: newMoney
    };
  } else {
    // Downgrade
    const newSize = Math.max(1, building.size + sizeDelta);
    db.prepare('UPDATE buildings SET size = ? WHERE id = ?').run(newSize, buildingId);
    const updated = getBuildingById(buildingId);

    return {
      building: updated ? formatBuilding(updated) : null,
      cost: 0,
      moneyUpdate: getCompanyById(companyId)?.money || 0
    };
  }
}

export function demolishBuilding(companyId: number, buildingId: number) {
  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  // Refund a proportional share of the building cost
  const refund = Math.round(building.cost * DEMOLITION_REFUND_RATE);
  const moneyUpdate = updateCompanyMoney(companyId, refund);

  db.prepare('DELETE FROM buildings WHERE id = ?').run(buildingId);
  db.prepare('DELETE FROM production_queues WHERE building_id = ?').run(buildingId);
  db.prepare('DELETE FROM retail_orders WHERE building_id = ?').run(buildingId);

  return {
    success: true,
    moneyUpdate,
    building: {
      id: building.id,
      position: String(building.position),
      size: 0
    }
  };
}
