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
import { companyRepository } from '../../repositories/company-repository.ts';
import {
  executiveRepository,
  type ExecutiveRow,
  type ExecutiveOfferRow
} from '../../repositories/executive-repository.ts';
import {
  AGENCY_FEE_MULTIPLIERS,
  EXECUTIVE_TRAINING_COST,
  EXECUTIVE_TRAINING_MONEY_COST,
  EXECUTIVE_TRAINING_WINDOW_S,
  AgencyTier,
  academySkillBonus,
  generateDeterministicGenome,
  normalizeOfferStatus,
  normalizePositionCode,
  parseAgencyTier,
  validIsoOrNull
} from '../../domain/executives.ts';
import { recordCashLedger } from '../../game/cash-ledger.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { ForbiddenError } from '../../errors/domain-error.ts';

export type { CreatePoachingOfferInput, CounterHostileOfferInput } from './executive-inputs.ts';
import type { CreatePoachingOfferInput, UpdateExecutiveInput, CounterHostileOfferInput } from './executive-inputs.ts';

// --- Formatting (DTO mapping, no SQL) -----------------------------------------

export function formatExecutive(e: ExecutiveRow) {
  const normPos = normalizePositionCode(e.position);
  const mgmt = Number(e.skill_management) || 0;
  const acct = Number(e.skill_accounting) || 0;
  const sci = Number(e.skill_science) || 0;
  const comm = Number(e.skill_communication) || 0;
  const avatar = e.avatar || 'images/avatars/male_01.png';
  const gen = generateDeterministicGenome(e.id || e.name, avatar, e.name);
  const createdAtMs = Date.parse(validIsoOrNull(e.created_at) || '') || (virtualClock.nowMs() - 86400000);
  const workStart = new Date(createdAtMs).toISOString();
  const training = executiveRepository.findActiveTraining(e.id);
  const daysActive = Math.max(0, Math.floor((virtualClock.nowMs() - new Date(workStart).getTime()) / 86400000));
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
    extended: validIsoOrNull(offer.extended_at) || validIsoOrNull(offer.created_at) || virtualClock.nowIso(),
    created: validIsoOrNull(offer.created_at) || virtualClock.nowIso(),
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
    extended: validIsoOrNull(offer.extended_at) || validIsoOrNull(offer.created_at) || virtualClock.nowIso(),
    created: validIsoOrNull(offer.created_at) || virtualClock.nowIso(),
    companyId: offer.target_company_id,
    poacherCompanyId: offer.poacher_company_id,
    researchEmployer: offer.research_employer ? JSON.parse(offer.research_employer) : null
  };
}

// --- Lazy training resolution (read path applies due trainings) ----------------

/** Apply skill gains for every training whose 27h window has elapsed. */
function resolveCompletedTrainings(companyId: number) {
  const cutoff = new Date(virtualClock.nowMs() - EXECUTIVE_TRAINING_WINDOW_S * 1000).toISOString();
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
    const updated = executiveRepository.hireCandidate(candidateId, companyId, position, startingBonus);
    if (updated !== 1) throw new Error('Failed to hire candidate');
    const row = executiveRepository.findById(candidateId) as ExecutiveRow;
    return formatExecutive(row);
  }, { immediate: true });
}

function fireExecutive(companyId: number, executiveId: number) {
  return runInTransaction(async () => {
    const exec = executiveRepository.findEmployed(executiveId, companyId);
    if (!exec) throw new Error('Employed executive not found');

    // Dismissal severance = executive.salary * 3
    const severance = Math.round((Number(exec.salary) || 250) * 3);

    companyRepository.updateMoney(companyId, -severance);
    const deleted = executiveRepository.deleteEmployed(executiveId, companyId);
    if (deleted !== 1) throw new Error('Employed executive not found');
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
    // marking the work history accelerated so the client-side window
    // (which excludes accelerated executives) closes.
    if (updates.rushSettle === true) {
      const startMs = new Date(validIsoOrNull(exec.created_at) || virtualClock.nowIso()).getTime();
      const settleEndMs = startMs + 3 * 3600000;
      const alreadySettled = Boolean(exec.work_history_accelerated) || settleEndMs <= virtualClock.nowMs();
      if (!alreadySettled) {
        const cost = Math.max(1, Math.ceil((settleEndMs - virtualClock.nowMs()) / 360000));
        const comp = companyRepository.findById(companyId);
        if (!comp || Number(comp.simboosts) < cost) {
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

function serializeTraining(row: { id: number; datetime: string; accelerated: number }) {
  return { id: row.id, datetime: row.datetime, accelerated: Boolean(row.accelerated) };
}

function scheduleExecutiveTraining(companyId: number, executiveId: number) {
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

    const now = virtualClock.now();
    recordCashLedger({
      companyId,
      amount: -EXECUTIVE_TRAINING_MONEY_COST,
      category: 'h',
      description: 'Executive training',
      descriptionKey: `et-${exec.name}`,
      details: { executiveId, name: exec.name }
    });
    companyRepository.updateMoney(companyId, -EXECUTIVE_TRAINING_MONEY_COST, { skipLedger: true });

    const row = executiveRepository.insertTraining(executiveId, companyId, now.toISOString());
    return { training: serializeTraining(row), moneyDelta: -EXECUTIVE_TRAINING_MONEY_COST };
  }, { immediate: true });
}

function rushExecutiveTraining(companyId: number, executiveId: number, trainingId: number) {
  return runInTransaction(async () => {
    const training = executiveRepository.findUnfinishedTraining(trainingId, executiveId, companyId);
    if (!training) throw new Error('Training not found or already finished');

    const finishMs = new Date(training.datetime).getTime() + EXECUTIVE_TRAINING_WINDOW_S * 1000;
    const cost = Math.max(1, Math.ceil((finishMs - virtualClock.nowMs()) / 360000));
    const comp = companyRepository.findById(companyId);
    if (!comp || Number(comp.simboosts) < cost) {
      throw new Error(`Not enough SimBoosts to rush training (requires ${cost})`);
    }
    companyRepository.updateSimBoosts(companyId, -cost);

    const applied = executiveRepository.addFourSkills(executiveId, 1);
    if (applied !== 1) throw new Error('Executive training failed');
    executiveRepository.markTrainingAccelerated(trainingId);

    const updated = executiveRepository.findById(executiveId) as ExecutiveRow;
    return {
      training: serializeTraining({ ...training, accelerated: 1 }),
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

export async function createPoachingOffer(poacherCompanyId: number, input: CreatePoachingOfferInput) {
  const agencyTier = parseAgencyTier(input.agency);
  const multiplier = AGENCY_FEE_MULTIPLIERS[agencyTier] ?? 0;
  const slotPos = (input.slotPosition || 'coo').toLowerCase();
  const skillPos = (input.skillPosition || 'o').toLowerCase();

  let targetExecutive: ExecutiveRow | undefined;
  let targetCompanyId = input.targetCompanyId;

  if (input.targetExecutiveId) {
    targetExecutive = executiveRepository.findById(input.targetExecutiveId);
    if (!targetExecutive) {
      throw new Error('Target executive not found');
    }
    if (targetExecutive.company_id === poacherCompanyId) {
      throw new Error('Cannot poach your own executive');
    }
    targetCompanyId = targetExecutive.company_id;
  } else {
    // Find an employed executive at another company matching slot/skill, or any other company's executive
    const potentialTargets = executiveRepository.listRandomEmployedElsewhere(poacherCompanyId);

    if (potentialTargets.length > 0) {
      targetExecutive = potentialTargets[0];
      targetCompanyId = targetExecutive.company_id;
    } else {
      // Create a poachable candidate executive in another company or global pool
      const otherCompany = executiveRepository.findAnyOtherCompany(poacherCompanyId);
      const foreignCompanyId = otherCompany ? otherCompany.company_id : 999999;
      targetCompanyId = foreignCompanyId;

      const baseSkill = agencyTier === AgencyTier.TOP_TALENT_AGENCY ? 20 :
                         agencyTier === AgencyTier.GOOD_AGENCY ? 15 :
                         agencyTier === AgencyTier.STAFFING_AGENCY ? 10 : 6;
      const salaryByTier = agencyTier === AgencyTier.TOP_TALENT_AGENCY ? 1500 :
                           agencyTier === AgencyTier.GOOD_AGENCY ? 800 :
                           agencyTier === AgencyTier.STAFFING_AGENCY ? 500 : 300;

      const nowIso = virtualClock.nowIso();
      targetExecutive = executiveRepository.insertForeignTarget(foreignCompanyId, slotPos, baseSkill, salaryByTier, nowIso);
    }
  }

  const expectedSalary = input.expectedSalary ?? Number(targetExecutive?.salary || 400);
  const agencyFee = Math.round(expectedSalary * multiplier);

  const poacherComp = companyRepository.findById(poacherCompanyId);
  if (!poacherComp || poacherComp.money < agencyFee) {
    throw new Error(`Insufficient funds for agency fee ($${agencyFee})`);
  }

  return runInTransaction(async () => {
    // Deduct agency fee
    if (agencyFee > 0) {
      companyRepository.updateMoney(poacherCompanyId, -agencyFee);
    }

    const now = virtualClock.nowIso();
    const offerRow = executiveRepository.insertOffer({
      poacherCompanyId,
      targetCompanyId: targetCompanyId as number,
      targetExecutiveId: targetExecutive!.id,
      slotPos,
      skillPos,
      agencyTier,
      expectedSalary,
      agencyFee,
      now
    });

    return formatOffer(offerRow, targetExecutive!);
  }, { immediate: true });
}

export function getPoachingOffers(poacherCompanyId: number) {
  return executiveRepository.listOffersByPoacher(poacherCompanyId).map(offer => {
    const exec = executiveRepository.findById(offer.target_executive_id);
    return formatOffer(offer, exec || null);
  });
}

function getPoachingOfferById(poacherCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
  if (!offer) throw new Error('Poaching offer not found');
  const exec = executiveRepository.findById(offer.target_executive_id);
  return formatOffer(offer, exec || null);
}

async function updatePoachingOffer(
  poacherCompanyId: number,
  offerId: number,
  payload: { status?: string; executive?: boolean; salary?: number; accelerated?: boolean }
) {
  const offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
  if (!offer) throw new Error('Poaching offer not found');

  return runInTransaction(async () => {
    let nextStatus = offer.status;
    let salary = offer.salary;
    let extendedAt = offer.extended_at;
    let accelerated = offer.accelerated;
    const now = virtualClock.nowIso();

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

    executiveRepository.updateOfferState(offerId, poacherCompanyId, nextStatus, salary, extendedAt, accelerated, now);

    const updatedRow = executiveRepository.findOfferById(offerId) as ExecutiveOfferRow;
    const exec = executiveRepository.findById(updatedRow.target_executive_id);
    return formatOffer(updatedRow, exec || null);
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
    const updated = executiveRepository.refreshOffer(offerId, poacherCompanyId, now);
    const exec = executiveRepository.findById(updated.target_executive_id);
    return formatOffer(updated, exec || null);
  }, { immediate: true });
}

/**
 * Research employer / poacher (Costs 5 SimBoosts)
 */
async function researchEmployerByPoacher(poacherCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForPoacher(offerId, poacherCompanyId);
  if (!offer) throw new Error('Poaching offer not found');

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
      employerRejectedOffersCount: 4
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
    const exec = executiveRepository.findById(offer.target_executive_id);
    return formatHostileOffer(offer, exec || null);
  });
}

function getHostileOfferById(targetCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForTarget(offerId, targetCompanyId);
  if (!offer) throw new Error('Hostile offer not found');
  const exec = executiveRepository.findById(offer.target_executive_id);
  return formatHostileOffer(offer, exec || null);
}

async function researchPoacherByEmployer(targetCompanyId: number, offerId: number) {
  const offer = executiveRepository.findOfferForTarget(offerId, targetCompanyId);
  if (!offer) throw new Error('Hostile offer not found');

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

export function scheduleExecutiveTrainingCommand(ctx: GameContext, executiveId: number) {
  return scheduleExecutiveTraining(ctx.companyId, executiveId);
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
