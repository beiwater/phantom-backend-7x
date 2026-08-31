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

export interface ResourceTransaction {
  kind: number;
  dbLetter: number;
  quality: number;
  delta: number;
  amount: number;
  /** Per-unit total cost of the consumed stock (workers+admin+materials+market). */
  cost?: number;
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
export function getWarehouseItemExact(companyId: number, kind: number, quality: number): WarehouseRow | null {
  const row = db.prepare(`
    SELECT * FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?
  `).get(companyId, kind, quality) as unknown as WarehouseRow | undefined;

  return row || null;
}

export function consumeResourceExactWithTransactions(
  companyId: number,
  kind: number,
  quality: number,
  amount: number
): ResourceTransaction[] | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const row = getWarehouseItemExact(companyId, kind, quality);
  if (!row || Number(row.amount) < amount) return null;

  const now = new Date().toISOString();
  const newAmount = Number(row.amount) - amount;
  const result = db.prepare(`
    UPDATE warehouse
    SET amount = ?, updated_at = ?
    WHERE id = ? AND amount >= ?
  `).run(newAmount, now, row.id, amount);
  if (result.changes !== 1) return null;

  return [{
    kind,
    dbLetter: kind,
    quality,
    delta: -amount,
    amount: -amount,
    cost: (Number(row.cost_workers) || 0) + (Number(row.cost_admin) || 0) +
          (Number(row.cost_material1) || 0) + (Number(row.cost_material2) || 0) +
          (Number(row.cost_market) || 0)
  }];
}

export function consumeResourceExact(companyId: number, kind: number, quality: number, amount: number): boolean {
  return consumeResourceExactWithTransactions(companyId, kind, quality, amount) !== null;
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
  const incomingCost = Number(cost.market ?? 1);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Resource amount must be a positive finite number');
  }
  if (!Number.isFinite(incomingCost) || incomingCost < 0) {
    throw new Error('Resource cost must be a non-negative finite number');
  }

  if (existing) {
    const existingAmount = Number(existing.amount) || 0;
    const existingCost = Number(existing.cost_market);
    const safeExistingCost = Number.isFinite(existingCost) && existingCost >= 0 ? existingCost : 1;
    const newAmount = existingAmount + amount;
    const weightedCost = newAmount > 0
      ? ((existingAmount * safeExistingCost) + (amount * incomingCost)) / newAmount
      : incomingCost;
    db.prepare(`
      UPDATE warehouse
      SET amount = ?, cost_market = ?, updated_at = ?
      WHERE id = ?
    `).run(newAmount, weightedCost, now, existing.id);
    return { ...existing, amount: newAmount, cost_market: weightedCost, updated_at: now };
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
      cost.market ?? 1.0,
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
      cost_market: cost.market ?? 1.0,
      updated_at: now
    };
  }
}

export function consumeResourceWithTransactions(
  companyId: number,
  kind: number,
  quality: number,
  amount: number
): ResourceTransaction[] | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const rows = db.prepare(`
    SELECT * FROM warehouse
    WHERE company_id = ? AND kind = ? AND amount > 0
    ORDER BY CASE WHEN quality = ? THEN 0 ELSE 1 END, quality ASC, id ASC
  `).all(companyId, kind, quality) as unknown as WarehouseRow[];

  const availableAmount = rows.reduce((total, row) => total + Number(row.amount || 0), 0);
  if (availableAmount < amount) return null;

  let remainingNeeded = amount;
  const now = new Date().toISOString();
  const transactions: ResourceTransaction[] = [];

  for (const row of rows) {
    if (remainingNeeded <= 0) break;
    const takenAmount = Math.min(Number(row.amount), remainingNeeded);
    const newAmount = Number(row.amount) - takenAmount;
    db.prepare('UPDATE warehouse SET amount = ?, updated_at = ? WHERE id = ?').run(newAmount, now, row.id);
    remainingNeeded -= takenAmount;
    transactions.push({
      kind,
      dbLetter: kind,
      quality: Number(row.quality) || 0,
      delta: -takenAmount,
      amount: -takenAmount,
      cost: (Number(row.cost_workers) || 0) + (Number(row.cost_admin) || 0) +
            (Number(row.cost_material1) || 0) + (Number(row.cost_material2) || 0) +
            (Number(row.cost_market) || 0)
    });
  }

  return transactions;
}

export function consumeResource(companyId: number, kind: number, quality: number, amount: number): boolean {
  return consumeResourceWithTransactions(companyId, kind, quality, amount) !== null;
}
