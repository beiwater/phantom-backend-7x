import { db } from '../db/database.ts';
import { getResourceDef } from './constants.ts';
import { getCompanyById } from './company.ts';
import { consumeResourceExactWithTransactions, getWarehouseItemExact } from './warehouse.ts';
import { runInTransaction } from '../db/transaction.ts';
import { checkCapability } from '../domain/leveling/level-rules.ts';
import {
  CUMULATIVE_PATENT_THRESHOLDS,
  DISCIPLINES,
  RESEARCH_RESOURCE_BY_DISCIPLINE,
  DEFAULT_DISCIPLINE,
  DISCIPLINE_BY_PRODUCED_AT,
  RESOURCE_TO_DISCIPLINE,
  getQualityFromPatents,
  getPatentsNeededForNextQuality,
  getDisciplineForResource,
  calculatePatentsFromPoints
} from '../domain/research/research-rules.ts';

export {
  CUMULATIVE_PATENT_THRESHOLDS,
  DISCIPLINES,
  RESEARCH_RESOURCE_BY_DISCIPLINE,
  DEFAULT_DISCIPLINE,
  DISCIPLINE_BY_PRODUCED_AT,
  RESOURCE_TO_DISCIPLINE,
  getQualityFromPatents,
  getPatentsNeededForNextQuality,
  getDisciplineForResource,
  calculatePatentsFromPoints
};

export interface ResearchRow {
  id: number;
  company_id: number;
  discipline: number;
  points: number;
  patents: number;
}

/**
 * Returns the science skill of an active employed CTO for the company.
 * Requires executives capability to be unlocked (level >= 15).
 */
export function getCompanyCtoScienceSkill(companyId: number): number {
  const company = db.prepare('SELECT level FROM companies WHERE company_id = ?').get(companyId) as { level: number } | undefined;
  if (!company) return 0;
  if (!checkCapability(company.level, 'executives').allowed) {
    return 0;
  }
  const row = db.prepare(`
    SELECT skill_science FROM executives
    WHERE company_id = ? AND status = 'employed' AND LOWER(position) = 'cto'
    LIMIT 1
  `).get(companyId) as { skill_science: number } | undefined;

  return row ? Math.max(0, Number(row.skill_science) || 0) : 0;
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
  return getQualityFromPatents(Number(row.patents || 0));
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
  const quality = getQualityFromPatents(patents);

  return {
    kind: resourceKind,
    quality,
    patents,
    patentsNeeded: getPatentsNeededForNextQuality(quality),
    researchUnits: Number(row?.points || 0)
  };
}


export async function applyResourceResearch(companyId: number, resourceKind: number, points: number) {
  if (!getResourceDef(resourceKind)) {
    throw new Error(`Unknown resource kind: ${resourceKind}`);
  }
  if (!Number.isSafeInteger(points) || points <= 0) {
    throw new Error('Research points must be a positive integer');
  }

  const before = getResourceResearchAbility(companyId, resourceKind);
  await applyResearch(companyId, getDisciplineForResource(resourceKind), points);
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
      qualityCap: found ? getQualityFromPatents(patents) : 0
    };
  }


  return { research: researchMap };
}

// Level gate (research unlocks at level >= 10 in the real game) intentionally
// skipped: company.ts featureFlags has no research.enabled flag, and the
// private server starts players at level 5 with everything enabled.
export async function applyResearch(companyId: number, discipline: number, pointsToApply: number) {
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

  return runInTransaction(async () => {
    const consumed = consumeResourceExactWithTransactions(companyId, researchKind, 0, pointsToApply);
    if (!consumed) {
      throw new Error(`Insufficient research resource #${researchKind}`);
    }

    const existing = db.prepare(`
      SELECT * FROM research WHERE company_id = ? AND discipline = ?
    `).get(companyId, discipline) as unknown as ResearchRow | undefined;

    const currentPoints = Number(existing?.points || 0);
    const newPoints = currentPoints + pointsToApply;
    const ctoScience = getCompanyCtoScienceSkill(companyId);
    const newPatents = calculatePatentsFromPoints(newPoints, ctoScience);
    if (existing) {
      db.prepare(`
        UPDATE research
        SET points = ?, patents = ?
        WHERE id = ?
      `).run(newPoints, newPatents, existing.id);
    } else {
      db.prepare(`
        INSERT INTO research (company_id, discipline, points, patents)
        VALUES (?, ?, ?, ?)
      `).run(companyId, discipline, newPoints, newPatents);
    }

    return getCompanyResearch(companyId);
  }, { immediate: true });
}
