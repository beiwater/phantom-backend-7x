import { db } from '../db/database.ts';
import {
  CONSTANTS_BUILDINGS,
  CONSTRUCTION_MATERIALS,
  DEMOLITION_REFUND_RATE,
  getResourceDef
} from './constants.ts';
import { getWarehouseItemExact, consumeResourceExactWithTransactions } from './warehouse.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';
import { extraSlotIndex } from '../domain/buildings/building-rules.ts';

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
  const busyUntilMs = b.busy_until ? new Date(b.busy_until).getTime() : 0;
  const isConstructingOrUpgrading = busyUntilMs > Date.now();

  let busyObj: Record<string, unknown> | null = getProductionBusy(b.id);
  if (!busyObj && isConstructingOrUpgrading) {
    const duration = 10;
    const startedMs = busyUntilMs - duration * 1000;
    busyObj = {
      id: b.id,
      started: new Date(startedMs).toISOString(),
      duration,
      category: 'b',
      expanding: true,
      canFetch: false
    };
  }

  return {
    id: b.id,
    busy: busyObj,
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
    isUnderConstruction: isConstructingOrUpgrading,
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
function validateConstructionMaterials(companyId: number, sizeUnits: number) {
  const materials = getConstructionMaterials(sizeUnits);
  for (const req of materials) {
    const stock = getWarehouseItemExact(companyId, req.kind, 0);
    if (!stock || Number(stock.amount) < req.amount) {
      throw new Error(`Insufficient construction materials: need ${req.amount} of resource #${req.kind}`);
    }
  }
  return materials;
}


export function constructBuilding(companyId: number, kind: string, position: string, replaceExisting = false) {
  const meta = getBuildingMeta(kind);
  if (!BUILDING_NAMES[kind] && !CONSTANTS_BUILDINGS[kind]) {
    throw new Error(`Unknown building kind: ${kind}`);
  }
  const comp = getCompanyById(companyId);
  if (!comp || comp.money < meta.cost) {
    throw new Error('Not enough money to construct building');
  }

  const baseSlots = Math.min(14, 4 + Math.floor((Number(comp.level) || 0) / 3));
  const maxSlots = baseSlots + (Number(comp.extra_building_slots) || 0);
  // P0-07: "B<n>" lots are star-unlocked slots, unlocked when n < extra_building_slots.
  const extraIndex = extraSlotIndex(String(position));
  if (extraIndex !== null) {
    if (extraIndex >= (Number(comp.extra_building_slots) || 0)) {
      throw new Error(`Position ${position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`);
    }
  } else {
    const posNum = Number(String(position));
    if (Number.isInteger(posNum) && posNum >= maxSlots) {
      throw new Error(`Position ${position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`);
    }
  }

  const currentCount = (db.prepare('SELECT COUNT(*) as count FROM buildings WHERE company_id = ?').get(companyId) as { count: number }).count;
  const existing = db.prepare(`
    SELECT id, busy_until FROM buildings WHERE company_id = ? AND position = ?
  `).get(companyId, String(position)) as { id: number; busy_until: string | null } | undefined;

  if (!existing && currentCount >= maxSlots) {
    throw new Error(`Building slot limit reached (${currentCount}/${maxSlots}). Unlock more building slots with SimBoosts.`);
  }

  const materials = validateConstructionMaterials(companyId, 1);
  if (existing) {
    if (!replaceExisting) {
      throw new Error('Building position is already occupied');
    }
    const pending = db.prepare(`
      SELECT COUNT(*) AS count FROM production_queues
      WHERE building_id = ? AND company_id = ? AND resolved = 0
    `).get(existing.id, companyId) as { count: number };
    const retailOrders = db.prepare(`
      SELECT COUNT(*) AS count FROM retail_orders
      WHERE building_id = ? AND company_id = ?
    `).get(existing.id, companyId) as { count: number };
    if (pending.count > 0 || retailOrders.count > 0) {
      throw new Error('Position has active building work');
    }
    if (existing.busy_until && new Date(existing.busy_until).getTime() > Date.now()) {
      throw new Error('Building is still under construction or upgrade');
    }
  }

  const consumedMaterials: Array<{ db_letter: number; quality: number; amount: number }> = [];
  let newMoney = comp.money;
  const now = new Date().toISOString();
  const busyUntil = new Date(Date.now() + 10000).toISOString();

  db.exec('BEGIN');
  try {
    for (const req of materials) {
      const transactions = consumeResourceExactWithTransactions(companyId, req.kind, 0, req.amount);
      if (!transactions) {
        throw new Error(`Insufficient construction materials: need ${req.amount} of resource #${req.kind}`);
      }
      consumedMaterials.push({ db_letter: req.kind, quality: 0, amount: req.amount });
    }

    newMoney = updateCompanyMoney(companyId, -meta.cost);
    if (existing && replaceExisting) {
      db.prepare('DELETE FROM production_queues WHERE building_id = ? AND company_id = ?')
        .run(existing.id, companyId);
      db.prepare('DELETE FROM retail_orders WHERE building_id = ? AND company_id = ?')
        .run(existing.id, companyId);
      db.prepare('DELETE FROM buildings WHERE id = ? AND company_id = ?')
        .run(existing.id, companyId);
    }

    const result = db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, busy_until, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(companyId, String(position), String(kind), String(meta.name), Number(meta.cost), String(meta.category), busyUntil, now);

    db.exec('COMMIT');
    const newId = Number(result.lastInsertRowid);
    const building = getBuildingById(newId);

    return {
      building: building ? formatBuilding(building) : null,
      cost: meta.cost,
      moneyUpdate: newMoney,
      resourcesConsumed: consumedMaterials
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function upgradeBuilding(companyId: number, buildingId: number, sizeDelta: number) {
  if (!Number.isSafeInteger(sizeDelta) || sizeDelta <= 0) {
    throw new Error('Building size change must be a positive integer');
  }

  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }
  if (building.busy_until && new Date(building.busy_until).getTime() > Date.now()) {
    throw new Error('Building is still under construction or upgrade');
  }

  const meta = getBuildingMeta(building.kind);
  const newSize = building.size + sizeDelta;
  const maxSize = 15;
  if (!Number.isSafeInteger(building.size) || newSize > maxSize) {
    throw new Error(`Building level must be between 1 and ${maxSize}`);
  }

  const cost = (meta.cost || 6900) * sizeDelta;
  const comp = getCompanyById(companyId);
  if (!comp || comp.money < cost) {
    throw new Error('Not enough money to upgrade building');
  }

  const materials = validateConstructionMaterials(companyId, sizeDelta);
  const consumedMaterials: Array<{ db_letter: number; quality: number; amount: number }> = [];
  const busyUntil = new Date(Date.now() + 10000).toISOString();
  let newMoney = comp.money;

  db.exec('BEGIN');
  try {
    for (const req of materials) {
      const transactions = consumeResourceExactWithTransactions(companyId, req.kind, 0, req.amount);
      if (!transactions) {
        throw new Error(`Insufficient construction materials: need ${req.amount} of resource #${req.kind}`);
      }
      consumedMaterials.push({ db_letter: req.kind, quality: 0, amount: req.amount });
    }

    newMoney = updateCompanyMoney(companyId, -cost);
    const updated = db.prepare(`
      UPDATE buildings SET size = ?, busy_until = ?
      WHERE id = ? AND company_id = ?
    `).run(newSize, busyUntil, buildingId, companyId);
    if (updated.changes !== 1) throw new Error('Building not found');
    db.exec('COMMIT');

    const latest = getBuildingById(buildingId);
    return {
      building: latest ? formatBuilding(latest) : null,
      cost,
      moneyUpdate: newMoney,
      resourcesConsumed: consumedMaterials
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


export function demolishBuilding(companyId: number, buildingId: number) {
  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  const refund = Math.round(building.cost * DEMOLITION_REFUND_RATE);
  db.exec('BEGIN IMMEDIATE');
  try {
    const deleted = db.prepare('DELETE FROM buildings WHERE id = ? AND company_id = ?')
      .run(buildingId, companyId);
    if (deleted.changes !== 1) {
      throw new Error('Building not found');
    }
    db.prepare('DELETE FROM production_queues WHERE building_id = ? AND company_id = ?')
      .run(buildingId, companyId);
    db.prepare('DELETE FROM retail_orders WHERE building_id = ? AND company_id = ?')
      .run(buildingId, companyId);
    const moneyUpdate = updateCompanyMoney(companyId, refund);
    db.exec('COMMIT');

    return {
      success: true,
      moneyUpdate,
      building: {
        id: building.id,
        position: String(building.position),
        size: 0
      }
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
