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
    ORDER BY kind ASC, quality ASC
  `).all(companyId) as unknown as WarehouseRow[];

  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    quality: Number(r.quality) || 0,
    amount: Number(r.amount) || 0,
    blocked: false,
    cost: {
      workers: Number(r.cost_workers) || 0,
      admin: Number(r.cost_admin) || 0,
      material1: Number(r.cost_material1) || 0,
      material2: Number(r.cost_material2) || 0,
      material3: 0,
      material4: 0,
      material5: 0,
      market: Number(r.cost_market) || 1.0
    },
    datetime: r.updated_at || new Date().toISOString(),
    materials: ["", "", "", "", ""]
  }));
}

export function getWarehouseItem(companyId: number, kind: number, quality: number = 0): WarehouseRow | null {
  const row = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?
  `).get(companyId, kind, quality) as unknown as WarehouseRow | undefined;

  if (row) return row;

  // Fallback to any available quality tier
  const anyRow = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND amount > 0 ORDER BY quality ASC LIMIT 1
  `).get(companyId, kind) as unknown as WarehouseRow | undefined;

  return anyRow || null;
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
  const existing = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?
  `).get(companyId, kind, quality) as unknown as WarehouseRow | undefined;

  const now = new Date().toISOString();

  if (existing) {
    const newAmount = (Number(existing.amount) || 0) + amount;
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
      cost.market || 1.0,
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
      cost_market: cost.market || 1.0,
      updated_at: now
    };
  }
}

export function consumeResource(companyId: number, kind: number, quality: number, amount: number): boolean {
  let remainingNeeded = amount;
  const now = new Date().toISOString();

  // Try exact quality first
  const exact = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ? AND amount > 0
  `).get(companyId, kind, quality) as unknown as WarehouseRow | undefined;

  if (exact) {
    const take = Math.min(exact.amount, remainingNeeded);
    const newAmount = exact.amount - take;
    db.prepare('UPDATE warehouse SET amount = ?, updated_at = ? WHERE id = ?').run(newAmount, now, exact.id);
    remainingNeeded -= take;
  }

  if (remainingNeeded <= 0) return true;

  // Consume from other available qualities
  const rows = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND amount > 0 ORDER BY quality ASC
  `).all(companyId, kind) as unknown as WarehouseRow[];

  for (const row of rows) {
    if (remainingNeeded <= 0) break;
    const take = Math.min(row.amount, remainingNeeded);
    const newAmount = row.amount - take;
    db.prepare('UPDATE warehouse SET amount = ?, updated_at = ? WHERE id = ?').run(newAmount, now, row.id);
    remainingNeeded -= take;
  }

  return remainingNeeded <= 0;
}
