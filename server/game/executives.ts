import { db } from '../db/database.ts';
import type { DatabaseSync } from 'node:sqlite';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from './company.ts';
import { recordCashLedger } from './cash-ledger.ts';
import { runInTransaction } from '../db/transaction.ts';
import { virtualClock } from '../core/virtual-clock.ts';

export const EXECUTIVE_TRAINING_COST = 30000;

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

// Issue #167/#165: the settling-in window, strike deadline and retirement
// intent are part of the executive lifecycle contract. Older databases
// predate these columns; ALTER defensively (no-op if present or if the
// table does not exist yet — a fresh migrations run creates the full shape).
{
  const executivesTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'executives'"
  ).get();
  if (executivesTable) {
    const cols = db.prepare('PRAGMA table_info(executives)').all() as Array<{ name: string }>;
    const adds: Record<string, string> = {
      work_history_accelerated: 'INTEGER DEFAULT 0',
      plans_to_retire: 'INTEGER DEFAULT 0',
      strike_until: 'TEXT'
    };
    for (const [column, ddl] of Object.entries(adds)) {
      if (!cols.some(c => c.name === column)) {
        db.exec(`ALTER TABLE executives ADD COLUMN ${column} ${ddl}`);
      }
    }
  }
}

// Executive trainings (Issue #165): the original client schedules a training
// (POST), can rush it with SimBoosts (PATCH) or cancel it (DELETE), and the
// executive's skills improve when the 27h window completes.
db.exec(`
  CREATE TABLE IF NOT EXISTS executive_trainings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    executive_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    datetime TEXT NOT NULL,
    accelerated INTEGER DEFAULT 0,
    skills_applied INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

export const EXECUTIVE_TRAINING_WINDOW_S = 97200; // 27h (client constant Y$)

/** The executive's in-flight training, if any (started less than 27h ago). */
export function getActiveTraining(executiveId: number) {
  return db.prepare(`
    SELECT * FROM executive_trainings
    WHERE executive_id = ? AND skills_applied = 0
    ORDER BY id DESC LIMIT 1
  `).get(executiveId) as { id: number; executive_id: number; company_id: number; datetime: string; accelerated: number; skills_applied: number; created_at: string } | undefined;
}

/** Apply skill gains for every training whose 27h window has elapsed. */
export function resolveCompletedTrainings(companyId: number) {
  const cutoff = new Date(Date.now() - EXECUTIVE_TRAINING_WINDOW_S * 1000).toISOString();
  const due = db.prepare(`
    SELECT id, executive_id FROM executive_trainings
    WHERE company_id = ? AND skills_applied = 0
      AND datetime <= ?
  `).all(companyId, cutoff) as Array<{ id: number; executive_id: number }>;
  for (const row of due) {
    const applied = db.prepare(`
      UPDATE executives
      SET skill_management = skill_management + 1, skill_accounting = skill_accounting + 1,
          skill_science = skill_science + 1, skill_communication = skill_communication + 1
      WHERE id = ?
    `).run(row.executive_id);
    if (applied.changes === 1) {
      db.prepare('UPDATE executive_trainings SET skills_applied = 1 WHERE id = ?').run(row.id);
    }
  }
}

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
export function normalizePositionCode(pos: string | null | undefined): string {
  if (!pos) return 'none';
  const lower = pos.toLowerCase();
  if (lower === 'o' || lower === 'coo') return 'o';
  if (lower === 'f' || lower === 'cfo') return 'f';
  if (lower === 'm' || lower === 'cmo') return 'm';
  if (lower === 't' || lower === 'cto') return 't';
  if (lower === 'v' || lower === 'coo_apprentice' || lower === 'coo-apprentice') return 'v';
  if (lower === 'x' || lower === 'cfo_apprentice' || lower === 'cfo-apprentice') return 'x';
  if (lower === 'y' || lower === 'cmo_apprentice' || lower === 'cmo-apprentice') return 'y';
  if (lower === 'z' || lower === 'cto_apprentice' || lower === 'cto-apprentice') return 'z';
  if (lower === '1' || lower === 'g1') return '1';
  if (lower === '2' || lower === 'g2') return '2';
  if (lower === '3' || lower === 'g3') return '3';
  if (lower === '4' || lower === 'g4') return '4';
  if (lower === '5' || lower === 'g5') return '5';
  if (lower === 'none' || lower === 'unassigned') return 'none';
  return lower;
}

interface GeneLimits {
  eyes: number;
  hair: number;
  tatoos: number;
  cloths: number;
  accessories: number;
}

const MALE_GENES: Record<string, GeneLimits> = {
  '01': { eyes: 4, hair: 10, tatoos: 1, cloths: 18, accessories: 4 },
  '02': { eyes: 4, hair: 14, tatoos: 1, cloths: 18, accessories: 4 },
  '03': { eyes: 4, hair: 10, tatoos: 1, cloths: 18, accessories: 4 },
  '04': { eyes: 4, hair: 32, tatoos: 1, cloths: 18, accessories: 4 },
  '05': { eyes: 4, hair: 23, tatoos: 1, cloths: 18, accessories: 4 },
};

const FEMALE_GENES: Record<string, GeneLimits> = {
  '01': { eyes: 5, hair: 11, tatoos: 1, cloths: 16, accessories: 5 },
  '02': { eyes: 5, hair: 7,  tatoos: 1, cloths: 17, accessories: 5 },
  '05': { eyes: 5, hair: 7,  tatoos: 1, cloths: 23, accessories: 5 },
};

const FEMALE_NAMES = new Set(['elena', 'sophia', 'sarah', 'emma', 'olivia', 'isabella', 'mia', 'ava', 'chloe', 'emily', 'grace', 'hannah', 'lily', 'natalie', 'zoe', 'anna', 'laura', 'maria', 'rachel', 'jessica', 'victoria', 'lucy']);
const MALE_NAMES = new Set(['alexander', 'david', 'marcus', 'lucas', 'gordon', 'maitre', 'john', 'michael', 'james', 'robert', 'william', 'richard', 'thomas', 'charles', 'daniel', 'matthew', 'anthony', 'donald', 'paul', 'mark', 'george', 'steven', 'edward', 'brian', 'kevin']);

function generateDeterministicGenome(seed: number | string, avatar?: string | null, name?: string | null): { genome: string; age: number } {
  let hash = 0;
  const str = String(seed || '') + String(avatar || '') + String(name || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash);

  const firstName = String(name || '').trim().split(/\s+/)[0]?.toLowerCase();
  let isFemale = false;
  if (avatar && avatar.includes('female')) {
    isFemale = true;
  } else if (avatar && avatar.includes('male')) {
    isFemale = false;
  } else if (firstName && FEMALE_NAMES.has(firstName)) {
    isFemale = true;
  } else if (firstName && MALE_NAMES.has(firstName)) {
    isFemale = false;
  } else {
    isFemale = (h % 3 === 0);
  }
  const gender = isFemale ? 'female' : 'male';
  const geneDict = isFemale ? FEMALE_GENES : MALE_GENES;
  const modelKeys = Object.keys(geneDict);
  const model = modelKeys[h % modelKeys.length];
  const limits = geneDict[model];

  const eyes = (Math.floor(h / 7)) % limits.eyes;
  const hair = (Math.floor(h / 13)) % limits.hair;
  const tatoos = 0;
  const cloths = (Math.floor(h / 19)) % limits.cloths;
  const accessories = (Math.floor(h / 23)) % limits.accessories;

  const age = 28 + (h % 35);
  const genome = `${gender}-${model}-${eyes}-${hair}-${tatoos}-${cloths}-${accessories}`;
  return { genome, age };
}

function validIsoOrNull(val: unknown): string | null {
  if (!val || typeof val !== 'string') return null;
  const parsed = Date.parse(val);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function formatExecutive(e: ExecutiveRow) {
  const normPos = normalizePositionCode(e.position);
  const mgmt = Number(e.skill_management) || 0;
  const acct = Number(e.skill_accounting) || 0;
  const sci = Number(e.skill_science) || 0;
  const comm = Number(e.skill_communication) || 0;
  const avatar = e.avatar || 'images/avatars/male_01.png';
  const gen = generateDeterministicGenome(e.id || e.name, avatar, e.name);
  const workStart = new Date(
    new Date(validIsoOrNull(e.created_at) || Date.now() - 86400000).getTime() - virtualClock.getOffsetMs()
  ).toISOString();
  const training = getActiveTraining(e.id);
  const daysActive = Math.max(0, Math.floor((Date.now() - new Date(workStart).getTime()) / 86400000));
  return {
    id: e.id,
    name: e.name,
    avatar,
    genome: gen.genome,
    age: gen.age,
    position: normPos,
    skills: {
      coo: mgmt,
      cfo: acct,
      cmo: comm,
      cto: sci,
      management: mgmt,
      accounting: acct,
      science: sci,
      communication: comm
    },
    currentWorkHistory: {
      employerId: e.company_id,
      position: normPos,
      daysActive,
      // Issue #167: the client derives the 3h settling-in window from this
      // start timestamp on the BROWSER clock, so the start must be expressed
      // in server (virtual) time — otherwise a time warp can never close the
      // window and executives stay stuck "settling in" forever.
      start: workStart,
      accelerated: Boolean(e.work_history_accelerated)
    },
    workHistory: [{
      employerId: e.company_id,
      position: normPos,
      start: workStart,
      daysActive
    }],
    isCandidate: (e.status || '') === 'candidate',
    // Issue #165: candidates render "Expected salary: ${salary}/day" — an
    // undefined value surfaced as $NaN in the hiring modal.
    expectedSalary: Number(e.salary) || 0,
    strikeUntil: validIsoOrNull(e.strike_until),
    plansToRetire: Boolean(e.plans_to_retire),
    currentTraining: training ? {
      id: training.id,
      datetime: training.datetime,
      accelerated: Boolean(training.accelerated)
    } : undefined,
    salary: Number(e.salary) || 250,
    status: e.status || 'employed',
    trainingFinishAt: e.training_finish_at,
    totalSkill: mgmt + acct + sci + comm
  };
}
export function formatOffer(offer: ExecutiveOfferRow, exec: ExecutiveRow | null) {
  const execObj = exec ? formatExecutive(exec) : null;
  return {
    id: offer.id,
    slotPosition: normalizePositionCode(offer.slot_position),
    skillPosition: offer.skill_position || 'o',
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
    extended: validIsoOrNull(offer.extended_at) || validIsoOrNull(offer.created_at) || new Date().toISOString(),
    created: validIsoOrNull(offer.created_at) || new Date().toISOString(),
    researchPoacher: offer.research_poacher ? JSON.parse(offer.research_poacher) : null
  };
}

export function formatHostileOffer(offer: ExecutiveOfferRow, exec: ExecutiveRow | null) {
  const execObj = exec ? formatExecutive(exec) : null;
  return {
    id: offer.id,
    executiveId: offer.target_executive_id,
    executive: execObj,
    expectedSalary: Number(offer.expected_salary),
    salary: offer.salary !== null ? Number(offer.salary) : Number(offer.expected_salary),
    status: offer.status,
    extended: validIsoOrNull(offer.extended_at) || validIsoOrNull(offer.created_at) || new Date().toISOString(),
    created: validIsoOrNull(offer.created_at) || new Date().toISOString(),
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
    { name: 'Alexander Wright', avatar: 'images/avatars/male_01.png', pos: 'coo', mgmt: 12, acc: 4, sci: 3, comm: 6, sal: 450 },
    { name: 'Elena Rostova', avatar: 'images/avatars/female_01.png', pos: 'cfo', mgmt: 4, acc: 14, sci: 2, comm: 5, sal: 480 },
    { name: 'David Chen', avatar: 'images/avatars/male_02.png', pos: 'cto', mgmt: 5, acc: 3, sci: 15, comm: 4, sal: 500 }
  ];
  for (const d of defaults) {
    database.prepare(`
      INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'employed', ?)
    `).run(companyId, d.name, d.avatar, d.pos, d.mgmt, d.acc, d.sci, d.comm, d.sal, now);
  }

  const candidates = [
    { name: 'Marcus Vance', avatar: 'images/avatars/male_03.png', mgmt: 8, acc: 6, sci: 7, comm: 9, sal: 320 },
    { name: 'Sophia Sterling', avatar: 'images/avatars/female_02.png', mgmt: 11, acc: 5, sci: 4, comm: 10, sal: 360 },
    { name: 'Lucas Meyer', avatar: 'images/avatars/male_04.png', mgmt: 4, acc: 10, sci: 11, comm: 5, sal: 340 }
  ];
  for (const c of candidates) {
    database.prepare(`
      INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
      VALUES (?, ?, ?, 'unassigned', ?, ?, ?, ?, ?, 'candidate', ?)
    `).run(companyId, c.name, c.avatar, c.mgmt, c.acc, c.sci, c.comm, c.sal, now);
  }
}

export function getCompanyExecutives(companyId: number) {
  resolveCompletedTrainings(companyId);
  const rows = db.prepare(`
    SELECT * FROM executives
    WHERE company_id = ? AND status != 'candidate'
    ORDER BY id ASC
  `).all(companyId) as unknown as ExecutiveRow[];

  return rows.map(formatExecutive);
}

export function getExecutiveCandidates(companyId: number) {
  resolveCompletedTrainings(companyId);
  const rows = db.prepare(`
    SELECT * FROM executives
    WHERE company_id = ? AND status = 'candidate'
    ORDER BY id DESC LIMIT 5
  `).all(companyId) as unknown as ExecutiveRow[];

  return rows.map(formatExecutive);
}

export function getExecutiveById(companyId: number, executiveId: number) {
  resolveCompletedTrainings(companyId);
  const row = db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  if (!row) throw new Error('Executive not found');
  return formatExecutive(row);
}

export function hireExecutive(companyId: number, candidateId: number, position: string = 'unassigned') {
  return runInTransaction(async () => {
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

    // #154: the academy raises the starting skills of in-house candidates
    // (same 5-levels-per-point cadence as training; max +2).
    const startingBonus = academySkillBonus(getAcademyLevels(companyId).active);
    const updated = startingBonus > 0
      ? db.prepare(`UPDATE executives SET status = 'employed', position = ?,
          skill_management = skill_management + ?,
          skill_accounting = skill_accounting + ?,
          skill_science = skill_science + ?,
          skill_communication = skill_communication + ?
          WHERE id = ? AND company_id = ? AND status = 'candidate'`)
        .run(position, startingBonus, startingBonus, startingBonus, startingBonus, candidateId, companyId)
      : db.prepare("UPDATE executives SET status = 'employed', position = ? WHERE id = ? AND company_id = ? AND status = 'candidate'")
        .run(position, candidateId, companyId);
    if (updated.changes !== 1) throw new Error('Failed to hire candidate');
    const row = db.prepare('SELECT * FROM executives WHERE id = ?').get(candidateId) as unknown as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

export function fireExecutive(companyId: number, executiveId: number) {
  return runInTransaction(async () => {
    const exec = db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
    if (!exec) throw new Error('Employed executive not found');

    // Dismissal severance = executive.salary * 3
    const severance = Math.round((Number(exec.salary) || 250) * 3);

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

export interface UpdateExecutiveInput {
  salary?: number;
  position?: string;
  strikeUntil?: string | null;
  plansToRetire?: boolean;
  rushSettle?: boolean;
}

export function updateExecutive(
  companyId: number,
  executiveId: number,
  updates: UpdateExecutiveInput
) {
  return runInTransaction(async () => {
    const exec = db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
    if (!exec) throw new Error('Employed executive not found');

    if (updates.salary !== undefined) {
      if (!Number.isFinite(updates.salary) || updates.salary <= 0) {
        throw new Error('Salary must be a positive number');
      }
      db.prepare("UPDATE executives SET salary = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(updates.salary, executiveId, companyId);
    }
    if (updates.position !== undefined) {
      db.prepare("UPDATE executives SET position = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(updates.position, executiveId, companyId);
    }

    // Issue #165: rush settling in. The client prices the rush as
    // ceil((start + 3h - now) / 6min) SimBoosts; settle instantly by
    // marking the work history accelerated so the client-side window
    // (which excludes accelerated executives) closes.
    if (updates.rushSettle === true) {
      const startMs = new Date(validIsoOrNull(exec.created_at) || Date.now()).getTime();
      const settleEndMs = startMs + 3 * 3600000;
      const alreadySettled = Boolean(exec.work_history_accelerated) || settleEndMs <= Date.now();
      if (!alreadySettled) {
        const cost = Math.max(1, Math.ceil((settleEndMs - Date.now()) / 360000));
        const comp = getCompanyById(companyId);
        if (!comp || Number(comp.simboosts) < cost) {
          throw new Error(`Not enough SimBoosts to rush settling in (requires ${cost})`);
        }
        updateCompanySimBoosts(companyId, -cost);
        db.prepare('UPDATE executives SET work_history_accelerated = 1 WHERE id = ?').run(executiveId);
      }
    }

    if (updates.strikeUntil !== undefined) {
      const iso = updates.strikeUntil === null ? null : validIsoOrNull(updates.strikeUntil);
      db.prepare('UPDATE executives SET strike_until = ? WHERE id = ?').run(iso, executiveId);
    }
    if (updates.plansToRetire !== undefined) {
      db.prepare('UPDATE executives SET plans_to_retire = ? WHERE id = ?').run(updates.plansToRetire ? 1 : 0, executiveId);
    }

    const row = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

// Issue #165: the original client schedules a training for $10,000 (client
// constant gPt) that completes 27h later, with a SimBoosts rush priced at
// ceil(remaining / 6min) — the same pricing formula used for settling in.
export const EXECUTIVE_TRAINING_MONEY_COST = 10000;

function serializeTraining(row: { id: number; datetime: string; accelerated: number }) {
  return { id: row.id, datetime: row.datetime, accelerated: Boolean(row.accelerated) };
}

export function scheduleExecutiveTraining(companyId: number, executiveId: number) {
  return runInTransaction(async () => {
    const exec = db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
    if (!exec) throw new Error('Employed executive not found');
    if (getActiveTraining(executiveId)) throw new Error('Executive already has a training in progress');
    const count = db.prepare('SELECT COUNT(*) AS n FROM executive_trainings WHERE executive_id = ?').get(executiveId) as { n: number };
    if (count.n >= 20) throw new Error('Executive training limit reached (20)');

    const comp = getCompanyById(companyId);
    if (!comp || comp.money < EXECUTIVE_TRAINING_MONEY_COST) {
      throw new Error(`Not enough money for executive training ($${EXECUTIVE_TRAINING_MONEY_COST})`);
    }

    const now = new Date();
    recordCashLedger({
      companyId,
      amount: -EXECUTIVE_TRAINING_MONEY_COST,
      category: 'h',
      description: 'Executive training',
      descriptionKey: '1-training',
      details: { executiveId, name: exec.name }
    });
    updateCompanyMoney(companyId, -EXECUTIVE_TRAINING_MONEY_COST, true);

    const inserted = db.prepare(`
      INSERT INTO executive_trainings (executive_id, company_id, datetime, accelerated, skills_applied, created_at)
      VALUES (?, ?, ?, 0, 0, ?)
    `).run(executiveId, companyId, now.toISOString(), now.toISOString());
    const row = db.prepare('SELECT * FROM executive_trainings WHERE id = ?').get(inserted.lastInsertRowid) as { id: number; datetime: string; accelerated: number };
    return { training: serializeTraining(row), moneyDelta: -EXECUTIVE_TRAINING_MONEY_COST };
  }, { immediate: true });
}

export function rushExecutiveTraining(companyId: number, executiveId: number, trainingId: number) {
  return runInTransaction(async () => {
    const training = db.prepare('SELECT * FROM executive_trainings WHERE id = ? AND executive_id = ? AND company_id = ? AND skills_applied = 0')
      .get(trainingId, executiveId, companyId) as { id: number; datetime: string; accelerated: number } | undefined;
    if (!training) throw new Error('Training not found or already finished');

    const finishMs = new Date(training.datetime).getTime() + EXECUTIVE_TRAINING_WINDOW_S * 1000;
    const cost = Math.max(1, Math.ceil((finishMs - Date.now()) / 360000));
    const comp = getCompanyById(companyId);
    if (!comp || Number(comp.simboosts) < cost) {
      throw new Error(`Not enough SimBoosts to rush training (requires ${cost})`);
    }
    updateCompanySimBoosts(companyId, -cost);

    const applied = db.prepare(`
      UPDATE executives
      SET skill_management = skill_management + 1, skill_accounting = skill_accounting + 1,
          skill_science = skill_science + 1, skill_communication = skill_communication + 1
      WHERE id = ?
    `).run(executiveId);
    if (applied.changes !== 1) throw new Error('Executive training failed');
    db.prepare('UPDATE executive_trainings SET accelerated = 1, skills_applied = 1 WHERE id = ?').run(trainingId);

    const updated = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
    return {
      training: serializeTraining({ ...training, accelerated: 1 }),
      simboostsDelta: -cost,
      executive: formatExecutive(updated)
    };
  }, { immediate: true });
}

export function cancelExecutiveTraining(companyId: number, executiveId: number, trainingId: number) {
  return runInTransaction(async () => {
    const training = db.prepare('SELECT * FROM executive_trainings WHERE id = ? AND executive_id = ? AND company_id = ? AND skills_applied = 0')
      .get(trainingId, executiveId, companyId) as { id: number; datetime: string; accelerated: number } | undefined;
    if (!training) throw new Error('Training not found or already finished');
    db.prepare('DELETE FROM executive_trainings WHERE id = ?').run(trainingId);
    updateCompanyMoney(companyId, EXECUTIVE_TRAINING_MONEY_COST, true);
    return { training: null, moneyDelta: EXECUTIVE_TRAINING_MONEY_COST };
  }, { immediate: true });
}

/**
 * Academy contribution (#154), mirroring the original client's aggregator
 * (bundle `ld`, kind Ft.ACADEMY = 'y'):
 *   active = Σ size of academies not busy and not on a landmark position
 *   slots  = Σ size (size-1 while the academy itself is expanding)
 * The original game documents no numeric formula (the client literally
 * renders "the specific impact is not documented"), so the canonical rules
 * here are: every 5 active academy levels (same cadence as the apprentice
 * slot unlock, bundle Gu=5) grant +1 training skill point (max +2) and a
 * matching starting-skill bonus when hiring a candidate.
 */
export function getAcademyLevels(companyId: number): { active: number; slots: number } {
  const academies = db.prepare(
    "SELECT id, size, position, busy_until FROM buildings WHERE company_id = ? AND kind = 'y'"
  ).all(companyId) as Array<{ id: number; size: number; position: string; busy_until: string | null }>;
  let active = 0;
  let slots = 0;
  const now = Date.now();
  for (const a of academies) {
    const size = Number(a.size) || 1;
    const busy = a.busy_until ? new Date(a.busy_until).getTime() > now : false;
    const onLandmark = String(a.position || '').startsWith('l');
    if (!busy && !onLandmark) active += size;
    if (busy) {
      const hasProduction = db.prepare(
        'SELECT 1 FROM production_queues WHERE building_id = ? AND resolved = 0 LIMIT 1'
      ).get(a.id);
      slots += hasProduction ? size : Math.max(0, size - 1);
    } else {
      slots += size;
    }
  }
  return { active, slots };
}

function academySkillBonus(activeLevels: number): number {
  return Math.min(2, Math.floor(activeLevels / 5));
}

export function trainExecutive(companyId: number, executiveId: number) {
  const trainingCost = EXECUTIVE_TRAINING_COST;
  const academy = getAcademyLevels(companyId);
  const skillGain = 1 + academySkillBonus(academy.active);

  return runInTransaction(async () => {
    const exec = db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
    if (!exec) {
      throw new Error('Employed executive not found');
    }

    const comp = getCompanyById(companyId);
    if (!comp || comp.money < trainingCost) {
      throw new Error('Not enough money for executive training');
    }

    recordCashLedger({
      companyId,
      amount: -trainingCost,
      category: 'h',
      description: 'Executive training',
      descriptionKey: '1-training',
      details: { executiveId, name: exec.name }
    });
    updateCompanyMoney(companyId, -trainingCost, true);

    const updated = db.prepare(`
      UPDATE executives
      SET skill_management = skill_management + ?,
          skill_accounting = skill_accounting + ?,
          skill_science = skill_science + ?,
          skill_communication = skill_communication + ?
      WHERE id = ? AND company_id = ? AND status = 'employed'
    `).run(skillGain, skillGain, skillGain, skillGain, executiveId, companyId);
    if (updated.changes !== 1) throw new Error('Executive training failed');

    const row = db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow;
    return {
      executive: formatExecutive(row),
      cost: trainingCost,
      skillGain,
      academyActive: academy.active
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
