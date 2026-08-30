import { db } from '../db/database.ts';
import { getBuildingMeta, CONSTANTS_BUILDINGS } from './constants.ts';
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
  busy_until: string | null;
  created_at: string;
}

export function formatBuilding(b: BuildingRow) {
  const meta = getBuildingMeta(b.kind);
  const def = CONSTANTS_BUILDINGS[b.kind];
  let image = meta.image;
  if (def && def.levelImages) {
    const matched = def.levelImages.find(l => l.level === b.size) || def.levelImages[0];
    if (matched) image = matched.image;
  }

  return {
    id: b.id,
    kind: b.kind,
    position: String(b.position),
    image: image,
    category: b.category || meta.category,
    freeAndLocked: false,
    name: b.name || meta.name,
    cost: b.cost || meta.cost,
    size: b.size || 1,
    busy_until: b.busy_until
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

export function constructBuilding(companyId: number, kind: string, position: string) {
  const meta = getBuildingMeta(kind);
  const comp = getCompanyById(companyId);
  if (!comp || comp.money < meta.cost) {
    throw new Error('Not enough money to construct building');
  }

  // Deduct money
  const newMoney = updateCompanyMoney(companyId, -meta.cost);
  const now = new Date().toISOString();

  const res = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(companyId, String(position), kind, meta.name, meta.cost, meta.category, now);

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
    // Upgrade
    const comp = getCompanyById(companyId);
    if (!comp || comp.money < unitCost) {
      throw new Error('Not enough money to upgrade building');
    }
    const newMoney = updateCompanyMoney(companyId, -unitCost);
    const newSize = building.size + sizeDelta;
    db.prepare('UPDATE buildings SET size = ? WHERE id = ?').run(newSize, buildingId);
    const updated = getBuildingById(buildingId);

    return {
      building: updated ? formatBuilding(updated) : null,
      money: newMoney,
      resourcesConsumed: []
    };
  } else {
    // Downgrade
    const newSize = Math.max(1, building.size + sizeDelta);
    const refund = Math.round(unitCost * 0.8);
    const newMoney = updateCompanyMoney(companyId, refund);
    db.prepare('UPDATE buildings SET size = ? WHERE id = ?').run(newSize, buildingId);
    const updated = getBuildingById(buildingId);

    return {
      building: updated ? formatBuilding(updated) : null,
      money: newMoney,
      resources: []
    };
  }
}

export function demolishBuilding(companyId: number, buildingId: number) {
  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  const meta = getBuildingMeta(building.kind);
  const unitCost = meta.cost || 5000;
  const refund = Math.round(unitCost * building.size * 0.8);

  const newMoney = updateCompanyMoney(companyId, refund);
  db.prepare('DELETE FROM buildings WHERE id = ?').run(buildingId);
  db.prepare('DELETE FROM production_queues WHERE building_id = ?').run(buildingId);

  return {
    buildingId,
    money: newMoney,
    resources: []
  };
}
