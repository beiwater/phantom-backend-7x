import { db } from '../db/database.ts';
import type { DatabaseSync } from 'node:sqlite';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from './company.ts';
import { runInTransaction } from '../db/transaction.ts';

// Ensure executive_offers table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS executive_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poacher_company_id INTEGER NOT NULL,
    target_company_id INTEGER NOT NULL,
    target_executive_id INTEGER NOT NULL,
    slot_position TEXT DEFAULT 'coo',
    skill_position TEXT DEFAULT 'o',
    agency INTEGER DEFAULT 1,
    status TEXT DEFAULT 'f',
    expected_salary REAL NOT NULL,
    salary REAL DEFAULT NULL,
    agency_fee REAL DEFAULT 0,
    accelerated INTEGER DEFAULT 0,
    research_poacher TEXT DEFAULT NULL,
    research_employer TEXT DEFAULT NULL,
    extended_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

export const AgencyTier = {
  IN_HOUSE: 1,
  STAFFING_AGENCY: 2,
  GOOD_AGENCY: 3,
  TOP_TALENT_AGENCY: 4
} as const;
export type AgencyTier = (typeof AgencyTier)[keyof typeof AgencyTier];

export const AGENCY_FEE_MULTIPLIERS: Record<number, number> = {
  [AgencyTier.IN_HOUSE]: 0,         // 0x
  [AgencyTier.STAFFING_AGENCY]: 0.5, // 0.5x expected salary
  [AgencyTier.GOOD_AGENCY]: 2.0,     // 2.0x expected salary
  [AgencyTier.TOP_TALENT_AGENCY]: 5.0 // 5.0x expected salary
};

export function parseAgencyTier(agency: number | string | undefined): number {
  if (typeof agency === 'string') {
    const norm = agency.trim().toUpperCase();
    if (norm === 'IN_HOUSE' || norm === '1') return AgencyTier.IN_HOUSE;
    if (norm === 'STAFFING_AGENCY' || norm === '2') return AgencyTier.STAFFING_AGENCY;
    if (norm === 'GOOD_AGENCY' || norm === '3') return AgencyTier.GOOD_AGENCY;
    if (norm === 'TOP_TALENT_AGENCY' || norm === '4') return AgencyTier.TOP_TALENT_AGENCY;
  }
  if (typeof agency === 'number' && agency >= 1 && agency <= 4) {
    return agency;
  }
  return AgencyTier.IN_HOUSE;
}

export function normalizeOfferStatus(status: string): string {
  const s = (status || '').trim();
  const lower = s.toLowerCase();
  if (lower === 'ru.found' || lower === 'found' || lower === 'f') return 'f';
  if (lower === 'ru.standing' || lower === 'standing' || lower === 's') return 's';
  if (lower === 'ru.refused' || lower === 'refused' || lower === 'r') return 'r';
  if (lower === 'ru.outdated' || lower === 'outdated' || lower === 'o') return 'o';
  if (lower === 'ru.failed' || lower === 'failed' || lower === 'x') return 'x';
  if (lower === 'ru.accepted' || lower === 'accepted' || lower === 'a') return 'a';
  if (lower === 'ru.looking' || lower === 'looking' || lower === 'l') return 'l';
  return s || 'f';
}

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

export interface ExecutiveOfferRow {
  id: number;
  poacher_company_id: number;
  target_company_id: number;
  target_executive_id: number;
  slot_position: string;
  skill_position: string;
  agency: number;
  status: string;
  expected_salary: number;
  salary: number | null;
  agency_fee: number;
  accelerated: number;
  research_poacher: string | null;
  research_employer: string | null;
  extended_at: string | null;
  created_at: string;
  updated_at: string;
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

export function formatOffer(offer: ExecutiveOfferRow, exec: ExecutiveRow | null) {
  const execObj = exec ? {
    id: exec.id,
    name: exec.name,
    avatar: exec.avatar || 'images/avatars/male_01.png',
    position: exec.position || 'unassigned',
    salary: Number(exec.salary) || 250,
    skills: {
      management: Number(exec.skill_management) || 5,
      accounting: Number(exec.skill_accounting) || 5,
      science: Number(exec.skill_science) || 5,
      communication: Number(exec.skill_communication) || 5
    },
    totalSkill: (Number(exec.skill_management) || 5) + (Number(exec.skill_accounting) || 5) + (Number(exec.skill_science) || 5) + (Number(exec.skill_communication) || 5),
    isCandidate: exec.status === 'candidate',
    status: exec.status,
    age: 35
  } : null;

  return {
    id: offer.id,
    slotPosition: offer.slot_position,
    skillPosition: offer.skill_position,
    agency: Number(offer.agency),
    status: offer.status,
    expectedSalary: Number(offer.expected_salary),
    salary: offer.salary !== null ? Number(offer.salary) : Number(offer.expected_salary),
    agencyFee: Number(offer.agency_fee),
    executiveId: offer.target_executive_id,
    executive: execObj,
    executiveDaysActive: 10,
    executiveAllTrainings: 0,
    executiveRecentTrainings: 0,
    accelerated: Boolean(offer.accelerated),
    extended: offer.extended_at,
    created: offer.created_at,
    researchPoacher: offer.research_poacher ? JSON.parse(offer.research_poacher) : null
  };
}

export function formatHostileOffer(offer: ExecutiveOfferRow, exec: ExecutiveRow | null) {
  const execObj = exec ? {
    id: exec.id,
    name: exec.name,
    avatar: exec.avatar || 'images/avatars/male_01.png',
    position: exec.position || 'unassigned',
    salary: Number(exec.salary) || 250,
    skills: {
      management: Number(exec.skill_management) || 5,
      accounting: Number(exec.skill_accounting) || 5,
      science: Number(exec.skill_science) || 5,
      communication: Number(exec.skill_communication) || 5
    },
    totalSkill: (Number(exec.skill_management) || 5) + (Number(exec.skill_accounting) || 5) + (Number(exec.skill_science) || 5) + (Number(exec.skill_communication) || 5),
    status: exec.status
  } : null;

  return {
    id: offer.id,
    executiveId: offer.target_executive_id,
    executive: execObj,
    expectedSalary: Number(offer.expected_salary),
    salary: offer.salary !== null ? Number(offer.salary) : Number(offer.expected_salary),
    status: offer.status,
    extended: offer.extended_at || offer.created_at,
    companyId: offer.target_company_id,
    poacherCompanyId: offer.poacher_company_id,
    researchEmployer: offer.research_employer ? JSON.parse(offer.research_employer) : null
  };
}

export function seedDefaultExecutives(companyId: number, database: DatabaseSync = db) {
  const existingCount = (database.prepare('SELECT COUNT(*) as count FROM executives WHERE company_id = ?').get(companyId) as { count: number })?.count || 0;
  if (existingCount > 0) return;

  const now = new Date().toISOString();
  const defaults = [
    { name: 'Alexander Wright', pos: 'coo', mgmt: 12, acc: 4, sci: 3, comm: 6, sal: 450 },
    { name: 'Elena Rostova', pos: 'cfo', mgmt: 4, acc: 14, sci: 2, comm: 5, sal: 480 },
    { name: 'David Chen', pos: 'cto', mgmt: 5, acc: 3, sci: 15, comm: 4, sal: 500 }
  ];
  for (const d of defaults) {
    database.prepare(`
      INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
      VALUES (?, ?, 'images/avatars/female_01.png', ?, ?, ?, ?, ?, ?, 'employed', ?)
    `).run(companyId, d.name, d.pos, d.mgmt, d.acc, d.sci, d.comm, d.sal, now);
  }

  const candidates = [
    { name: 'Marcus Vance', mgmt: 8, acc: 6, sci: 7, comm: 9, sal: 320 },
    { name: 'Sophia Sterling', mgmt: 11, acc: 5, sci: 4, comm: 10, sal: 360 },
    { name: 'Lucas Meyer', mgmt: 4, acc: 10, sci: 11, comm: 5, sal: 340 }
  ];
  for (const c of candidates) {
    database.prepare(`
      INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
      VALUES (?, ?, 'images/avatars/male_02.png', 'unassigned', ?, ?, ?, ?, ?, 'candidate', ?)
    `).run(companyId, c.name, c.mgmt, c.acc, c.sci, c.comm, c.sal, now);
  }
}

export function getCompanyExecutives(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM executives
    WHERE company_id = ? AND status != 'candidate'
    ORDER BY id ASC
  `).all(companyId) as unknown as ExecutiveRow[];

  return rows.map(formatExecutive);
}

export function getExecutiveCandidates(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM executives
    WHERE company_id = ? AND status = 'candidate'
    ORDER BY id DESC LIMIT 5
  `).all(companyId) as unknown as ExecutiveRow[];

  return rows.map(formatExecutive);
}

export function getExecutiveById(companyId: number, executiveId: number) {
  const row = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!row) throw new Error('Executive not found');
  return formatExecutive(row);
}

export function hireExecutive(companyId: number, candidateId: number, position: string = 'unassigned') {
  const c = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(candidateId, companyId) as unknown as ExecutiveRow | undefined;
  if (!c) throw new Error('Candidate not found');
  if (c.status !== 'candidate') throw new Error('Executive is not an available candidate');

  const comp = getCompanyById(companyId);
  if (!comp) throw new Error('Company not found');

  const countRow = db.prepare("SELECT COUNT(*) AS count FROM executives WHERE company_id = ? AND status = 'employed'").get(companyId) as { count: number };
  const maxSlots = 4 + (Number(comp.extra_executive_slots) || 0);
  if (countRow.count >= maxSlots) {
    throw new Error(`Executive slot limit reached (${countRow.count}/${maxSlots}). Unlock more slots with SimBoosts.`);
  }

  return runInTransaction(async () => {
    const updated = db.prepare("UPDATE executives SET status = 'employed', position = ? WHERE id = ? AND company_id = ? AND status = 'candidate'").run(position, candidateId, companyId);
    if (updated.changes !== 1) throw new Error('Failed to hire candidate');
    const row = db.prepare('SELECT * FROM executives WHERE id = ?').get(candidateId) as unknown as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

export function fireExecutive(companyId: number, executiveId: number) {
  const exec = db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!exec) throw new Error('Employed executive not found');

  // Dismissal severance = executive.salary * 3
  const severance = Math.round((Number(exec.salary) || 250) * 3);

  return runInTransaction(async () => {
    updateCompanyMoney(companyId, -severance);
    const deleted = db.prepare("DELETE FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").run(executiveId, companyId);
    if (deleted.changes !== 1) throw new Error('Employed executive not found');
    return {
      success: true,
      severance,
      moneyDelta: -severance
    };
  }, { immediate: true });
}

export function assignExecutive(companyId: number, executiveId: number, position: string) {
  return runInTransaction(async () => {
    const updated = db.prepare("UPDATE executives SET position = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(position, executiveId, companyId);
    if (updated.changes !== 1) throw new Error('Employed executive not found');
    const row = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

export function updateExecutive(
  companyId: number,
  executiveId: number,
  updates: { salary?: number; position?: string; strikeUntil?: string | null; plansToRetire?: boolean }
) {
  const exec = db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!exec) throw new Error('Employed executive not found');

  return runInTransaction(async () => {
    if (updates.salary !== undefined) {
      if (!Number.isFinite(updates.salary) || updates.salary <= 0) {
        throw new Error('Salary must be a positive number');
      }
      db.prepare("UPDATE executives SET salary = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(updates.salary, executiveId, companyId);
    }
    if (updates.position !== undefined) {
      db.prepare("UPDATE executives SET position = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(updates.position, executiveId, companyId);
    }
    const row = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

export function trainExecutive(companyId: number, executiveId: number) {
  const trainingCost = 2500;
  const exec = db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!exec) {
    throw new Error('Employed executive not found');
  }

  const comp = getCompanyById(companyId);
  if (!comp || comp.money < trainingCost) {
    throw new Error('Not enough money for executive training');
  }

  return runInTransaction(async () => {
    updateCompanyMoney(companyId, -trainingCost);
    const updated = db.prepare(`
      UPDATE executives
      SET skill_management = skill_management + 1,
          skill_accounting = skill_accounting + 1,
          skill_science = skill_science + 1,
          skill_communication = skill_communication + 1
      WHERE id = ? AND company_id = ? AND status = 'employed'
    `).run(executiveId, companyId);
    if (updated.changes !== 1) throw new Error('Executive training failed');

    const row = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
    return {
      executive: formatExecutive(row),
      cost: trainingCost
    };
  }, { immediate: true });
}

/**
 * Executive Poaching & Headhunter Agencies System
 */

export interface CreatePoachingOfferInput {
  slotPosition?: string;
  skillPosition?: string;
  agency?: number | string;
  targetExecutiveId?: number;
  targetCompanyId?: number;
  expectedSalary?: number;
  ageRange?: unknown;
  hasTrainings?: boolean;
  onlyUnemployed?: boolean;
}

export async function createPoachingOffer(poacherCompanyId: number, input: CreatePoachingOfferInput) {
  const agencyTier = parseAgencyTier(input.agency);
  const multiplier = AGENCY_FEE_MULTIPLIERS[agencyTier] ?? 0;
  const slotPos = (input.slotPosition || 'coo').toLowerCase();
  const skillPos = (input.skillPosition || 'o').toLowerCase();

  let targetExecutive: ExecutiveRow | undefined;
  let targetCompanyId = input.targetCompanyId;

  if (input.targetExecutiveId) {
    targetExecutive = db.prepare('SELECT * FROM executives WHERE id = ?').get(input.targetExecutiveId) as unknown as ExecutiveRow | undefined;
    if (!targetExecutive) {
      throw new Error('Target executive not found');
    }
    if (targetExecutive.company_id === poacherCompanyId) {
      throw new Error('Cannot poach your own executive');
    }
    targetCompanyId = targetExecutive.company_id;
  } else {
    // Find an employed executive at another company matching slot/skill, or any other company's executive
    const potentialTargets = db.prepare(`
      SELECT * FROM executives
      WHERE company_id != ? AND status = 'employed'
      ORDER BY RANDOM() LIMIT 1
    `).all(poacherCompanyId) as unknown as ExecutiveRow[];

    if (potentialTargets.length > 0) {
      targetExecutive = potentialTargets[0];
      targetCompanyId = targetExecutive.company_id;
    } else {
      // Create a poachable candidate executive in another company or global pool
      const otherCompany = db.prepare('SELECT company_id FROM companies WHERE company_id != ? LIMIT 1').get(poacherCompanyId) as { company_id: number } | undefined;
      const foreignCompanyId = otherCompany ? otherCompany.company_id : 999999;
      targetCompanyId = foreignCompanyId;

      const baseSkill = agencyTier === AgencyTier.TOP_TALENT_AGENCY ? 20 :
                         agencyTier === AgencyTier.GOOD_AGENCY ? 15 :
                         agencyTier === AgencyTier.STAFFING_AGENCY ? 10 : 6;
      const salaryByTier = agencyTier === AgencyTier.TOP_TALENT_AGENCY ? 1500 :
                           agencyTier === AgencyTier.GOOD_AGENCY ? 800 :
                           agencyTier === AgencyTier.STAFFING_AGENCY ? 500 : 300;

      const nowIso = new Date().toISOString();
      const insertResult = db.prepare(`
        INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
        VALUES (?, ?, 'images/avatars/male_01.png', ?, ?, ?, ?, ?, ?, 'employed', ?)
      `).run(
        foreignCompanyId,
        `Executive ${Math.floor(1000 + Math.random() * 9000)}`,
        slotPos,
        baseSkill,
        baseSkill,
        baseSkill,
        baseSkill,
        salaryByTier,
        nowIso
      );
      targetExecutive = db.prepare('SELECT * FROM executives WHERE id = ?').get(insertResult.lastInsertRowid) as unknown as ExecutiveRow;
    }
  }

  const expectedSalary = input.expectedSalary ?? Number(targetExecutive?.salary || 400);
  const agencyFee = Math.round(expectedSalary * multiplier);

  const poacherComp = getCompanyById(poacherCompanyId);
  if (!poacherComp || poacherComp.money < agencyFee) {
    throw new Error(`Insufficient funds for agency fee ($${agencyFee})`);
  }

  return runInTransaction(async () => {
    // Deduct agency fee
    if (agencyFee > 0) {
      updateCompanyMoney(poacherCompanyId, -agencyFee);
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO executive_offers (
        poacher_company_id, target_company_id, target_executive_id,
        slot_position, skill_position, agency, status,
        expected_salary, salary, agency_fee, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'f', ?, NULL, ?, ?, ?)
    `).run(
      poacherCompanyId,
      targetCompanyId,
      targetExecutive!.id,
      slotPos,
      skillPos,
      agencyTier,
      expectedSalary,
      agencyFee,
      now,
      now
    );

    const offerRow = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(result.lastInsertRowid) as unknown as ExecutiveOfferRow;
    return formatOffer(offerRow, targetExecutive!);
  }, { immediate: true });
}

export function getPoachingOffers(poacherCompanyId: number) {
  const rows = db.prepare(`
    SELECT * FROM executive_offers
    WHERE poacher_company_id = ?
    ORDER BY id DESC
  `).all(poacherCompanyId) as unknown as ExecutiveOfferRow[];

  return rows.map(offer => {
    const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(offer.target_executive_id) as unknown as ExecutiveRow | undefined;
    return formatOffer(offer, exec || null);
  });
}

export function getPoachingOfferById(poacherCompanyId: number, offerId: number) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, poacherCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Poaching offer not found');
  const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(offer.target_executive_id) as unknown as ExecutiveRow | undefined;
  return formatOffer(offer, exec || null);
}

export async function updatePoachingOffer(
  poacherCompanyId: number,
  offerId: number,
  payload: { status?: string; executive?: boolean; salary?: number; accelerated?: boolean }
) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, poacherCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Poaching offer not found');

  return runInTransaction(async () => {
    let nextStatus = offer.status;
    let salary = offer.salary;
    let extendedAt = offer.extended_at;
    let accelerated = offer.accelerated;
    const now = new Date().toISOString();

    if (payload.status) {
      nextStatus = normalizeOfferStatus(payload.status);
    }

    if (payload.executive || payload.salary !== undefined) {
      if (payload.salary !== undefined) {
        if (!Number.isFinite(payload.salary) || payload.salary <= 0) {
          throw new Error('Salary must be a positive number');
        }
        salary = payload.salary;
      } else if (!salary) {
        salary = offer.expected_salary;
      }
      nextStatus = 's'; // ru.STANDING
      extendedAt = now;
    }

    if (payload.accelerated) {
      accelerated = 1;
    }

    db.prepare(`
      UPDATE executive_offers
      SET status = ?, salary = ?, extended_at = ?, accelerated = ?, updated_at = ?
      WHERE id = ? AND poacher_company_id = ?
    `).run(nextStatus, salary, extendedAt, accelerated, now, offerId, poacherCompanyId);

    const updatedRow = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;
    const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(updatedRow.target_executive_id) as unknown as ExecutiveRow | undefined;
    return formatOffer(updatedRow, exec || null);
  }, { immediate: true });
}

export async function dismissPoachingOffer(poacherCompanyId: number, offerId: number) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, poacherCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Poaching offer not found');

  return runInTransaction(async () => {
    db.prepare('DELETE FROM executive_offers WHERE id = ? AND poacher_company_id = ?').run(offerId, poacherCompanyId);
    return { success: true };
  }, { immediate: true });
}

export async function refreshPoachingOffer(poacherCompanyId: number, offerId: number) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, poacherCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Poaching offer not found');

  return runInTransaction(async () => {
    const now = new Date().toISOString();
    db.prepare("UPDATE executive_offers SET status = 'f', updated_at = ? WHERE id = ? AND poacher_company_id = ?").run(now, offerId, poacherCompanyId);
    const updated = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;
    const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(updated.target_executive_id) as unknown as ExecutiveRow | undefined;
    return formatOffer(updated, exec || null);
  }, { immediate: true });
}

/**
 * Research employer / poacher (Costs 5 SimBoosts)
 */
export async function researchEmployerByPoacher(poacherCompanyId: number, offerId: number) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, poacherCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Poaching offer not found');

  const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(offer.target_executive_id) as unknown as ExecutiveRow | undefined;
  const targetComp = getCompanyById(offer.target_company_id);

  const RESEARCH_COST_SB = 5;

  return runInTransaction(async () => {
    updateCompanySimBoosts(poacherCompanyId, -RESEARCH_COST_SB);

    const researchData = {
      marketSalary: Math.round((Number(exec?.salary) || 400) * 1.1),
      acceptingSalary: Math.round(Number(offer.expected_salary) * 1.05),
      employerCompanyValue: Number(targetComp?.money) || 500000,
      employerAcceptanceRate: 0.35,
      averageAcceptedIncrease: 1.25,
      averageRefusedIncrease: 1.5,
      employerAcceptedOffersCount: 2,
      employerRejectedOffersCount: 4
    };

    const researchJson = JSON.stringify(researchData);
    const now = new Date().toISOString();

    db.prepare('UPDATE executive_offers SET research_poacher = ?, updated_at = ? WHERE id = ?').run(researchJson, now, offerId);
    const updatedOffer = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;

    const formatted = formatOffer(updatedOffer, exec || null);
    return {
      ...formatted,
      offer: formatted,
      simboostsDelta: -RESEARCH_COST_SB
    };
  }, { immediate: true });
}

export function getHostileOffers(targetCompanyId: number) {
  const rows = db.prepare(`
    SELECT * FROM executive_offers
    WHERE target_company_id = ? AND status IN ('s', 'f', 'STANDING', 'FOUND')
    ORDER BY id DESC
  `).all(targetCompanyId) as unknown as ExecutiveOfferRow[];

  return rows.map(offer => {
    const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(offer.target_executive_id) as unknown as ExecutiveRow | undefined;
    return formatHostileOffer(offer, exec || null);
  });
}

export function getHostileOfferById(targetCompanyId: number, offerId: number) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND target_company_id = ?').get(offerId, targetCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Hostile offer not found');
  const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(offer.target_executive_id) as unknown as ExecutiveRow | undefined;
  return formatHostileOffer(offer, exec || null);
}

export async function researchPoacherByEmployer(targetCompanyId: number, offerId: number) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND target_company_id = ?').get(offerId, targetCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Hostile offer not found');

  const exec = db.prepare('SELECT * FROM executives WHERE id = ?').get(offer.target_executive_id) as unknown as ExecutiveRow | undefined;
  const poacherComp = getCompanyById(offer.poacher_company_id);

  const RESEARCH_COST_SB = 5;

  return runInTransaction(async () => {
    updateCompanySimBoosts(targetCompanyId, -RESEARCH_COST_SB);

    const researchData = {
      marketSalary: Math.round((Number(exec?.salary) || 400) * 1.1),
      poacherCompanyValue: Number(poacherComp?.money) || 750000,
      poacherAverageSalary: 450,
      poacherFiredEmployeesCount: 0,
      poacherAverageYearsSpendAtCompany: 1.5
    };

    const researchJson = JSON.stringify(researchData);
    const now = new Date().toISOString();

    db.prepare('UPDATE executive_offers SET research_employer = ?, updated_at = ? WHERE id = ?').run(researchJson, now, offerId);
    const updatedOffer = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;

    const formatted = formatHostileOffer(updatedOffer, exec || null);
    return {
      ...formatted,
      offer: formatted,
      simboostsDelta: -RESEARCH_COST_SB
    };
  }, { immediate: true });
}

export interface CounterHostileOfferInput {
  salary?: number;
  action?: 'counter' | 'accept' | 'decline';
  accept?: boolean;
}

export async function counterHostileOffer(targetCompanyId: number, offerId: number, body: CounterHostileOfferInput) {
  const offer = db.prepare('SELECT * FROM executive_offers WHERE id = ? AND target_company_id = ?').get(offerId, targetCompanyId) as unknown as ExecutiveOfferRow | undefined;
  if (!offer) throw new Error('Hostile offer not found');

  const exec = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(offer.target_executive_id, targetCompanyId) as unknown as ExecutiveRow | undefined;
  if (!exec) throw new Error('Target executive not found at your company');

  const isAccept = body.action === 'accept' || body.accept === true;
  const isDecline = body.action === 'decline' || body.accept === false;
  const isCounter = body.action === 'counter' || (body.salary !== undefined && !isAccept && !isDecline);

  return runInTransaction(async () => {
    const now = new Date().toISOString();

    if (isCounter && body.salary !== undefined) {
      if (!Number.isFinite(body.salary) || body.salary <= 0) {
        throw new Error('Counter salary must be a positive number');
      }
      // Target employer counters with higher salary (retaining executive)
      db.prepare("UPDATE executives SET salary = ? WHERE id = ? AND company_id = ?").run(body.salary, exec.id, targetCompanyId);
      db.prepare("UPDATE executive_offers SET status = 'r', updated_at = ? WHERE id = ?").run(now, offerId);

      const updatedExec = db.prepare('SELECT * FROM executives WHERE id = ?').get(exec.id) as unknown as ExecutiveRow;
      const updatedOffer = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;

      return {
        success: true,
        retained: true,
        stayed: true,
        executive: formatExecutive(updatedExec),
        offer: formatHostileOffer(updatedOffer, updatedExec)
      };
    }

    if (isAccept) {
      // Declines to counter / accepts departure (executive leaves, 0 severance)
      // Executive leaves employer company and transfers to poacher company
      const offeredSalary = offer.salary || offer.expected_salary;
      db.prepare("UPDATE executives SET company_id = ?, salary = ?, position = 'unassigned', status = 'employed' WHERE id = ?").run(
        offer.poacher_company_id,
        offeredSalary,
        exec.id
      );
      db.prepare("UPDATE executive_offers SET status = 'a', updated_at = ? WHERE id = ?").run(now, offerId);

      const transferredExec = db.prepare('SELECT * FROM executives WHERE id = ?').get(exec.id) as unknown as ExecutiveRow;
      const updatedOffer = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;

      return {
        success: true,
        stayed: false,
        moneyDelta: 0,
        executive: formatExecutive(transferredExec),
        offer: formatHostileOffer(updatedOffer, transferredExec)
      };
    }

    // Default decline/reject
    db.prepare("UPDATE executive_offers SET status = 'r', updated_at = ? WHERE id = ?").run(now, offerId);
    const updatedOffer = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;

    return {
      success: true,
      stayed: true,
      retained: true,
      offer: formatHostileOffer(updatedOffer, exec)
    };
  }, { immediate: true });
}

export async function letGoHostileOffer(targetCompanyId: number, offerId: number) {
  return counterHostileOffer(targetCompanyId, offerId, { action: 'accept' });
}

export async function rejectHostileOffer(targetCompanyId: number, offerId: number) {
  return counterHostileOffer(targetCompanyId, offerId, { action: 'decline' });
}
