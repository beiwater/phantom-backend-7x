import { db } from '../db/database.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';

export interface ExecutiveRow {
  id: number;
  company_id: number;
  name: string;
  avatar: string;
  position: string;
  skill_management: number;
  skill_accounting: number;
  skill_science: number;
  skill_communication: number;
  salary: number;
  status: string;
  training_finish_at: string | null;
  created_at: string;
}

export function formatExecutive(e: ExecutiveRow) {
  const pos = (e.position || 'unassigned').toLowerCase();
  return {
    id: e.id,
    name: e.name,
    avatar: e.avatar || 'images/avatars/male_01.png',
    position: e.position || 'unassigned',
    skills: {
      management: Number(e.skill_management) || 5,
      accounting: Number(e.skill_accounting) || 5,
      science: Number(e.skill_science) || 5,
      communication: Number(e.skill_communication) || 5
    },
    currentWorkHistory: {
      position: pos === 'unassigned' ? 'none' : pos,
      start: e.created_at || new Date(Date.now() - 86400000).toISOString()
    },
    salary: Number(e.salary) || 250,
    status: e.status || 'employed',
    trainingFinishAt: e.training_finish_at,
    totalSkill: (Number(e.skill_management) || 5) + (Number(e.skill_accounting) || 5) + (Number(e.skill_science) || 5) + (Number(e.skill_communication) || 5)
  };
}

export function getCompanyExecutives(companyId: number) {
  let rows = db.prepare(`
    SELECT * FROM executives
    WHERE company_id = ? AND status != 'candidate'
    ORDER BY id ASC
  `).all(companyId) as unknown as ExecutiveRow[];

  if (rows.length === 0) {
    const now = new Date().toISOString();
    const defaults = [
      { name: 'Alexander Wright', pos: 'coo', mgmt: 12, acc: 4, sci: 3, comm: 6, sal: 450 },
      { name: 'Elena Rostova', pos: 'cfo', mgmt: 4, acc: 14, sci: 2, comm: 5, sal: 480 },
      { name: 'David Chen', pos: 'cto', mgmt: 5, acc: 3, sci: 15, comm: 4, sal: 500 }
    ];
    for (const d of defaults) {
      db.prepare(`
        INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
        VALUES (?, ?, 'images/avatars/female_01.png', ?, ?, ?, ?, ?, ?, 'employed', ?)
      `).run(companyId, d.name, d.pos, d.mgmt, d.acc, d.sci, d.comm, d.sal, now);
    }

    rows = db.prepare(`
      SELECT * FROM executives
      WHERE company_id = ? AND status != 'candidate'
      ORDER BY id ASC
    `).all(companyId) as unknown as ExecutiveRow[];
  }

  return rows.map(formatExecutive);
}

export function getExecutiveCandidates(companyId: number) {
  let rows = db.prepare(`
    SELECT * FROM executives
    WHERE company_id = ? AND status = 'candidate'
    ORDER BY id DESC LIMIT 5
  `).all(companyId) as unknown as ExecutiveRow[];

  if (rows.length === 0) {
    const now = new Date().toISOString();
    const candidates = [
      { name: 'Marcus Vance', mgmt: 8, acc: 6, sci: 7, comm: 9, sal: 320 },
      { name: 'Sophia Sterling', mgmt: 11, acc: 5, sci: 4, comm: 10, sal: 360 },
      { name: 'Lucas Meyer', mgmt: 4, acc: 10, sci: 11, comm: 5, sal: 340 }
    ];
    for (const c of candidates) {
      db.prepare(`
        INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
        VALUES (?, ?, 'images/avatars/male_02.png', 'unassigned', ?, ?, ?, ?, ?, 'candidate', ?)
      `).run(companyId, c.name, c.mgmt, c.acc, c.sci, c.comm, c.sal, now);
    }

    rows = db.prepare(`
      SELECT * FROM executives
      WHERE company_id = ? AND status = 'candidate'
      ORDER BY id DESC LIMIT 5
    `).all(companyId) as unknown as ExecutiveRow[];
  }

  return rows.map(formatExecutive);
}

export function hireExecutive(companyId: number, candidateId: number, position: string = 'unassigned') {
  const c = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(candidateId, companyId) as unknown as ExecutiveRow | undefined;
  if (!c) throw new Error('Candidate not found');

  db.prepare(`UPDATE executives SET status = 'employed', position = ? WHERE id = ?`).run(position, candidateId);
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(candidateId) as unknown as ExecutiveRow;
  return formatExecutive(updated);
}

export function fireExecutive(companyId: number, executiveId: number) {
  db.prepare(`DELETE FROM executives WHERE id = ? AND company_id = ?`).run(executiveId, companyId);
  return { success: true };
}

export function assignExecutive(companyId: number, executiveId: number, position: string) {
  db.prepare(`UPDATE executives SET position = ? WHERE id = ? AND company_id = ?`).run(position, executiveId, companyId);
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
  return formatExecutive(updated);
}

export function trainExecutive(companyId: number, executiveId: number) {
  const trainingCost = 2500;
  const comp = getCompanyById(companyId);
  if (!comp || comp.money < trainingCost) {
    throw new Error('Not enough money for executive training');
  }

  updateCompanyMoney(companyId, -trainingCost);

  // Increment skills
  db.prepare(`
    UPDATE executives
    SET skill_management = skill_management + 1,
        skill_accounting = skill_accounting + 1,
        skill_science = skill_science + 1,
        skill_communication = skill_communication + 1
    WHERE id = ? AND company_id = ?
  `).run(executiveId, companyId);

  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
  return {
    executive: formatExecutive(updated),
    cost: trainingCost
  };
}
