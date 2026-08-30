import { db } from '../db/database.ts';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from './company.ts';

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
  age?: number;
  genome?: number;
  current_training_type?: string | null;
  note?: string;
  strike_until?: string | null;
  plans_to_retire?: number;
  training_finish_at: string | null;
  created_at: string;
}

export interface TrainingDbRow {
  id: number;
  executive_id: number;
  company_id: number;
  training_type: string;
  started_at: string;
  finish_at: string;
  completed: number;
  skills_gained: string;
  cost: number;
}

export interface OfferDbRow {
  id: number;
  poacher_company_id: number;
  target_company_id: number;
  executive_id: number;
  slot_position: string;
  skill_position: string;
  agency: number;
  offered_salary: number;
  expected_salary: number;
  agency_fee: number;
  reimbursement: number;
  status: number;
  accelerated: number;
  researched: number;
  created_at: string;
  extended_at: string | null;
  candidate_data: string | null;
}

export const POSITION_MAP: Record<string, string> = {
  coo: 'o', cfo: 'f', cmo: 'm', cto: 't', hr: 'o',
  'coo-apprentice': 'v', 'cfo-apprentice': 'x', 'cmo-apprentice': 'y', 'cto-apprentice': 'z',
  staff: 'unassigned', unassigned: 'unassigned', none: 'unassigned',
  g1: '1', g2: '2', g3: '3', g4: '4', g5: '5',
  o: 'o', f: 'f', m: 'm', t: 't', v: 'v', x: 'x', y: 'y', z: 'z',
  '1': '1', '2': '2', '3': '3', '4': '4', '5': '5'
};

export const REVERSE_POS_MAP: Record<string, string> = {
  o: 'coo', f: 'cfo', m: 'cmo', t: 'cto',
  v: 'coo-apprentice', x: 'cfo-apprentice', y: 'cmo-apprentice', z: 'cto-apprentice',
  '1': 'g1', '2': 'g2', '3': 'g3', '4': 'g4', '5': 'g5', unassigned: 'unassigned'
};

export function normalizePosition(pos?: string): string {
  if (!pos) return 'unassigned';
  const clean = pos.trim().toLowerCase();
  return POSITION_MAP[clean] || (Object.values(POSITION_MAP).includes(clean) ? clean : 'unassigned');
}

export function formatExecutive(e: ExecutiveRow, companyName: string = 'My Company') {
  const pos = normalizePosition(e.position);
  const mgmt = Number(e.skill_management) || 5;
  const acc = Number(e.skill_accounting) || 5;
  const sci = Number(e.skill_science) || 5;
  const comm = Number(e.skill_communication) || 5;
  const now = Date.now();
  const isTraining = Boolean(e.training_finish_at && new Date(e.training_finish_at).getTime() > now);

  const trainingRows = db.prepare('SELECT * FROM executive_trainings WHERE executive_id = ? AND completed = 1 ORDER BY id ASC').all(e.id) as unknown as TrainingDbRow[];
  const trainings = trainingRows.map(t => {
    let parsedSkills = {};
    try { parsedSkills = JSON.parse(t.skills_gained || '{}'); } catch { /* ignore */ }
    return {
      id: t.id, training: t.training_type || 'g', datetime: t.started_at,
      reflected: true, covered: false, skills: parsedSkills,
      employer: { id: e.company_id, company: companyName, realmId: 0 }
    };
  });

  return {
    id: e.id, name: e.name, avatar: e.avatar || 'images/avatars/female_01.png', position: pos,
    skills: { management: mgmt, accounting: acc, science: sci, communication: comm, coo: mgmt, cfo: acc, cmo: comm, cto: sci },
    totalSkill: mgmt + acc + sci + comm,
    currentWorkHistory: { position: pos === 'unassigned' ? 'none' : pos, start: e.created_at || new Date(now - 86400000).toISOString() },
    salary: Number(e.salary) || 250, expectedSalary: Number(e.salary) || 250,
    status: e.status || 'employed', age: Number(e.age) || 35, genome: Number(e.genome) || 1,
    strikeUntil: e.strike_until || null, plansToRetire: Boolean(e.plans_to_retire), note: e.note || '',
    trainingFinishAt: e.training_finish_at || null,
    currentTraining: isTraining ? { id: 1, training: e.current_training_type || 'g', finishAt: e.training_finish_at, endsAt: e.training_finish_at, cost: 2500 } : null,
    busy: isTraining ? { training: true } : null, trainings
  };
}

export function getCompanyExecutives(companyId: number) {
  checkAndCompleteTrainings(companyId);
  let rows = db.prepare("SELECT * FROM executives WHERE company_id = ? AND status != 'candidate' ORDER BY id ASC").all(companyId) as unknown as ExecutiveRow[];
  if (rows.length === 0) {
    const now = new Date().toISOString();
    const defaults = [
      { name: 'Alexander Wright', pos: 'o', mgmt: 12, acc: 4, sci: 3, comm: 6, sal: 450, age: 38 },
      { name: 'Elena Rostova', pos: 'f', mgmt: 4, acc: 14, sci: 2, comm: 5, sal: 480, age: 41 },
      { name: 'David Chen', pos: 't', mgmt: 5, acc: 3, sci: 15, comm: 4, sal: 500, age: 34 }
    ];
    for (const d of defaults) {
      db.prepare(`
        INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, age, created_at)
        VALUES (?, ?, 'images/avatars/female_01.png', ?, ?, ?, ?, ?, ?, 'employed', ?, ?)
      `).run(companyId, d.name, d.pos, d.mgmt, d.acc, d.sci, d.comm, d.sal, d.age, now);
    }
    rows = db.prepare("SELECT * FROM executives WHERE company_id = ? AND status != 'candidate' ORDER BY id ASC").all(companyId) as unknown as ExecutiveRow[];
  }
  const comp = getCompanyById(companyId);
  return rows.map(r => formatExecutive(r, comp ? comp.name : 'Company'));
}

export function getExecutiveById(executiveId: number, companyId?: number): ExecutiveRow | null {
  const query = companyId ? 'SELECT * FROM executives WHERE id = ? AND company_id = ?' : 'SELECT * FROM executives WHERE id = ?';
  return (db.prepare(query).get(...(companyId ? [executiveId, companyId] : [executiveId])) as unknown as ExecutiveRow) || null;
}

export function getExecutiveCandidates(companyId: number) {
  let rows = db.prepare("SELECT * FROM executives WHERE company_id = ? AND status = 'candidate' ORDER BY id DESC LIMIT 5").all(companyId) as unknown as ExecutiveRow[];
  if (rows.length === 0) {
    const now = new Date().toISOString();
    const defaults = [
      { name: 'Marcus Vance', mgmt: 8, acc: 6, sci: 7, comm: 9, sal: 320, age: 29 },
      { name: 'Sophia Sterling', mgmt: 11, acc: 5, sci: 4, comm: 10, sal: 360, age: 32 },
      { name: 'Lucas Meyer', mgmt: 4, acc: 10, sci: 11, comm: 5, sal: 340, age: 30 }
    ];
    for (const c of defaults) {
      db.prepare(`
        INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, age, created_at)
        VALUES (?, ?, 'images/avatars/male_02.png', 'unassigned', ?, ?, ?, ?, ?, 'candidate', ?, ?)
      `).run(companyId, c.name, c.mgmt, c.acc, c.sci, c.comm, c.sal, c.age, now);
    }
    rows = db.prepare("SELECT * FROM executives WHERE company_id = ? AND status = 'candidate' ORDER BY id DESC LIMIT 5").all(companyId) as unknown as ExecutiveRow[];
  }
  return rows.map(r => formatExecutive(r));
}

const FIRST_NAMES = ['Liam', 'Noah', 'Oliver', 'Emma', 'Charlotte', 'Amelia', 'Arthur', 'Victoria', 'Julian', 'Clara'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

export function rushCandidates(companyId: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 10) throw new Error('Not enough SimBoosts (10 required)');
  updateCompanySimBoosts(companyId, -10);
  db.prepare("DELETE FROM executives WHERE company_id = ? AND status = 'candidate'").run(companyId);
  const now = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    const name = `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;
    const mgmt = Math.floor(14 + Math.random() * 12), acc = Math.floor(14 + Math.random() * 12), sci = Math.floor(14 + Math.random() * 12), comm = Math.floor(14 + Math.random() * 12);
    const sal = Math.floor(500 + Math.random() * 300), age = Math.floor(28 + Math.random() * 15);
    db.prepare(`
      INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, age, created_at)
      VALUES (?, ?, 'images/avatars/female_02.png', 'unassigned', ?, ?, ?, ?, ?, 'candidate', ?, ?)
    `).run(companyId, name, mgmt, acc, sci, comm, sal, age, now);
  }
  const rows = db.prepare("SELECT * FROM executives WHERE company_id = ? AND status = 'candidate' ORDER BY id DESC LIMIT 5").all(companyId) as unknown as ExecutiveRow[];
  return rows.map(r => formatExecutive(r));
}

export function hireExecutive(companyId: number, candidateId?: number, position: string = 'unassigned', candidateData?: { name?: string; avatar?: string; skills?: Record<string, number>; salary?: number; age?: number }) {
  const pos = normalizePosition(position);
  let execId = candidateId;
  if (candidateId) {
    const c = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(candidateId, companyId) as unknown as ExecutiveRow | undefined;
    if (c) {
      db.prepare("UPDATE executives SET status = 'employed', position = ? WHERE id = ?").run(pos, candidateId);
      execId = candidateId;
    }
  }
  if (!execId && candidateData) {
    const now = new Date().toISOString();
    const skills = candidateData.skills || {};
    const info = db.prepare(`
      INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, age, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'employed', ?, ?)
    `).run(
      companyId, candidateData.name || 'New Executive', candidateData.avatar || 'images/avatars/male_01.png', pos,
      skills.coo || skills.management || 10, skills.cfo || skills.accounting || 10, skills.cto || skills.science || 10, skills.cmo || skills.communication || 10,
      candidateData.salary || 400, candidateData.age || 35, now
    );
    execId = Number(info.lastInsertRowid);
  }
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(execId) as unknown as ExecutiveRow;
  if (!updated) throw new Error('Failed to hire executive');
  return formatExecutive(updated);
}

export function fireExecutive(companyId: number, executiveId: number) {
  const e = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!e) throw new Error('Executive not found');
  const severance = Math.max(0, Math.floor((Number(e.salary) || 250) * 3));
  updateCompanyMoney(companyId, -severance);
  db.prepare(`
    INSERT INTO former_executives (company_id, name, avatar, position, skills, salary, reason, compensation, left_at)
    VALUES (?, ?, ?, ?, ?, ?, 'fired', ?, ?)
  `).run(companyId, e.name, e.avatar, e.position, JSON.stringify({ mgmt: e.skill_management, acc: e.skill_accounting, sci: e.skill_science, comm: e.skill_communication }), e.salary, severance, new Date().toISOString());
  db.prepare('DELETE FROM executives WHERE id = ? AND company_id = ?').run(executiveId, companyId);
  return { success: true, severance };
}

export function assignExecutive(companyId: number, executiveId: number, position: string) {
  const pos = normalizePosition(position);
  db.prepare('UPDATE executives SET position = ? WHERE id = ? AND company_id = ?').run(pos, executiveId, companyId);
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
  if (!updated) throw new Error('Executive not found');
  return formatExecutive(updated);
}

export function updateExecutive(companyId: number, executiveId: number, updates: { salary?: number; position?: string; plansToRetire?: boolean; strikeUntil?: string | null; rushSettle?: boolean }) {
  const e = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!e) throw new Error('Executive not found');
  if (updates.salary !== undefined) db.prepare('UPDATE executives SET salary = ? WHERE id = ?').run(Number(updates.salary), executiveId);
  if (updates.position !== undefined) db.prepare('UPDATE executives SET position = ? WHERE id = ?').run(normalizePosition(updates.position), executiveId);
  if (updates.plansToRetire !== undefined) db.prepare('UPDATE executives SET plans_to_retire = ? WHERE id = ?').run(updates.plansToRetire ? 1 : 0, executiveId);
  if (updates.strikeUntil !== undefined) db.prepare('UPDATE executives SET strike_until = ? WHERE id = ?').run(updates.strikeUntil, executiveId);
  if (updates.rushSettle) db.prepare('UPDATE executives SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 86400000 * 2).toISOString(), executiveId);
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
  return formatExecutive(updated);
}

export function startTraining(companyId: number, executiveId: number, trainingType: string = 'g') {
  const cost = 2500, comp = getCompanyById(companyId);
  if (!comp || comp.money < cost) throw new Error('Not enough money for executive training');
  const exec = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!exec) throw new Error('Executive not found');
  updateCompanyMoney(companyId, -cost);
  const now = new Date(), finishAt = new Date(now.getTime() + 10 * 3600 * 1000).toISOString();
  db.prepare('UPDATE executives SET training_finish_at = ?, current_training_type = ? WHERE id = ?').run(finishAt, trainingType, executiveId);
  const stmt = db.prepare('INSERT INTO executive_trainings (executive_id, company_id, training_type, started_at, finish_at, completed, cost) VALUES (?, ?, ?, ?, ?, 0, ?)').run(executiveId, companyId, trainingType, now.toISOString(), finishAt, cost);
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
  return { success: true, executive: formatExecutive(updated), training: { id: Number(stmt.lastInsertRowid), training: trainingType, datetime: now.toISOString(), finishAt } };
}

export function rushTraining(companyId: number, executiveId: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 5) throw new Error('Not enough SimBoosts (5 required)');
  const exec = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!exec) throw new Error('Executive not found');
  updateCompanySimBoosts(companyId, -5);
  const t = exec.current_training_type || 'g', gained: Record<string, number> = {};
  if (t === 'o') { db.prepare('UPDATE executives SET skill_management = skill_management + 4 WHERE id = ?').run(executiveId); gained.coo = 4; gained.management = 4; }
  else if (t === 'f') { db.prepare('UPDATE executives SET skill_accounting = skill_accounting + 4 WHERE id = ?').run(executiveId); gained.cfo = 4; gained.accounting = 4; }
  else if (t === 'm') { db.prepare('UPDATE executives SET skill_communication = skill_communication + 4 WHERE id = ?').run(executiveId); gained.cmo = 4; gained.communication = 4; }
  else if (t === 't') { db.prepare('UPDATE executives SET skill_science = skill_science + 4 WHERE id = ?').run(executiveId); gained.cto = 4; gained.science = 4; }
  else {
    db.prepare('UPDATE executives SET skill_management = skill_management + 1, skill_accounting = skill_accounting + 1, skill_science = skill_science + 1, skill_communication = skill_communication + 1 WHERE id = ?').run(executiveId);
    gained.coo = 1; gained.cfo = 1; gained.cmo = 1; gained.cto = 1;
  }
  db.prepare('UPDATE executives SET training_finish_at = NULL, current_training_type = NULL WHERE id = ?').run(executiveId);
  db.prepare('UPDATE executive_trainings SET completed = 1, skills_gained = ? WHERE executive_id = ? AND completed = 0').run(JSON.stringify(gained), executiveId);
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
  return { success: true, executive: formatExecutive(updated), simboostsDelta: -5 };
}

export function cancelTraining(companyId: number, executiveId: number) {
  const exec = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!exec) throw new Error('Executive not found');
  db.prepare('UPDATE executives SET training_finish_at = NULL, current_training_type = NULL WHERE id = ?').run(executiveId);
  db.prepare('DELETE FROM executive_trainings WHERE executive_id = ? AND completed = 0').run(executiveId);
  const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
  return { success: true, executive: formatExecutive(updated) };
}

export function checkAndCompleteTrainings(companyId: number) {
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT * FROM executives WHERE company_id = ? AND training_finish_at IS NOT NULL AND training_finish_at <= ?').all(companyId, now) as unknown as ExecutiveRow[];
  for (const r of rows) {
    const t = r.current_training_type || 'g';
    if (t === 'o') db.prepare('UPDATE executives SET skill_management = skill_management + 3 WHERE id = ?').run(r.id);
    else if (t === 'f') db.prepare('UPDATE executives SET skill_accounting = skill_accounting + 3 WHERE id = ?').run(r.id);
    else if (t === 'm') db.prepare('UPDATE executives SET skill_communication = skill_communication + 3 WHERE id = ?').run(r.id);
    else if (t === 't') db.prepare('UPDATE executives SET skill_science = skill_science + 3 WHERE id = ?').run(r.id);
    else db.prepare('UPDATE executives SET skill_management = skill_management + 1, skill_accounting = skill_accounting + 1, skill_science = skill_science + 1, skill_communication = skill_communication + 1 WHERE id = ?').run(r.id);
    db.prepare('UPDATE executives SET training_finish_at = NULL, current_training_type = NULL WHERE id = ?').run(r.id);
    db.prepare('UPDATE executive_trainings SET completed = 1 WHERE executive_id = ? AND completed = 0').run(r.id);
  }
}

export function getMyOffers(companyId: number) {
  const rows = db.prepare('SELECT * FROM executive_offers WHERE poacher_company_id = ? ORDER BY id DESC').all(companyId) as unknown as OfferDbRow[];
  return rows.map(formatOffer);
}

export function formatOffer(o: OfferDbRow) {
  let candidateObj: Record<string, unknown> | null = null;
  if (o.candidate_data) {
    try { candidateObj = JSON.parse(o.candidate_data); } catch { /* ignore */ }
  } else if (o.executive_id) {
    const e = db.prepare('SELECT * FROM executives WHERE id = ?').get(o.executive_id) as unknown as ExecutiveRow | undefined;
    if (e) candidateObj = formatExecutive(e) as unknown as Record<string, unknown>;
  }
  return {
    id: o.id, slotPosition: o.slot_position || 'o', skillPosition: o.skill_position || 'coo', agency: o.agency || 1,
    datetime: o.created_at, status: o.status || 1, executive: candidateObj, expectedSalary: o.expected_salary || 400,
    salary: o.offered_salary || o.expected_salary || 400, agencyFee: o.agency_fee || 0, reimbursement: o.reimbursement || 0,
    accelerated: Boolean(o.accelerated),
    researchEmployer: o.researched ? {
      marketSalary: 450, poacherCompanyValue: 1500000, poacherAverageSalary: 420, poacherFiredEmployeesCount: 1,
      poacherAverageYearsSpendAtCompany: 3, employerCompanyValue: 2000000, averageAcceptedOffer: 500,
      averageRefusedOffer: 380, employerAcceptanceRate: 0.75, averageAcceptedIncrease: 1.25, averageRefusedIncrease: 0.95
    } : null
  };
}

export function createMyOffer(companyId: number, params: { agency?: number; slotPosition?: string; skillPosition?: string }) {
  const agency = Number(params.agency) || 1, slotPos = normalizePosition(params.slotPosition || 'o'), skillPos = params.skillPosition || REVERSE_POS_MAP[slotPos] || 'coo';
  const name = `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;
  const multiplier = agency === 4 ? 2.5 : agency === 3 ? 1.8 : agency === 2 ? 1.4 : 1.0;
  const mgmt = Math.floor((8 + Math.random() * 8) * multiplier), acc = Math.floor((8 + Math.random() * 8) * multiplier), sci = Math.floor((8 + Math.random() * 8) * multiplier), comm = Math.floor((8 + Math.random() * 8) * multiplier);
  const expectedSal = Math.floor(350 * multiplier);
  const candidateData = {
    id: Math.floor(100000 + Math.random() * 900000), name, avatar: 'images/avatars/male_01.png', position: 'unassigned',
    skills: { coo: mgmt, cfo: acc, cmo: comm, cto: sci, management: mgmt, accounting: acc, communication: comm, science: sci },
    salary: expectedSal, expectedSalary: expectedSal, age: Math.floor(30 + Math.random() * 15), isCandidate: true, trainings: []
  };
  const agencyFee = agency === 2 ? Math.floor(expectedSal * 0.5) : agency === 3 ? expectedSal * 2 : agency === 4 ? expectedSal * 5 : 0;
  const now = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO executive_offers (poacher_company_id, target_company_id, executive_id, slot_position, skill_position, agency, offered_salary, expected_salary, agency_fee, status, created_at, candidate_data) VALUES (?, 0, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(companyId, slotPos, skillPos, agency, expectedSal, expectedSal, agencyFee, now, JSON.stringify(candidateData));
  const row = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(Number(stmt.lastInsertRowid)) as unknown as OfferDbRow;
  return formatOffer(row);
}

export function updateMyOffer(companyId: number, offerId: number, updates: { accelerated?: boolean; executive?: boolean; salary?: number }) {
  const row = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, companyId) as unknown as OfferDbRow | undefined;
  if (!row) throw new Error('Offer not found');
  if (updates.accelerated) {
    const comp = getCompanyById(companyId);
    if (!comp || comp.simboosts < 5) throw new Error('Not enough SimBoosts (5 required)');
    updateCompanySimBoosts(companyId, -5);
    db.prepare('UPDATE executive_offers SET accelerated = 1 WHERE id = ?').run(offerId);
  }
  if (updates.executive && updates.salary !== undefined) {
    db.prepare('UPDATE executive_offers SET offered_salary = ?, status = 2, extended_at = ? WHERE id = ?').run(Number(updates.salary), new Date().toISOString(), offerId);
  }
  const updated = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as OfferDbRow;
  return formatOffer(updated);
}

export function researchEmployer(companyId: number, offerId: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 5) throw new Error('Not enough SimBoosts (5 required)');
  updateCompanySimBoosts(companyId, -5);
  db.prepare('UPDATE executive_offers SET researched = 1 WHERE id = ?').run(offerId);
  const updated = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as OfferDbRow;
  return { offer: formatOffer(updated), simboostsDelta: -5 };
}

export function dismissMyOffer(companyId: number, offerId: number) {
  db.prepare('DELETE FROM executive_offers WHERE id = ? AND poacher_company_id = ?').run(offerId, companyId);
  return { success: true };
}

export function refreshMyOffer(companyId: number, offerId: number) {
  const row = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, companyId) as unknown as OfferDbRow | undefined;
  if (!row) throw new Error('Offer not found');
  return createMyOffer(companyId, { slotPosition: row.slot_position, skillPosition: row.skill_position, agency: row.agency });
}

export function getHostileOffers(companyId: number) {
  const rows = db.prepare('SELECT * FROM executive_offers WHERE target_company_id = ? AND status IN (1, 2) ORDER BY id DESC').all(companyId) as unknown as OfferDbRow[];
  return rows.map(formatOffer);
}

export function letGoHostileOffer(companyId: number, offerId: number) {
  const row = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as OfferDbRow | undefined;
  if (!row) throw new Error('Offer not found');
  const comp = Math.floor((row.expected_salary || 400) * 10 / 200) + 5000;
  updateCompanyMoney(companyId, comp);
  if (row.poacher_company_id) updateCompanyMoney(row.poacher_company_id, -comp);
  db.prepare('UPDATE executive_offers SET status = 3 WHERE id = ?').run(offerId);
  return { moneyDelta: comp, stayed: false };
}

export function rejectHostileOffer(_companyId: number, offerId: number) {
  db.prepare('DELETE FROM executive_offers WHERE id = ?').run(offerId);
  return { success: true };
}

export function getFormerExecutives(companyId: number) {
  const rows = db.prepare('SELECT * FROM former_executives WHERE company_id = ? ORDER BY id DESC').all(companyId) as unknown as Array<{ id: number; name: string; avatar: string; position: string; skills: string; salary: number; reason: string; compensation: number; left_at: string }>;
  return rows.map(r => {
    let parsedSkills = {};
    try { parsedSkills = JSON.parse(r.skills || '{}'); } catch { /* ignore */ }
    return { id: r.id, name: r.name, avatar: r.avatar, position: r.position, skills: parsedSkills, salary: r.salary, reason: r.reason, compensation: r.compensation, leftAt: r.left_at };
  });
}

export function getExecutiveNote(executiveId: number): string {
  const e = db.prepare('SELECT note FROM executives WHERE id = ?').get(executiveId) as { note?: string } | undefined;
  return (e && e.note) || '';
}

export function setExecutiveNote(executiveId: number, note: string): string {
  db.prepare('UPDATE executives SET note = ? WHERE id = ?').run(note, executiveId);
  return note;
}
