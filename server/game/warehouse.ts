import { db } from '../db/database.ts';

export interface WarehouseRow {
  id: number;
  company_id: number;
  kind: number;
  quality: number;
  amount: number;
  cost_workers: number;
  cost_admin: number;
  cost_material1: number;
  cost_material2: number;
  cost_market: number;
  updated_at: string;
}

export function getWarehouseResources(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND amount > 0
  `).all(companyId) as unknown as WarehouseRow[];

  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    quality: r.quality,
    amount: r.amount,
    blocked: false,
    cost: {
      workers: r.cost_workers,
      admin: r.cost_admin,
      material1: r.cost_material1,
      material2: r.cost_material2,
      material3: 0,
      material4: 0,
      material5: 0,
      market: r.cost_market
    },
    datetime: r.updated_at,
    materials: ["", "", "", "", ""]
  }));
}

export function getWarehouseItem(companyId: number, kind: number, quality: number = 0): WarehouseRow | null {
  const row = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?
  `).get(companyId, kind, quality) as unknown as WarehouseRow | undefined;
  return row || null;
}

export function getWarehouseItemById(id: number): WarehouseRow | null {
  const row = db.prepare(`
    SELECT * FROM warehouse WHERE id = ?
  `).get(id) as unknown as WarehouseRow | undefined;
  return row || null;
}

export function addResource(
  companyId: number,
  kind: number,
  quality: number,
  amount: number,
  cost: { workers?: number; admin?: number; material1?: number; material2?: number; market?: number } = {}
): WarehouseRow {
  const existing = getWarehouseItem(companyId, kind, quality);
  const now = new Date().toISOString();

  if (existing) {
    const newAmount = existing.amount + amount;
    db.prepare(`
      UPDATE warehouse
      SET amount = ?, updated_at = ?
      WHERE id = ?
    `).run(newAmount, now, existing.id);
    return { ...existing, amount: newAmount, updated_at: now };
  } else {
    const res = db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      companyId,
      kind,
      quality,
      amount,
      cost.workers || 0,
      cost.admin || 0,
      cost.material1 || 0,
      cost.material2 || 0,
      cost.market || 0,
      now
    );
    return {
      id: Number(res.lastInsertRowid),
      company_id: companyId,
      kind,
      quality,
      amount,
      cost_workers: cost.workers || 0,
      cost_admin: cost.admin || 0,
      cost_material1: cost.material1 || 0,
      cost_material2: cost.material2 || 0,
      cost_market: cost.market || 0,
      updated_at: now
    };
  }
}

export function consumeResource(companyId: number, kind: number, quality: number, amount: number): boolean {
  const item = getWarehouseItem(companyId, kind, quality);
  if (!item || item.amount < amount) {
    return false;
  }
  const newAmount = item.amount - amount;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE warehouse
    SET amount = ?, updated_at = ?
    WHERE id = ?
  `).run(newAmount, now, item.id);
  return true;
}
