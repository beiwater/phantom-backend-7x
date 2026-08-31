import { db } from '../db/database.ts';
import { getResourceDef } from './constants.ts';
import { getCompanyById } from './company.ts';
import { consumeResourceExactWithTransactions, getWarehouseItemExact } from './warehouse.ts';

export interface ResearchRow {
  id: number;
  company_id: number;
  discipline: number;
  points: number;
  patents: number;
}

const DISCIPLINES: Record<number, string> = {
  1: 'Plant research',
  2: 'Energy research',
  3: 'Mining research',
  4: 'Electronics research',
  5: 'Breeding research',
  6: 'Chemistry research',
  7: 'Software research',
  8: 'Automotive research',
  9: 'Aerospace research',
  10: 'Materials research',
  11: 'Fashion research',
  12: 'Recipes research'
};
const RESEARCH_RESOURCE_BY_DISCIPLINE: Record<number, number> = {
  1: 29,
  2: 30,
  3: 31,
  4: 32,
  5: 33,
  6: 34,
  7: 35,
  8: 58,
  9: 100,
  10: 113,
  11: 59,
  12: 145
};


// Coarse mapping: producedAt building letter -> research discipline.
// Assumptions: extraction buildings (Oil rig, Mine, Quarry) -> Mining; Refinery/Gas station -> Chemistry;
// generic Factory -> Materials; food/drink production (Brewery, Bakery, Food processing, Restaurant) -> Recipes;
// Water reservoir/Power plant -> Energy; Orchards (e) grouped with Farms under Plant research.
export const DEFAULT_DISCIPLINE = 10; // Materials research fallback
export const DISCIPLINE_BY_PRODUCED_AT: Record<string, number> = {
  E: 4, W: 2, P: 1, e: 1, F: 11, O: 3, R: 6, S: 6, M: 3, Y: 10,
  L: 4, T: 2, Q: 3, '1': 8, '6': 12, j: 12, k: 12, m: 12, A: 9, a: 9,
  '0': 8, '7': 9, '8': 9, '9': 9, D: 8, o: 9, x: 4, g: 6, i: 9, v: 8
};

export function getDisciplineForResource(resourceKind: number): number {
  const def = getResourceDef(resourceKind);
  const letter = def?.producedAt != null ? String(def.producedAt) : undefined;
  return (letter && DISCIPLINE_BY_PRODUCED_AT[letter]) || DEFAULT_DISCIPLINE;
}

// Quality cap achievable for a resource given the company's research in the
// relevant discipline. Returns 0 when the company has no research rows at all
// (distinct from the display default of 10 patents in getCompanyResearch).
export function getProductionQualityCap(companyId: number, resourceKind: number): number {
  const discipline = getDisciplineForResource(resourceKind);
  const row = db.prepare(`
    SELECT patents FROM research WHERE company_id = ? AND discipline = ?
  `).get(companyId, discipline) as unknown as { patents: number } | undefined;

  if (!row) return 0;
  return Math.min(12, Math.floor(row.patents / 2) + 1);
}

export interface ResourceResearchAbility {
  kind: number;
  quality: number;
  patents: number;
  patentsNeeded: number;
  researchUnits: number;
}

export function getResourceResearchAbility(companyId: number, resourceKind: number): ResourceResearchAbility {
  const discipline = getDisciplineForResource(resourceKind);
  const row = db.prepare(`
    SELECT points, patents FROM research
    WHERE company_id = ? AND discipline = ?
  `).get(companyId, discipline) as { points: number; patents: number } | undefined;

  const patents = Number(row?.patents || 0);
  const quality = row ? Math.min(12, Math.floor(patents / 2) + 1) : 0;

  return {
    kind: resourceKind,
    quality,
    patents,
    // The frontend uses this value to display the cost of the next quality
    // tier. The first tier requires twelve patents in the original tree.
    patentsNeeded: Math.max(12, (quality + 1) * 12),
    researchUnits: Number(row?.points || 0)
  };
}

export function applyResourceResearch(companyId: number, resourceKind: number, points: number) {
  if (!getResourceDef(resourceKind)) {
    throw new Error(`Unknown resource kind: ${resourceKind}`);
  }
  if (!Number.isFinite(points) || points <= 0) {
    throw new Error('Research points must be a finite positive number');
  }

  const before = getResourceResearchAbility(companyId, resourceKind);
  applyResearch(companyId, getDisciplineForResource(resourceKind), points);
  const after = getResourceResearchAbility(companyId, resourceKind);

  return {
    ...after,
    previousQuality: before.quality,
    newQuality: after.quality,
    researchUnitsCommitted: points,
    patentsGained: Math.max(0, after.patents - before.patents)
  };
}

export function getCompanyResearch(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM research WHERE company_id = ?
  `).all(companyId) as unknown as ResearchRow[];

  const researchMap: Record<number, { discipline: number; name: string; points: number; patents: number; qualityCap: number }> = {};

  for (let d = 1; d <= 12; d++) {
    const found = rows.find(r => r.discipline === d);
    const points = found ? Number(found.points) : 0;
    const patents = found ? Number(found.patents) : 0;
    researchMap[d] = {
      discipline: d,
      name: DISCIPLINES[d] || `Discipline #${d}`,
      points,
      patents,
      qualityCap: found ? Math.min(12, Math.floor(patents / 2) + 1) : 0
    };
  }

  return { research: researchMap };
}

// Level gate (research unlocks at level >= 10 in the real game) intentionally
// skipped: company.ts featureFlags has no research.enabled flag, and the
// private server starts players at level 5 with everything enabled.
export function applyResearch(companyId: number, discipline: number, pointsToApply: number) {
  if (!getCompanyById(companyId)) {
    throw new Error('Company not found');
  }
  if (!Number.isInteger(discipline) || !RESEARCH_RESOURCE_BY_DISCIPLINE[discipline]) {
    throw new Error('Invalid research discipline');
  }
  if (!Number.isSafeInteger(pointsToApply) || pointsToApply <= 0) {
    throw new Error('pointsToApply must be a positive integer');
  }

  const researchKind = RESEARCH_RESOURCE_BY_DISCIPLINE[discipline];
  const stock = getWarehouseItemExact(companyId, researchKind, 0);
  if (!stock || Number(stock.amount) < pointsToApply) {
    throw new Error(`Insufficient research resource #${researchKind}`);
  }

  db.exec('BEGIN');
  try {
    const consumed = consumeResourceExactWithTransactions(companyId, researchKind, 0, pointsToApply);
    if (!consumed) {
      throw new Error(`Insufficient research resource #${researchKind}`);
    }

    const existing = db.prepare(`
      SELECT * FROM research WHERE company_id = ? AND discipline = ?
    `).get(companyId, discipline) as unknown as ResearchRow | undefined;

    if (existing) {
      const newPoints = Number(existing.points) + pointsToApply;
      const newPatents = Number(existing.patents) + Math.floor(pointsToApply / 50);
      db.prepare(`
        UPDATE research
        SET points = ?, patents = ?
        WHERE id = ?
      `).run(newPoints, newPatents, existing.id);
    } else {
      db.prepare(`
        INSERT INTO research (company_id, discipline, points, patents)
        VALUES (?, ?, ?, ?)
      `).run(companyId, discipline, pointsToApply, Math.floor(pointsToApply / 50));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getCompanyResearch(companyId);
}
