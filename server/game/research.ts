import { db } from '../db/database.ts';

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

export function getCompanyResearch(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM research WHERE company_id = ?
  `).all(companyId) as unknown as ResearchRow[];

  const researchMap: Record<number, { discipline: number; name: string; points: number; patents: number; qualityCap: number }> = {};

  for (let d = 1; d <= 12; d++) {
    const found = rows.find(r => r.discipline === d);
    const points = found ? found.points : 500;
    const patents = found ? found.patents : 10;
    researchMap[d] = {
      discipline: d,
      name: DISCIPLINES[d] || `Discipline #${d}`,
      points,
      patents,
      qualityCap: Math.min(12, Math.floor(patents / 2) + 1)
    };
  }

  return { research: researchMap };
}

export function applyResearch(companyId: number, discipline: number, pointsToApply: number) {
  const existing = db.prepare(`
    SELECT * FROM research WHERE company_id = ? AND discipline = ?
  `).get(companyId, discipline) as unknown as ResearchRow | undefined;

  if (existing) {
    const newPoints = existing.points + pointsToApply;
    const newPatents = existing.patents + Math.floor(pointsToApply / 50);
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

  return getCompanyResearch(companyId);
}
