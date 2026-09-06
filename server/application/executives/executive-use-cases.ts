/**
 * Executives application layer (Issue #105 Phase 6 / Issue #104 Stage 5).
 * Single command/query surface for executive lifecycle (hire, fire, assign,
 * update, train), poaching offers and hostile offers.
 *
 * Issue #179: the legacy engine (game/executives.ts) is gone — this file IS
 * the authoritative orchestration. All persistence lives in
 * repositories/executive-repository.ts, pure rules in domain/executives.ts,
 * money/SimBoost moves go through the authoritative CompanyRepository
 * primitives. Behavior is preserved verbatim.
 */
import type { GameContext } from '../../context/game-context.ts';
import { CONFIG } from '../../config.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import {
  executiveRepository,
  type ExecutiveEmployer,
  type ExecutiveEmploymentHistoryRow,
  type ExecutiveFormerRow,
  type ExecutiveRow,
  type ExecutiveTrainingRow,
  type ExecutiveOfferRow
} from '../../repositories/executive-repository.ts';
import {
  AGENCY_FEE_MULTIPLIERS,
  EXECUTIVE_TRAINING_COST,
  EXECUTIVE_TRAINING_MONEY_COST,
  EXECUTIVE_TRAINING_WINDOW_S,
  BASE_EXECUTIVE_TRAINING_WINDOW_S,
  BASE_SETTLE_IN_WINDOW_S,
  getExecutiveTrainingWindowSeconds,
  getSettleInWindowSeconds,
  AgencyTier,
  academySkillBonus,
  generateDeterministicGenome,
  normalizeOfferStatus,
  normalizePositionCode,
  parseAgencyTier,
  validIsoOrNull
} from '../../domain/executives.ts';
import { db } from '../../db/connection.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { recordCashLedger } from '../../game/cash-ledger.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { ForbiddenError } from '../../errors/domain-error.ts';
export const EXECUTIVE_TRAINING_CODES = ['f', 'g', 'm', 'o', 't'] as const;
export type ExecutiveTrainingCode = (typeof EXECUTIVE_TRAINING_CODES)[number];

const TRAINING_CODE_SET: Record<ExecutiveTrainingCode, true> = {
  f: true,
  g: true,
  m: true,
  o: true,
  t: true
};

// The client labels these codes by skill direction. The existing local
// executive rule applies one point to all four skills for every scheduled
// training; keep that rule until a verified per-code gain contract exists.
const SCHEDULED_TRAINING_SKILLS = {
  coo: 1,
  cfo: 1,
  cmo: 1,
  cto: 1
} as const;

export function normalizeExecutiveTrainingCode(value: unknown): ExecutiveTrainingCode {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!Object.prototype.hasOwnProperty.call(TRAINING_CODE_SET, code)) {
    throw new Error('Training must be one of f, g, m, o, or t');
  }
  return code as ExecutiveTrainingCode;
}

function trainingCodeOrDefault(value: string | null | undefined): ExecutiveTrainingCode {
  try {
    return normalizeExecutiveTrainingCode(value);
  } catch {
    return 'o';
  }
}

function employerFromHistory(history: ExecutiveEmploymentHistoryRow): ExecutiveEmployer | null {
  if (history.employer_id === null || history.employer_id === undefined) return null;
  return {
    id: history.employer_id,
    company: history.employer_name || '',
    logo: history.employer_logo || '',
    realmId: Number(history.employer_realm_id) || 0
  };
}

function daysInHistory(history: { started_at: string; ended_at?: string | null }): number {
  const startMs = Date.parse(validIsoOrNull(history.started_at) || '');
  const endMs = Date.parse(validIsoOrNull(history.ended_at) || '') || virtualClock.nowMs();
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 86400000));
}

function formatHistory(history: ExecutiveEmploymentHistoryRow) {
  return {
    id: history.id,
    employerId: history.company_id,
    position: normalizePositionCode(history.position),
    start: validIsoOrNull(history.started_at),
    end: validIsoOrNull(history.ended_at),
    daysActive: daysInHistory(history),
    accelerated: Boolean(history.accelerated),
    employer: employerFromHistory(history)
  };
}

export function formatTraining(row: ExecutiveTrainingRow, executive?: ExecutiveRow | null) {
  const employer = executiveRepository.getEmployerSummary(row.company_id);
  const skills = { ...SCHEDULED_TRAINING_SKILLS };
  return {
    id: row.id,
    employerId: row.company_id,
    executiveId: row.executive_id,
    skillCoo: skills.coo,
    skillCfo: skills.cfo,
    skillCmo: skills.cmo,
    skillCto: skills.cto,
    datetime: validIsoOrNull(row.datetime) || validIsoOrNull(row.created_at) || virtualClock.nowIso(),
    training: trainingCodeOrDefault(row.training),
    accelerated: Boolean(row.accelerated),
    reflected: Boolean(row.skills_applied),
    covered: Boolean(row.covered),
    employer,
    skills,
    executive: executive
      ? { id: executive.id, name: executive.name }
      : undefined
  };
}

function projectTrainingDatetime(datetime: string): string {
  const rawStartMs = Date.parse(validIsoOrNull(datetime) || '') || virtualClock.nowMs();
  const scaledTrainingSeconds = getExecutiveTrainingWindowSeconds();
  const trainingFinishMs = rawStartMs + scaledTrainingSeconds * 1000;
  return new Date(trainingFinishMs - BASE_EXECUTIVE_TRAINING_WINDOW_S * 1000).toISOString();
}

function projectSettleDatetime(datetime: string): string {
  const rawStartMs = Date.parse(validIsoOrNull(datetime) || '') || virtualClock.nowMs();
  const settleFinishedMs = rawStartMs + getSettleInWindowSeconds() * 1000;
  return new Date(settleFinishedMs - BASE_SETTLE_IN_WINDOW_S * 1000).toISOString();
}

export function formatExecutive(e: ExecutiveRow) {
  const normPos = normalizePositionCode(e.position);
  const mgmt = Number(e.skill_management) || 0;
  const acct = Number(e.skill_accounting) || 0;
  const sci = Number(e.skill_science) || 0;
  const comm = Number(e.skill_communication) || 0;
  const avatar = e.avatar || 'images/avatars/male_01.png';
  const gen = generateDeterministicGenome(e.id || e.name, avatar, e.name);
  const rawCreated = validIsoOrNull(e.created_at) || new Date(virtualClock.nowMs() - 86400000).toISOString();
  const rawCreatedMs = Date.parse(rawCreated);
  const projectedWorkStart = projectSettleDatetime(rawCreated);
  const training = executiveRepository.findActiveTraining(e.id);
  const histories = executiveRepository.listEmploymentHistory(e.id);
  const currentHistory = histories.find(history => (
    history.ended_at === null && history.company_id === e.company_id
  )) || null;
  const currentEmployer = currentHistory
    ? employerFromHistory(currentHistory)
    : e.company_id === null
      ? null
      : executiveRepository.getEmployerSummary(e.company_id);
  const currentRawStart = currentHistory
    ? validIsoOrNull(currentHistory.started_at) || rawCreated
    : rawCreated;
  const currentStart = currentHistory
    ? projectSettleDatetime(currentRawStart)
    : projectedWorkStart;
  const currentStartMs = Date.parse(currentRawStart) || rawCreatedMs;
  const currentDaysActive = Math.max(0, Math.floor((virtualClock.nowMs() - currentStartMs) / 86400000));
  const trainings = executiveRepository.listTrainingsByExecutive(e.id)
    .map(row => formatTraining(row, e));
  const currentTraining = training
    ? {
        ...formatTraining(training, e),
        datetime: projectTrainingDatetime(training.datetime)
      }
    : undefined;
  const workHistory = histories.length > 0
    ? histories.map(formatHistory)
    : [{
        id: null,
        employerId: e.company_id,
        position: normPos,
        start: projectedWorkStart,
        end: null,
        daysActive: currentDaysActive,
        accelerated: Boolean(e.work_history_accelerated),
        employer: currentEmployer
      }];
  const isCandidate = (e.status || '') === 'candidate';
  const salaryNum = Number(e.salary) || (isCandidate ? 300 : 250);

  return {
    id: e.id,
    name: e.name,
    avatar,
    gender: e.gender ?? null,
    realm: currentEmployer?.realmId ?? null,
    genome: gen.genome,
    age: gen.age || 40,
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
      id: currentHistory?.id ?? null,
      employerId: currentHistory?.company_id ?? e.company_id,
      position: normalizePositionCode(currentHistory?.position || e.position),
      daysActive: currentDaysActive,
      start: currentHistory ? currentStart : projectedWorkStart,
      accelerated: currentHistory
        ? Boolean(currentHistory.accelerated)
        : Boolean(e.work_history_accelerated),
      employer: currentEmployer
    },
    workHistory,
    isCandidate,
    expectedSalary: salaryNum,
    strikeUntil: validIsoOrNull(e.strike_until),
    plansToRetire: Boolean(e.plans_to_retire),
    currentTraining,
    salary: salaryNum,
    status: e.status || (isCandidate ? 'candidate' : 'employed'),
    trainingFinishAt: validIsoOrNull(e.training_finish_at) || undefined,
    totalSkill: mgmt + acct + sci + comm,
    trainings,
    achievements: []
  };
}

export function formatFormerExecutive(row: ExecutiveFormerRow) {
  const base = formatExecutive(row);
  const formerHistory: ExecutiveEmploymentHistoryRow = {
    id: row.history_id,
    executive_id: row.id,
    company_id: row.history_company_id,
    position: row.history_position,
    started_at: row.history_started_at,
    ended_at: row.history_ended_at,
    accelerated: row.history_accelerated,
    created_at: row.history_started_at,
    employer_id: row.employer_id,
    employer_name: row.employer_name,
    employer_logo: row.employer_logo,
    employer_realm_id: row.employer_realm_id
  };
  return {
    ...base,
    status: 'former',
    currentWorkHistory: null,
    workHistory: [formatHistory(formerHistory)]
  };
}

// Official frontend bundle timing: `S3=60*60*10` in
// `artifacts/archeology/golden-versions/2023-vite-rollup/index.83a06fd4.js`
// (~1,844,550), and the search UI computes `Date.parse(created)+S3*1e3`
// (~3,325,000). Scale the documented 10-hour window with the server clock
// multiplier, just as the other executive timers are scaled.
const EXECUTIVE_SEARCH_BASE_WINDOW_S = 60 * 60 * 10;
const EXECUTIVE_SEARCH_WINDOW_S = Math.max(
  3,
  Math.round(EXECUTIVE_SEARCH_BASE_WINDOW_S / (Number(CONFIG.PRODUCTION_SPEED_MULTIPLIER) || 1))
);

function decodeOfferAgeRange(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function searchDeadlineIso(startIso: string): string {
  const startMs = Date.parse(startIso);
  const baseMs = Number.isFinite(startMs) ? startMs : virtualClock.nowMs();
  return new Date(baseMs + EXECUTIVE_SEARCH_WINDOW_S * 1000).toISOString();
}

function searchDeadlineMs(offer: ExecutiveOfferRow): number {
  const persisted = validIsoOrNull(offer.search_until);
  if (persisted) return Date.parse(persisted);
  const created = validIsoOrNull(offer.created_at);
  const createdMs = created ? Date.parse(created) : virtualClock.nowMs();
  return createdMs + EXECUTIVE_SEARCH_WINDOW_S * 1000;
}

export function formatOffer(offer: ExecutiveOfferRow, exec: ExecutiveRow | null) {
  const nowIso = virtualClock.nowIso();
  const createdIso = validIsoOrNull(offer.created_at) || nowIso;
  const status = normalizeOfferStatus(offer.status);
  const agency = Number(offer.agency) || AgencyTier.IN_HOUSE;
  const slotPosition = normalizePositionCode(offer.slot_position);
  const skillPosition = offer.skill_position || 'o';

  // A search is intentionally a small DTO. In particular, no target IDs or
  // executive object can leak before the agency's search window completes.
  if (status === 'l') {
    return {
      id: offer.id,
      datetime: createdIso,
      status,
      accelerated: Boolean(offer.accelerated),
      agency,
      ageRange: decodeOfferAgeRange(offer.age_range),
      hasTrainings: Boolean(offer.has_trainings),
      onlyUnemployed: Boolean(offer.only_unemployed),
      slotPosition,
      skillPosition
    };
  }

  const execObj = exec ? formatExecutive(exec) : null;
  const extendedIso = validIsoOrNull(offer.extended_at) || createdIso;
  const expSal = Number(offer.expected_salary) || (exec ? Number(exec.salary) : 0) || 400;
  const sal = offer.salary !== null && offer.salary !== undefined ? Number(offer.salary) : expSal;
  const fee = offer.agency_fee !== null && offer.agency_fee !== undefined
    ? Number(offer.agency_fee)
    : Math.round(expSal * 0.5);

  let researchPoacherData: Record<string, unknown> | null = null;
  if (offer.research_poacher) {
    try {
      const parsed = JSON.parse(offer.research_poacher) as Record<string, unknown>;
      researchPoacherData = {
        marketSalary: Number(parsed.marketSalary) || Math.round(expSal * 1.1),
        acceptingSalary: Number(parsed.acceptingSalary) || Math.round(expSal * 1.05),
        employerCompanyValue: Number(parsed.employerCompanyValue) || 500000,
        employerAcceptanceRate: Number(parsed.employerAcceptanceRate) || 0.35,
        averageAcceptedIncrease: Number(parsed.averageAcceptedIncrease) || 1.25,
        averageRefusedIncrease: Number(parsed.averageRefusedIncrease) || 1.5,
        employerAcceptedOffersCount: Number(parsed.employerAcceptedOffersCount) || 2,
        employerRejectedOffersCount: Number(parsed.employerRejectedOffersCount) || 4,
        employerAcceptedOffersMean: Number(parsed.employerAcceptedOffersMean) || Number(parsed.averageAcceptedIncrease) || 1.25,
        employerRejectedOffersMean: Number(parsed.employerRejectedOffersMean) || Number(parsed.averageRefusedIncrease) || 1.5
      };
    } catch {}
  }

  return {
    id: offer.id,
    slotPosition,
    skillPosition,
    agency,
    status,
    expectedSalary: expSal,
    salary: sal,
    agencyFee: fee,
    executiveId: offer.target_executive_id,
    executive: execObj,
    executiveDaysActive: 10,
    executiveAllTrainings: 0,
    executiveRecentTrainings: 0,
    accelerated: Boolean(offer.accelerated),
    datetime: createdIso,
    extended: extendedIso,
    created: createdIso,
    researchPoacher: researchPoacherData
  };
}

export function formatHostileOffer(offer: ExecutiveOfferRow, exec: ExecutiveRow | null) {
  const execObj = exec ? formatExecutive(exec) : null;
  const nowIso = virtualClock.nowIso();
  const createdIso = validIsoOrNull(offer.created_at) || nowIso;
  const extendedIso = validIsoOrNull(offer.extended_at) || createdIso;
  const expSal = Number(offer.expected_salary) || (exec ? Number(exec.salary) : 0) || 400;
  const sal = offer.salary !== null && offer.salary !== undefined ? Number(offer.salary) : expSal;
  const status = normalizeOfferStatus(offer.status);

  let researchEmployerData: Record<string, unknown> | null = null;
  if (offer.research_employer) {
    try {
      const parsed = JSON.parse(offer.research_employer) as Record<string, unknown>;
      researchEmployerData = {
        marketSalary: Number(parsed.marketSalary) || Math.round(expSal * 1.1),
        poacherCompanyValue: Number(parsed.poacherCompanyValue) || 750000,
        poacherAverageSalary: Number(parsed.poacherAverageSalary) || 450,
        poacherFiredEmployeesCount: Number(parsed.poacherFiredEmployeesCount) || 0,
        poacherAverageYearsSpendAtCompany: Number(parsed.poacherAverageYearsSpendAtCompany) || 1.5
      };
    } catch {}
  }

  return {
    id: offer.id,
    executiveId: offer.target_executive_id,
    executive: execObj,
    expectedSalary: expSal,
    salary: sal,
    status,
    datetime: createdIso,
    extended: extendedIso,
    created: createdIso,
    companyId: offer.target_company_id,
    poacherCompanyId: offer.poacher_company_id,
    researchEmployer: researchEmployerData
  };
}

// --- Lazy training resolution (read path applies due trainings) ----------------

/** Apply skill gains for every training whose window has elapsed. */
function resolveCompletedTrainings(companyId: number) {
  const windowSeconds = getExecutiveTrainingWindowSeconds();
  const cutoff = new Date(virtualClock.nowMs() - windowSeconds * 1000).toISOString();
  const due = executiveRepository.listDueTrainings(companyId, cutoff);
  for (const row of due) {
    const applied = executiveRepository.applyTrainingSkillUp(row.executive_id);
    if (applied === 1) {
      executiveRepository.markTrainingApplied(row.id);
    }
  }
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
  const academies = executiveRepository.listAcademies(companyId);
  let active = 0;
  let slots = 0;
  const now = virtualClock.nowMs();
  for (const a of academies) {
    const size = Number(a.size) || 1;
    const busy = a.busy_until ? new Date(a.busy_until).getTime() > now : false;
    const onLandmark = String(a.position || '').startsWith('l');
    if (!busy && !onLandmark) active += size;
    if (busy) {
      const hasProduction = executiveRepository.academyHasProduction(a.id);
      slots += hasProduction ? size : Math.max(0, size - 1);
    } else {
      slots += size;
    }
  }
  return { active, slots };
}

// --- Core lifecycle -------------------------------------------------------------

export function getCompanyExecutives(companyId: number) {
  resolveCompletedTrainings(companyId);
  return executiveRepository.listByCompany(companyId).map(formatExecutive);
}

export function getExecutiveCandidates(companyId: number) {
  resolveCompletedTrainings(companyId);
  return executiveRepository.listCandidates(companyId).map(formatExecutive);
}

function getExecutiveById(companyId: number, executiveId: number) {
  resolveCompletedTrainings(companyId);
  const row = executiveRepository.findByIdAndCompany(executiveId, companyId);
  if (!row) throw new Error('Executive not found');
  return formatExecutive(row);
}

function hireExecutive(companyId: number, candidateId: number, position: string = 'unassigned') {
  return runInTransaction(async () => {
    const c = executiveRepository.findByIdAndCompany(candidateId, companyId);
    if (!c) throw new Error('Candidate not found');
    if (c.status !== 'candidate') throw new Error('Executive is not an available candidate');

    const comp = companyRepository.findById(companyId);
    if (!comp) throw new Error('Company not found');

    const countRow = executiveRepository.countEmployed(companyId);
    const maxSlots = 4 + (Number(comp.extraExecutiveSlots) || 0);
    if (countRow >= maxSlots) {
      throw new Error(`Executive slot limit reached (${countRow}/${maxSlots}). Unlock more slots with SimBoosts.`);
    }

    // #154: the academy raises the starting skills of in-house candidates
    // (same 5-levels-per-point cadence as training; max +2).
    const startingBonus = academySkillBonus(getAcademyLevels(companyId).active);
    const hiredAt = virtualClock.nowIso();
    const updated = executiveRepository.hireCandidate(candidateId, companyId, position, startingBonus);
    if (updated !== 1) throw new Error('Failed to hire candidate');
    executiveRepository.beginEmploymentHistory(candidateId, companyId, position, hiredAt);
    const row = executiveRepository.findById(candidateId) as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

function fireExecutive(companyId: number, executiveId: number) {
  return runInTransaction(async () => {
    const exec = executiveRepository.findEmployed(executiveId, companyId);
    if (!exec) throw new Error('Employed executive not found');

    // Dismissal severance = executive.salary * 3.
    const severance = Math.round((Number(exec.salary) || 250) * 3);
    const endedAt = virtualClock.nowIso();

    companyRepository.updateMoney(companyId, -severance);
    const former = executiveRepository.markFormer(executiveId, companyId, endedAt);
    if (former !== 1) throw new Error('Employed executive not found');
    return {
      success: true,
      severance,
      moneyDelta: -severance
    };
  }, { immediate: true });
}

function assignExecutive(companyId: number, executiveId: number, position: string) {
  return runInTransaction(async () => {
    const updated = executiveRepository.assignPosition(executiveId, companyId, position);
    if (updated !== 1) throw new Error('Employed executive not found');
    const row = executiveRepository.findById(executiveId) as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

function updateExecutive(
  companyId: number,
  executiveId: number,
  updates: UpdateExecutiveInput
) {
  return runInTransaction(async () => {
    const exec = executiveRepository.findEmployed(executiveId, companyId);
    if (!exec) throw new Error('Employed executive not found');
    const comp = companyRepository.findById(companyId);
    if (!comp) throw new Error('Company not found');

    if (updates.salary !== undefined) {
      if (!Number.isFinite(updates.salary) || updates.salary <= 0) {
        throw new Error('Salary must be a positive number');
      }
      executiveRepository.updateSalary(executiveId, companyId, updates.salary);
    }
    if (updates.position !== undefined) {
      executiveRepository.updatePosition(executiveId, companyId, updates.position);
    }

    // Issue #165: rush settling in. The client prices the rush as
    // ceil((start + 3h - now) / 6min) SimBoosts; settle instantly by
    // marking the work history accelerated so the client-side window closes.
    if (updates.rushSettle === true) {
      const rawCreatedMs = Date.parse(validIsoOrNull(exec.created_at) || '') || virtualClock.nowMs();
      const settleEndMs = rawCreatedMs + getSettleInWindowSeconds() * 1000;
      const alreadySettled = Boolean(exec.work_history_accelerated) || settleEndMs <= virtualClock.nowMs();
      if (!alreadySettled) {
        const cost = Math.max(1, Math.ceil((settleEndMs - virtualClock.nowMs()) / 360000));
        if (Number(comp.simboosts) < cost) {
          throw new Error(`Not enough SimBoosts to rush settling in (requires ${cost})`);
        }
        companyRepository.updateSimBoosts(companyId, -cost);
        executiveRepository.markWorkHistoryAccelerated(executiveId);
      }
    }

    if (updates.strikeUntil !== undefined) {
      const iso = updates.strikeUntil === null ? null : validIsoOrNull(updates.strikeUntil);
      executiveRepository.updateStrikeUntil(executiveId, iso);
    }
    if (updates.plansToRetire !== undefined) {
      executiveRepository.updatePlansToRetire(executiveId, updates.plansToRetire);
    }

    const row = executiveRepository.findById(executiveId) as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

function serializeTraining(row: ExecutiveTrainingRow, executive?: ExecutiveRow | null) {
  return formatTraining(row, executive);
}
function scheduleExecutiveTraining(
  companyId: number,
  executiveId: number,
  trainingCode: ExecutiveTrainingCode = 'o'
) {
  return runInTransaction(async () => {
    const exec = executiveRepository.findEmployed(executiveId, companyId);
    if (!exec) throw new Error('Employed executive not found');
    if (executiveRepository.findActiveTraining(executiveId)) throw new Error('Executive already has a training in progress');
    const count = executiveRepository.countTrainings(executiveId);
    if (count >= 20) throw new Error('Executive training limit reached (20)');

    const comp = companyRepository.findById(companyId);
    if (!comp || comp.money < EXECUTIVE_TRAINING_MONEY_COST) {
      throw new Error(`Not enough money for executive training ($${EXECUTIVE_TRAINING_MONEY_COST})`);
    }

    const now = virtualClock.nowIso();
    recordCashLedger({
      companyId,
      amount: -EXECUTIVE_TRAINING_MONEY_COST,
      category: 'h',
      description: 'Executive training',
      descriptionKey: `et-${exec.name}`,
      details: { executiveId, name: exec.name, training: trainingCode }
    });
    companyRepository.updateMoney(companyId, -EXECUTIVE_TRAINING_MONEY_COST, { skipLedger: true });

    const row = executiveRepository.insertTraining(executiveId, companyId, now, trainingCode);
    return { training: serializeTraining(row, exec), moneyDelta: -EXECUTIVE_TRAINING_MONEY_COST };
  }, { immediate: true });
}

function rushExecutiveTraining(companyId: number, executiveId: number, trainingId: number) {
  return runInTransaction(async () => {
    const training = executiveRepository.findUnfinishedTraining(trainingId, executiveId, companyId);
    if (!training) throw new Error('Training not found or already finished');
    const comp = companyRepository.findById(companyId);
    if (!comp) throw new Error('Company not found');

    const finishMs = new Date(training.datetime).getTime() + getExecutiveTrainingWindowSeconds() * 1000;
    const cost = Math.max(1, Math.ceil((finishMs - virtualClock.nowMs()) / 360000));
    if (Number(comp.simboosts) < cost) {
      throw new Error(`Not enough SimBoosts to rush training (requires ${cost})`);
    }
    companyRepository.updateSimBoosts(companyId, -cost);

    const applied = executiveRepository.addFourSkills(executiveId, 1);
    if (applied !== 1) throw new Error('Executive training failed');
    executiveRepository.markTrainingAccelerated(trainingId);

    const updated = executiveRepository.findById(executiveId) as ExecutiveRow;
    const updatedTraining = executiveRepository.findUnfinishedTraining(trainingId, executiveId, companyId)
      || ({ ...training, accelerated: 1, skills_applied: 1 } as ExecutiveTrainingRow);
    return {
      training: serializeTraining(updatedTraining, updated),
      simboostsDelta: -cost,
      executive: formatExecutive(updated)
    };
  }, { immediate: true });
}

function cancelExecutiveTraining(companyId: number, executiveId: number, trainingId: number) {
  return runInTransaction(async () => {
    const training = executiveRepository.findUnfinishedTraining(trainingId, executiveId, companyId);
    if (!training) throw new Error('Training not found or already finished');
    executiveRepository.deleteTraining(trainingId);
    companyRepository.updateMoney(companyId, EXECUTIVE_TRAINING_MONEY_COST, { skipLedger: true });
    return { training: null, moneyDelta: EXECUTIVE_TRAINING_MONEY_COST };
  }, { immediate: true });
}

function trainExecutive(companyId: number, executiveId: number) {
  const trainingCost = EXECUTIVE_TRAINING_COST;
  const academy = getAcademyLevels(companyId);
  const skillGain = 1 + academySkillBonus(academy.active);

  return runInTransaction(async () => {
    const exec = executiveRepository.findEmployed(executiveId, companyId);
    if (!exec) {
      throw new Error('Employed executive not found');
    }

    const comp = companyRepository.findById(companyId);
    if (!comp || comp.money < trainingCost) {
      throw new Error('Not enough money for executive training');
    }

    recordCashLedger({
      companyId,
      amount: -trainingCost,
      category: 'h',
      description: 'Executive training',
      descriptionKey: `et-${exec.name}`,
      details: { executiveId, name: exec.name }
    });
    companyRepository.updateMoney(companyId, -trainingCost, { skipLedger: true });

    const updated = executiveRepository.addFourSkillsInCompany(executiveId, companyId, skillGain);
    if (updated !== 1) throw new Error('Executive training failed');

    const row = executiveRepository.findById(executiveId) as ExecutiveRow;
    return {
      executive: formatExecutive(row),
      cost: trainingCost,
      skillGain,
      academyActive: academy.active
    };
  }, { immediate: true });
}

// --- Poaching offers --------------------------------------------------------

function encodeOfferAgeRange(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? null : encoded;
}

function numericAgeBounds(value: unknown): { min: number; max: number } | null {
  if (Array.isArray(value) && value.length >= 2) {
    const min = Number(value[0]);
    const max = Number(value[1]);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { min, max };
    }
    return null;
  }

  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const min = Number(record.min ?? record.minimum ?? record.from);
  const max = Number(record.max ?? record.maximum ?? record.to);
  if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
    return { min, max };
  }
  return null;
}

function targetSkill(target: ExecutiveRow, skillPosition: string | null): number {
  switch (normalizePositionCode(skillPosition)) {
    case 'o':
      return Number(target.skill_management);
    case 'f':
      return Number(target.skill_accounting);
    case 'm':
      return Number(target.skill_communication);
    case 't':
      return Number(target.skill_science);
    default:
      return 1;
  }
}

function isSearchTargetEligible(target: ExecutiveRow, offer: ExecutiveOfferRow): boolean {
  const targetStatus = String(target.status || '').toLowerCase();
  const requestedPosition = normalizePositionCode(offer.slot_position);
  const targetPosition = normalizePositionCode(target.position);

  // Unemployed candidates have no current role; employed poaching targets
  // must be working in the requested executive position.
  if (targetStatus !== 'candidate'
      && requestedPosition !== 'none'
      && targetPosition !== 'none'
      && requestedPosition !== targetPosition) {
    return false;
  }

  if (!Number.isFinite(targetSkill(target, offer.skill_position)) || targetSkill(target, offer.skill_position) <= 0) {
    return false;
  }

  if (offer.has_trainings) {
    const hasTraining = executiveRepository.listTrainingsByExecutive(target.id).length > 0
      || Boolean(validIsoOrNull(target.training_finish_at));
    if (!hasTraining) return false;
  }

  const bounds = numericAgeBounds(decodeOfferAgeRange(offer.age_range));
  if (bounds) {
    const age = generateDeterministicGenome(target.id, target.avatar, target.name).age;
    if (age < bounds.min || age > bounds.max) return false;
  }

  return true;
}
function generateCandidateForOffer(offer: ExecutiveOfferRow, nowIso: string): ExecutiveRow {
  const otherCompany = executiveRepository.findAnyOtherCompany(offer.poacher_company_id);
  const targetCompanyId = otherCompany ? otherCompany.company_id : 1234567;
  const isUnemployed = Boolean(offer.only_unemployed);
  const status = isUnemployed ? 'candidate' : 'employed';
  const slotPos = normalizePositionCode(offer.slot_position);
  const pos = isUnemployed ? 'unassigned' : (slotPos === 'none' ? 'coo' : slotPos);
  const bounds = numericAgeBounds(decodeOfferAgeRange(offer.age_range));

  const nextSeq = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'executives'").get() as { seq?: number } | undefined)?.seq || 0;
  const targetId = nextSeq + 1;

  const avatars = [
    'images/avatars/male_01.png', 'images/avatars/male_02.png', 'images/avatars/male_03.png',
    'images/avatars/female_01.png', 'images/avatars/female_02.png', 'images/avatars/female_03.png'
  ];
  const firstNames = ['Alex', 'Elena', 'David', 'Marcus', 'Sophia', 'Lucas', 'Oliver', 'Emma', 'Daniel', 'Chloe'];
  const lastNames = ['Wright', 'Rostova', 'Chen', 'Vance', 'Sterling', 'Meyer', 'Smith', 'Taylor', 'Davis', 'Miller'];

  let chosenAvatar = avatars[0];
  let chosenName = `Executive ${targetId}`;
  let matched = false;

  if (bounds) {
    for (const avatar of avatars) {
      for (const first of firstNames) {
        for (const last of lastNames) {
          const testName = `${first} ${last}`;
          const genome = generateDeterministicGenome(targetId, avatar, testName);
          if (genome.age >= bounds.min && genome.age <= bounds.max) {
            chosenAvatar = avatar;
            chosenName = testName;
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (matched) break;
    }
  } else {
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    chosenName = `${first} ${last}`;
    chosenAvatar = avatars[Math.floor(Math.random() * avatars.length)];
  }

  const agencyTier = Number(offer.agency) || AgencyTier.IN_HOUSE;
  const baseSkill = agencyTier === AgencyTier.TOP_TALENT_AGENCY ? 15 : agencyTier === AgencyTier.GOOD_AGENCY ? 12 : 8;
  const salary = baseSkill * 40;

  const inserted = db.prepare(`
    INSERT INTO executives (
      company_id, name, avatar, position,
      skill_management, skill_accounting, skill_science, skill_communication,
      salary, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    targetCompanyId,
    chosenName,
    chosenAvatar,
    pos,
    baseSkill,
    baseSkill,
    baseSkill,
    baseSkill,
    salary,
    status,
    nowIso
  );

  const candidateId = Number(inserted.lastInsertRowid);
  if (offer.has_trainings) {
    executiveRepository.insertTraining(candidateId, targetCompanyId, nowIso, offer.skill_position || 'o');
  }
  if (!isUnemployed) {
    executiveRepository.beginEmploymentHistory(candidateId, targetCompanyId, pos, nowIso);
  }

  return db.prepare('SELECT * FROM executives WHERE id = ?').get(candidateId) as unknown as ExecutiveRow;
}

function findSearchTarget(offer: ExecutiveOfferRow): ExecutiveRow | undefined {
  return executiveRepository
    .listSearchTargets(offer.poacher_company_id, Boolean(offer.only_unemployed))
    .find(target => isSearchTargetEligible(target, offer));
}

function resolveSearchOffer(offer: ExecutiveOfferRow, nowIso: string): ExecutiveOfferRow {
  let target = findSearchTarget(offer);
  if (!target) {
    target = generateCandidateForOffer(offer, nowIso);
  }

  const expectedSalary = Number(offer.expected_salary) > 0
    ? Number(offer.expected_salary)
    : Number(target.salary) > 0
      ? Number(target.salary)
      : 400;
  return executiveRepository.setSearchResult(
    offer.id,
    offer.poacher_company_id,
    target.company_id,
    target.id,
    expectedSalary,
    nowIso
  );
}

function resolveDueSearchOffers(
  poacherCompanyId: number,
  nowMs: number,
  nowIso: string
): void {
  const searches = executiveRepository.listOffersByPoacher(poacherCompanyId);
  for (const search of searches) {
    if (normalizeOfferStatus(search.status) !== 'l') continue;
    if (searchDeadlineMs(search) > nowMs) continue;
    resolveSearchOffer(search, nowIso);
  }
}

function formattedOfferWithExecutive(offer: ExecutiveOfferRow) {
  const exec = offer.target_executive_id === null
    ? null
    : executiveRepository.findById(offer.target_executive_id) || null;
  return formatOffer(offer, exec);
}

export async function createPoachingOffer(poacherCompanyId: number, input: CreatePoachingOfferInput) {
  const agencyTier = parseAgencyTier(input.agency);
  const multiplier = AGENCY_FEE_MULTIPLIERS[agencyTier] ?? 0;
  const slotPos = (input.slotPosition || 'coo').toLowerCase();
  const skillPos = (input.skillPosition || 'o').toLowerCase();
  const ageRange = encodeOfferAgeRange(input.ageRange);
  const hasTrainings = input.hasTrainings === true;
  const onlyUnemployed = input.onlyUnemployed === true;

  return runInTransaction(async () => {
    const poacherComp = companyRepository.findById(poacherCompanyId);
    if (!poacherComp) throw new Error('Company not found');

    // Explicit targets are retained for the legacy/internal poaching caller.
    // Official agency searches omit this field and always enter `l` first.
    if (input.targetExecutiveId !== undefined && input.targetExecutiveId !== null) {
      const targetExecutive = executiveRepository.findById(input.targetExecutiveId);
      if (!targetExecutive) throw new Error('Target executive not found');

      const targetStatus = String(targetExecutive.status || '').toLowerCase();
      let targetCompanyId = targetExecutive.company_id;
      if (targetCompanyId === poacherCompanyId) {
        if (targetStatus !== 'candidate') {
          throw new Error('Candidate is no longer available');
        }
      } else if (targetStatus === 'candidate' && targetCompanyId === null) {
        targetCompanyId = null;
      } else if (targetCompanyId === null) {
        throw new Error('Target executive has no employer');
      }

      const expectedSalaryInput = input.expectedSalary;
      if (expectedSalaryInput !== undefined
          && (!Number.isFinite(expectedSalaryInput) || expectedSalaryInput <= 0)) {
        throw new Error('Expected salary must be a positive number');
      }
      const expectedSalary = expectedSalaryInput ?? (Number(targetExecutive.salary) || 400);
      const existingOffer = executiveRepository.findOpenOfferForTarget(
        poacherCompanyId,
        targetExecutive.id,
        agencyTier,
        slotPos,
        skillPos,
        expectedSalary
      );
      if (existingOffer) {
        return {
          ...formattedOfferWithExecutive(existingOffer),
          idempotent: true
        };
      }

      const agencyFee = Math.round(expectedSalary * multiplier);
      if (poacherComp.money < agencyFee) {
        throw new Error(`Insufficient funds for agency fee ($${agencyFee})`);
      }
      if (agencyFee > 0) {
        companyRepository.updateMoney(poacherCompanyId, -agencyFee);
      }

      const now = virtualClock.nowIso();
      const offerRow = executiveRepository.insertOffer({
        poacherCompanyId,
        targetCompanyId,
        targetExecutiveId: targetExecutive.id,
        slotPos,
        skillPos,
        agencyTier,
        expectedSalary,
        agencyFee,
        ageRange,
        hasTrainings,
        onlyUnemployed,
        status: 'f',
        now
      });
      return formatOffer(offerRow, targetExecutive);
    }

    const existingSearch = executiveRepository.findOpenOfferForSearch(
      poacherCompanyId,
      agencyTier,
      slotPos,
      skillPos,
      ageRange,
      hasTrainings,
      onlyUnemployed
    );
    if (existingSearch) {
      const nowMs = virtualClock.nowMs();
      const nowIso = virtualClock.nowIso();
      let current = existingSearch;
      if (normalizeOfferStatus(current.status) === 'l' && searchDeadlineMs(current) <= nowMs) {
        current = resolveSearchOffer(current, nowIso);
      }
      const formatted = formattedOfferWithExecutive(current);
      return normalizeOfferStatus(current.status) === 'l'
        ? formatted
        : { ...formatted, idempotent: true };
    }

    const expectedSalaryInput = input.expectedSalary;
    if (expectedSalaryInput !== undefined
        && (!Number.isFinite(expectedSalaryInput) || expectedSalaryInput <= 0)) {
      throw new Error('Expected salary must be a positive number');
    }

    const now = virtualClock.nowIso();
    const offerRow = executiveRepository.insertOffer({
      poacherCompanyId,
      targetCompanyId: null,
      targetExecutiveId: null,
      slotPos,
      skillPos,
      agencyTier,
      expectedSalary: expectedSalaryInput ?? 0,
      agencyFee: 0,
      ageRange,
      hasTrainings,
      onlyUnemployed,
      searchUntil: searchDeadlineIso(now),
      status: 'l',
      now
    });
    return formatOffer(offerRow, null);
  }, { immediate: true });
}

export function getPoachingOffers(poacherCompanyId: number) {
  const nowMs = virtualClock.nowMs();
  const nowIso = virtualClock.nowIso();
  resolveDueSearchOffers(poacherCompanyId, nowMs, nowIso);
  return executiveRepository.listOffersByPoacher(poacherCompanyId).map(formattedOfferWithExecutive);
}

function getPoachingOfferById(poacherCompanyId: number, offerId: number) {
  let offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
  if (!offer) throw new Error('Poaching offer not found');

  const nowMs = virtualClock.nowMs();
  const nowIso = virtualClock.nowIso();
  if (normalizeOfferStatus(offer.status) === 'l' && searchDeadlineMs(offer) <= nowMs) {
    offer = resolveSearchOffer(offer, nowIso);
  }
  return formattedOfferWithExecutive(offer);
}

async function updatePoachingOffer(
  poacherCompanyId: number,
  offerId: number,
  payload: { status?: string; executive?: boolean; salary?: number; accelerated?: boolean }
) {
  return runInTransaction(async () => {
    let offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
    if (!offer) throw new Error('Poaching offer not found');

    const nowMs = virtualClock.nowMs();
    const now = virtualClock.nowIso();
    let status = normalizeOfferStatus(offer.status);

    if (status === 'l' && searchDeadlineMs(offer) <= nowMs) {
      offer = resolveSearchOffer(offer, now);
      status = normalizeOfferStatus(offer.status);
    }

    let simboostsDelta = 0;
    if (status === 'l') {
      if (payload.accelerated === true) {
        const remainingMs = searchDeadlineMs(offer) - nowMs;
        if (remainingMs > 0) {
          const cost = Math.max(1, Math.ceil(remainingMs / 360000));
          companyRepository.updateSimBoosts(poacherCompanyId, -cost);
          simboostsDelta = -cost;
        }
        offer = executiveRepository.accelerateOfferSearch(offerId, poacherCompanyId, now, now);
        offer = resolveSearchOffer(offer, now);
        return {
          offer: formattedOfferWithExecutive(offer),
          simboostsDelta
        };
      }
      if (payload.executive === true || payload.salary !== undefined || payload.status) {
        throw new Error('Candidate search is still in progress');
      }
      return {
        offer: formatOffer(offer, null),
        simboostsDelta: 0
      };
    }

    const requestedStatus = payload.status ? normalizeOfferStatus(payload.status) : undefined;
    const wantsFormalOffer = payload.executive === true
      || payload.salary !== undefined
      || requestedStatus === 's';

    if (!wantsFormalOffer && requestedStatus) {
      if (requestedStatus === 'l') {
        const refreshed = executiveRepository.refreshOffer(
          offerId,
          poacherCompanyId,
          searchDeadlineIso(now),
          now
        );
        return formatOffer(refreshed, null);
      }
      const updated = executiveRepository.setOfferStatus(offerId, requestedStatus, now);
      return {
        offer: formattedOfferWithExecutive(updated),
        simboostsDelta: 0
      };
    }

    if (!wantsFormalOffer) {
      return {
        offer: formattedOfferWithExecutive(offer),
        simboostsDelta: 0
      };
    }

    if (status !== 'f') {
      throw new Error('Offer is no longer awaiting a candidate response');
    }
    if (offer.target_executive_id === null) {
      throw new Error('Offer has no candidate');
    }

    const target = executiveRepository.findById(offer.target_executive_id);
    if (!target) throw new Error('Target executive is no longer available');
    const expectedSalary = Number(offer.expected_salary) > 0
      ? Number(offer.expected_salary)
      : Number(target.salary) > 0
        ? Number(target.salary)
        : 400;
    const salary = payload.salary === undefined
      ? (offer.salary !== null && offer.salary > 0 ? offer.salary : expectedSalary)
      : Number(payload.salary);
    if (!Number.isFinite(salary) || salary <= 0) {
      throw new Error('Salary must be a positive number');
    }
    if (salary < expectedSalary * 0.9 || salary > expectedSalary * 10) {
      throw new Error(`Salary must be between ${Math.ceil(expectedSalary * 0.9)} and ${Math.floor(expectedSalary * 10)}`);
    }

    const targetStatus = String(target.status || '').toLowerCase();
    const agencyTier = Number(offer.agency) || AgencyTier.IN_HOUSE;
    const multiplier = AGENCY_FEE_MULTIPLIERS[agencyTier] ?? 0;
    const agencyFee = Number(offer.agency_fee) > 0
      ? Number(offer.agency_fee)
      : Math.round(expectedSalary * multiplier);

    if (targetStatus === 'candidate') {
      const comp = companyRepository.findById(poacherCompanyId);
      if (!comp) throw new Error('Company not found');
      const employedCount = executiveRepository.countEmployed(poacherCompanyId);
      const maxSlots = 4 + (Number(comp.extraExecutiveSlots) || 0);
      if (employedCount >= maxSlots) {
        throw new Error(`Executive slot limit reached (${employedCount}/${maxSlots}). Unlock more slots with SimBoosts.`);
      }
      if (Number(offer.agency_fee) <= 0 && agencyFee > 0) {
        companyRepository.updateMoney(poacherCompanyId, -agencyFee);
      }
      const position = offer.slot_position || 'unassigned';
      if (target.company_id === poacherCompanyId) {
        const hired = executiveRepository.hireCandidate(target.id, poacherCompanyId, position, 0);
        if (hired !== 1) throw new Error('Candidate is no longer available');
        executiveRepository.updateSalary(target.id, poacherCompanyId, salary);
        executiveRepository.beginEmploymentHistory(target.id, poacherCompanyId, position, now);
      } else {
        executiveRepository.transferToCompany(target.id, poacherCompanyId, salary, now, position);
      }
      const accepted = executiveRepository.setOfferStatus(offerId, 'a', now);
      return {
        offer: formattedOfferWithExecutive({
          ...accepted,
          agency_fee: agencyFee,
          salary
        }),
        simboostsDelta: 0
      };
    }

    if (targetStatus !== 'employed' || target.company_id === null
        || target.company_id !== offer.target_company_id) {
      throw new Error('Target executive is no longer available');
    }
    if (Number(offer.agency_fee) <= 0 && agencyFee > 0) {
      companyRepository.updateMoney(poacherCompanyId, -agencyFee);
    }
    const extended = executiveRepository.extendOffer(
      offerId,
      poacherCompanyId,
      salary,
      agencyFee,
      now,
      now
    );
    return {
      offer: formattedOfferWithExecutive(extended),
      simboostsDelta: 0
    };
  }, { immediate: true });
}

async function dismissPoachingOffer(poacherCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
  if (!offer) throw new Error('Poaching offer not found');

  return runInTransaction(async () => {
    executiveRepository.deleteOffer(offerId, poacherCompanyId);
    return { success: true };
  }, { immediate: true });
}

async function refreshPoachingOffer(poacherCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
  if (!offer) throw new Error('Poaching offer not found');

  return runInTransaction(async () => {
    const now = virtualClock.nowIso();
    const updated = executiveRepository.refreshOffer(
      offerId,
      poacherCompanyId,
      searchDeadlineIso(now),
      now
    );
    return formatOffer(updated, null);
  }, { immediate: true });
}

/**
 * Research employer / poacher (Costs 5 SimBoosts)
 */
async function researchEmployerByPoacher(poacherCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
  if (!offer) throw new Error('Poaching offer not found');
  if (normalizeOfferStatus(offer.status) === 'l'
      || offer.target_executive_id === null
      || offer.target_company_id === null) {
    throw new Error('Candidate search is still in progress');
  }

  const exec = executiveRepository.findById(offer.target_executive_id);
  const targetComp = companyRepository.findById(offer.target_company_id);

  const RESEARCH_COST_SB = 5;

  return runInTransaction(async () => {
    companyRepository.updateSimBoosts(poacherCompanyId, -RESEARCH_COST_SB);

    const researchData = {
      marketSalary: Math.round((Number(exec?.salary) || 400) * 1.1),
      acceptingSalary: Math.round(Number(offer.expected_salary) * 1.05),
      employerCompanyValue: Number(targetComp?.money) || 500000,
      employerAcceptanceRate: 0.35,
      averageAcceptedIncrease: 1.25,
      averageRefusedIncrease: 1.5,
      employerAcceptedOffersCount: 2,
      employerRejectedOffersCount: 4,
      employerAcceptedOffersMean: 1.25,
      employerRejectedOffersMean: 1.5
    };

    const researchJson = JSON.stringify(researchData);
    const now = virtualClock.nowIso();

    const updatedOffer = executiveRepository.setResearchPoacher(offerId, researchJson, now);

    const formatted = formatOffer(updatedOffer, exec || null);
    return {
      ...formatted,
      offer: formatted,
      simboostsDelta: -RESEARCH_COST_SB
    };
  }, { immediate: true });
}

function getHostileOffers(targetCompanyId: number) {
  return executiveRepository.listHostileOffers(targetCompanyId).map(offer => {
    const exec = offer.target_executive_id === null
      ? null
      : executiveRepository.findById(offer.target_executive_id);
    return formatHostileOffer(offer, exec || null);
  });
}

function getHostileOfferById(targetCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForTarget(offerId, targetCompanyId);
  if (!offer) throw new Error('Hostile offer not found');
  if (offer.target_executive_id === null) throw new Error('Hostile offer has no executive');
  const exec = executiveRepository.findById(offer.target_executive_id);
  return formatHostileOffer(offer, exec || null);
}


async function researchPoacherByEmployer(targetCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForTarget(offerId, targetCompanyId);
  if (!offer) throw new Error('Hostile offer not found');
  if (offer.target_executive_id === null) throw new Error('Hostile offer has no executive');

  const exec = executiveRepository.findById(offer.target_executive_id);
  const poacherComp = companyRepository.findById(offer.poacher_company_id);

  const RESEARCH_COST_SB = 5;

  return runInTransaction(async () => {
    companyRepository.updateSimBoosts(targetCompanyId, -RESEARCH_COST_SB);

    const researchData = {
      marketSalary: Math.round((Number(exec?.salary) || 400) * 1.1),
      poacherCompanyValue: Number(poacherComp?.money) || 750000,
      poacherAverageSalary: 450,
      poacherFiredEmployeesCount: 0,
      poacherAverageYearsSpendAtCompany: 1.5
    };

    const researchJson = JSON.stringify(researchData);
    const now = virtualClock.nowIso();

    const updatedOffer = executiveRepository.setResearchEmployer(offerId, researchJson, now);

    const formatted = formatHostileOffer(updatedOffer, exec || null);
    return {
      ...formatted,
      offer: formatted,
      simboostsDelta: -RESEARCH_COST_SB
    };
  }, { immediate: true });
}

async function counterHostileOffer(targetCompanyId: number, offerId: number, body: CounterHostileOfferInput) {
  const offer = executiveRepository.findOfferForTarget(offerId, targetCompanyId);
  if (!offer) throw new Error('Hostile offer not found');
  if (offer.target_executive_id === null) throw new Error('Hostile offer has no executive');

  const exec = executiveRepository.findByIdAndCompany(offer.target_executive_id, targetCompanyId);
  if (!exec) throw new Error('Target executive not found at your company');

  const isAccept = body.action === 'accept' || body.accept === true;
  const isDecline = body.action === 'decline' || body.accept === false;
  const isCounter = body.action === 'counter' || (body.salary !== undefined && !isAccept && !isDecline);

  return runInTransaction(async () => {
    const now = virtualClock.nowIso();

    if (isCounter && body.salary !== undefined) {
      if (!Number.isFinite(body.salary) || body.salary <= 0) {
        throw new Error('Counter salary must be a positive number');
      }
      // Target employer counters with higher salary (retaining executive)
      executiveRepository.setSalaryForCompany(exec.id, targetCompanyId, body.salary);
      const updatedOffer0 = executiveRepository.setOfferStatus(offerId, 'r', now);

      const updatedExec = executiveRepository.findById(exec.id) as ExecutiveRow;

      return {
        success: true,
        retained: true,
        stayed: true,
        executive: formatExecutive(updatedExec),
        offer: formatHostileOffer(updatedOffer0, updatedExec)
      };
    }

    if (isAccept) {
      // Declines to counter / accepts departure (executive leaves, 0 severance)
      // Executive leaves employer company and transfers to poacher company
      const offeredSalary = offer.salary || offer.expected_salary;
      executiveRepository.transferToCompany(exec.id, offer.poacher_company_id, offeredSalary);
      const updatedOffer1 = executiveRepository.setOfferStatus(offerId, 'a', now);

      const transferredExec = executiveRepository.findById(exec.id) as ExecutiveRow;

      return {
        success: true,
        stayed: false,
        moneyDelta: 0,
        executive: formatExecutive(transferredExec),
        offer: formatHostileOffer(updatedOffer1, transferredExec)
      };
    }

    // Default decline/reject
    const updatedOffer2 = executiveRepository.setOfferStatus(offerId, 'r', now);

    return {
      success: true,
      stayed: true,
      retained: true,
      offer: formatHostileOffer(updatedOffer2, exec)
    };
  }, { immediate: true });
}

async function letGoHostileOffer(targetCompanyId: number, offerId: number) {
  return counterHostileOffer(targetCompanyId, offerId, { action: 'accept' });
}

async function rejectHostileOffer(targetCompanyId: number, offerId: number) {
  return counterHostileOffer(targetCompanyId, offerId, { action: 'decline' });
}

// --- Queries (read-only) -----------------------------------------------------

export function getCompanyExecutivesQuery(companyId: number) {
  return getCompanyExecutives(companyId);
}

export function getExecutiveCandidatesQuery(companyId: number) {
  return getExecutiveCandidates(companyId);
}

export function getExecutiveByIdQuery(companyId: number, executiveId: number) {
  return getExecutiveById(companyId, executiveId);
}
export function getFormerExecutivesQuery(companyId: number) {
  return executiveRepository.listFormerByCompany(companyId).map(formatFormerExecutive);
}

export function getExecutiveNoteQuery(companyId: number, executiveId: number) {
  const executive = executiveRepository.findByIdAndCompany(executiveId, companyId);
  if (!executive) throw new Error('Executive not found');
  const row = executiveRepository.getNote(companyId, executiveId);
  return {
    executiveId,
    note: row?.note || '',
    datetime: validIsoOrNull(row?.datetime)
      || validIsoOrNull(executive.created_at)
      || new Date(0).toISOString()
  };
}


export function getPoachingOffersQuery(companyId: number) {
  return getPoachingOffers(companyId);
}

export function getPoachingOfferByIdQuery(companyId: number, offerId: number) {
  return getPoachingOfferById(companyId, offerId);
}

export function getHostileOffersQuery(companyId: number) {
  return getHostileOffers(companyId);
}

export function getHostileOfferByIdQuery(companyId: number, offerId: number) {
  return getHostileOfferById(companyId, offerId);
}

// --- Commands (mutations with GameContext ownership contract) -----------------

export function hireExecutiveCommand(ctx: GameContext, candidateId: number, position: string = 'unassigned') {
  return hireExecutive(ctx.companyId, candidateId, position);
}

export function fireExecutiveCommand(ctx: GameContext, executiveId: number) {
  return fireExecutive(ctx.companyId, executiveId);
}

export function assignExecutiveCommand(ctx: GameContext, executiveId: number, position: string) {
  return assignExecutive(ctx.companyId, executiveId, position);
}

export function updateExecutiveCommand(ctx: GameContext, executiveId: number, updates: UpdateExecutiveInput) {
  return updateExecutive(ctx.companyId, executiveId, updates);
}

export function trainExecutiveCommand(ctx: GameContext, executiveId: number) {
  return trainExecutive(ctx.companyId, executiveId);
}

export function scheduleExecutiveTrainingCommand(
  ctx: GameContext,
  executiveId: number,
  trainingCode: unknown = 'o'
) {
  return scheduleExecutiveTraining(
    ctx.companyId,
    executiveId,
    normalizeExecutiveTrainingCode(trainingCode)
  );
}

export function rushExecutiveTrainingCommand(ctx: GameContext, executiveId: number, trainingId: number) {
  return rushExecutiveTraining(ctx.companyId, executiveId, trainingId);
}

export function cancelExecutiveTrainingCommand(ctx: GameContext, executiveId: number, trainingId: number) {
  return cancelExecutiveTraining(ctx.companyId, executiveId, trainingId);
}

export function createPoachingOfferCommand(ctx: GameContext, input: CreatePoachingOfferInput) {
  return createPoachingOffer(ctx.companyId, input);
}

export function updatePoachingOfferCommand(ctx: GameContext, offerId: number, body: Record<string, unknown>) {
  return updatePoachingOffer(ctx.companyId, offerId, body);
}

export function dismissPoachingOfferCommand(ctx: GameContext, offerId: number) {
  return dismissPoachingOffer(ctx.companyId, offerId);
}

export function refreshPoachingOfferCommand(ctx: GameContext, offerId: number) {
  return refreshPoachingOffer(ctx.companyId, offerId);
}

export function researchEmployerCommand(ctx: GameContext, offerId: number) {
  return researchEmployerByPoacher(ctx.companyId, offerId);
}

export function counterHostileOfferCommand(ctx: GameContext, offerId: number, body: CounterHostileOfferInput) {
  return counterHostileOffer(ctx.companyId, offerId, body);
}

export function letGoHostileOfferCommand(ctx: GameContext, offerId: number) {
  return letGoHostileOffer(ctx.companyId, offerId);
}

export function rejectHostileOfferCommand(ctx: GameContext, offerId: number) {
  return rejectHostileOffer(ctx.companyId, offerId);
}

export function researchPoacherCommand(ctx: GameContext, offerId: number) {
  return researchPoacherByEmployer(ctx.companyId, offerId);
}

// Ownership assertion used by routes before dispatch (fail fast 403).
export function assertExecutiveOwned(ctx: GameContext, executiveId: number): void {
  const exec = executiveRepository.findByIdAndCompany(executiveId, ctx.companyId);
  if (!exec) {
    throw new ForbiddenError('Executive does not belong to your company');
  }
}
