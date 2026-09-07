import type { ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { db as database } from '../../db/database.ts';

/**
 * P0-02: every numeric field consumed by the original frontend must be a
 * finite number — `undefined`/`null` flow into `unitCost * amount` and render
 * as "$NaN". Missing persisted values fall back to on-the-fly computation
 * from current warehouse/recipe data rather than returning null.
 */
export function finiteOr(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Fallback cost-per-unit for queue rows persisted before the cost basis
 * column existed (P0-02). Computes the weighted input cost from the CURRENT
 * recipe and warehouse cost accounting; never returns null/NaN.
 */
export function computeFallbackUnitCost(item: ProductionQueueEntity): number {
  const def = getResourceDef(item.kind);
  if (!def?.producedFrom || !item.amount || item.amount <= 0) return 0;
  const db = database;
  let totalCost = 0;
  for (const [ingKindStr, ratio] of Object.entries(def.producedFrom)) {
    const ingKind = Number(ingKindStr);
    const need = ratio * item.amount;
    const rows = db.prepare(`
      SELECT amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market
      FROM warehouse WHERE company_id = ? AND kind = ? AND amount > 0
      ORDER BY quality ASC, id ASC
    `).all(item.companyId, ingKind) as Array<{
      amount: number; cost_workers: number; cost_admin: number;
      cost_material1: number; cost_material2: number; cost_market: number;
    }>;
    let remaining = need;
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.amount) || 0, remaining);
      const unitCost = (Number(row.cost_workers) || 0) + (Number(row.cost_admin) || 0) +
        (Number(row.cost_material1) || 0) + (Number(row.cost_material2) || 0) +
        (Number(row.cost_market) || 0);
      totalCost += take * unitCost;
      remaining -= take;
    }
  }
  return item.amount > 0 ? totalCost / item.amount : 0;
}
