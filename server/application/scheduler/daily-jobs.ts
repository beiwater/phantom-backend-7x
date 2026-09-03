/**
 * Scheduler business jobs (Issue #105 Phase 8 / Issue #104 Stage 7).
 *
 * The scheduler (scheduler/timetable.ts) is a PURE trigger: it decides WHEN a
 * task runs. Every business mutation (bond interest, admin overhead,
 * executive salaries, government orders publish/award, economy phase roll,
 * retail saturation refresh) lives here as an Application job so the
 * scheduler contains no formulas, no SQL, and no money movement.
 */
import { db } from '../../db/database.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { bondRepository } from '../../repositories/bond-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { governmentOrdersRepository } from '../../repositories/government-orders-repository.ts';
import { schedulerStateRepository } from '../../repositories/scheduler-state-repository.ts';
import { recordCashLedger } from '../../game/cash-ledger.ts';
import { getAllResourceDefs } from '../../game-data/resources.ts';
import { virtualClock } from '../../core/virtual-clock.ts';

import { grantCycleCertificates } from '../../game/certificates.ts';
const DAY_MS = 24 * 60 * 60 * 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- Scheduled task implementations (00:00 UTC: bond interest + accounting overhead) ---

/**
 * Daily bond interest. Only bonds actually held by a buyer accrue interest
 * (open offers do not). Player-issued bonds deduct the interest from the
 * issuer; an issuer who cannot cover it defaults and the holder receives
 * whatever could still be paid (decompile formulas_bonds.md §7). System-seeded
 * bonds (issuer 999900, no company row) pay the yield to the holder directly.
 */
export function chargeDailyBondInterest(): void {
  for (const bond of bondRepository.findActiveHeld()) {
    const interest = round2(bond.amount * bond.interestRate);
    if (!(interest > 0)) continue;

    const holderId = bond.buyerCompanyId as number;
    const holder = companyRepository.findById(holderId);
    if (!holder) continue;

    const issuerId = bond.sellerCompanyId;
    const issuer = issuerId !== null ? companyRepository.findById(issuerId) : null;

    if (issuer) {
      const funds = Number(issuer.money) || 0;
      const paid = round2(Math.max(0, Math.min(funds, interest)));
      if (paid > 0) {
        recordCashLedger({
          companyId: issuerId as number,
          amount: -paid,
          category: 'i',
          description: 'Bond interest payment',
          descriptionKey: '1-bondinterest',
          details: { bondId: bond.id }
        });
        companyRepository.updateMoney(issuerId as number, -paid, { skipLedger: true });
        recordCashLedger({
          companyId: holderId,
          amount: paid,
          category: 'i',
          description: 'Bond interest collected',
          descriptionKey: '1-bondyield',
          details: { bondId: bond.id }
        });
        companyRepository.updateMoney(holderId, paid, { skipLedger: true });
      }
      if (paid < interest) {
        bondRepository.markDefaulted(bond.id);
      }
    } else {
      recordCashLedger({
        companyId: holderId,
        amount: interest,
        category: 'i',
        description: 'Bond interest collected',
        descriptionKey: '1-bondyield',
        details: { bondId: bond.id }
      });
      companyRepository.updateMoney(holderId, interest, { skipLedger: true });
    }
  }
}

/**
 * Daily accounting overhead charge. Follows the server's linear overhead model
 * (finance-routes: AO = 1 + (buildingCount − 1) × 0.035) combined with the
 * decompiled per-building cost `size × 100 × (AO − 1)` and the COO reduction
 * `ph(AO, cooSkill) = AO − (AO − 1) × cooSkill / 100` (formulas_admin.md).
 * Booked to cash ledger category 'a' (accounting).
 */
export function chargeDailyAccountingOverhead(): void {
  for (const comp of bondRepository.listCompanyCash()) {
    const companyId = comp.companyId;
    const stats = companyRepository.getAccountingOverheadStats(companyId);

    const buildingCount = stats.buildingCount;
    if (buildingCount === 0) continue;

    const ao = 1 + Math.max(0, buildingCount - 1) * 0.035;
    const cooSkill = Math.max(0, Math.min(100, stats.cooSkill));
    const effective = ao - (ao - 1) * cooSkill / 100;
    const baseCharge = round2(stats.totalSize * 100 * (effective - 1));

    // #155: the CFO + bank lift extends the fee-free holdings threshold
    // (base 3,000,000; executiveLift = cfoSkill × 500k, bankLift = cfoSkill ×
    // bankLevel × 50k). Our fee is a per-building linear model, so the
    // exemption is applied as the proportional share of the charge it
    // exempts: discount = charge × lift / (base + lift). Zero lift keeps
    // the previous charge unchanged.
    const lift = companyRepository.getAccountingLift(companyId);
    const exempt = lift.executiveLift + lift.bankLift;
    const charge = exempt > 0
      ? round2(Math.max(0, baseCharge - baseCharge * exempt / (3000000 + exempt)))
      : baseCharge;
    if (!(charge > 0)) continue;

    const funds = comp.money;
    const paid = round2(Math.max(0, Math.min(funds, charge)));
    if (!(paid > 0)) continue;

    const details: Record<string, unknown> = {
      bank_level: lift.bankSize,
      bank_lift: lift.bankLift,
      executive_lift: lift.executiveLift
    };
    if (lift.bankSize > 0 && !lift.bankContributing) {
      details.bank_not_contributing_reason = 'construction';
    }

    recordCashLedger({
      companyId,
      amount: -paid,
      category: 'a',
      description: 'Daily accounting overhead',
      descriptionKey: '1-accounting',
      details
    });
    companyRepository.updateMoney(companyId, -paid, { skipLedger: true });
  }
}

// --- 04:00 UTC: executive salaries ---

/**
 * Daily executive salary debit (category 'e'). Companies that cannot cover the
 * full payroll pay what they have — the same "pay what you can" convention the
 * daily loan accrual already uses (loans.ts).
 */
export function debitExecutiveSalaries(): void {
  for (const row of companyRepository.listExecutivePayrolls()) {
    const total = round2(row.salaries);
    if (!(total > 0)) continue;
    const companyId = row.companyId;
    const funds = row.money;
    const paid = round2(Math.max(0, Math.min(funds, total)));
    if (!(paid > 0)) continue;

    recordCashLedger({
      companyId,
      amount: -paid,
      category: 'e',
      description: 'Executive daily salaries',
      descriptionKey: '1-salaries'
    });
    companyRepository.updateMoney(companyId, -paid, { skipLedger: true });
  }
}

// --- 13:00 UTC Wednesday: Government Orders publication ---

/**
 * Weekly Government Orders publication: makes sure every realm has the standard
 * project pool and republishes any order whose bidding deadline already passed
 * with a fresh window starting at this occurrence.
 */
export function publishGovernmentOrders(occurrence: Date): void {
  const realmRows = governmentOrdersRepository.listRealms();
  const realms = realmRows.length > 0 ? realmRows : [0];
  for (const realmId of realms) {
    governmentOrdersRepository.ensureSeededProjects(realmId);
  }

  const occIso = occurrence.toISOString();
  for (const order of governmentOrdersRepository.listStaleOrders(occIso)) {
    const days = Math.max(1, order.daysToFulfill || 7);
    const deadline = new Date(occurrence.getTime() + days * DAY_MS).toISOString();
    governmentOrdersRepository.republishOrder(order.id, occIso, deadline);
  }
}

// --- 13:00 UTC Monday: Government Orders award fulfillment ---

export function bidTotalValue(
  bid: { price_breakdown_json: string | null },
  template: { required_resources_json: string; unit_compensation_price: number }
): number {
  let prices: Record<string, number> = {};
  try {
    prices = JSON.parse(bid.price_breakdown_json || '{}') || {};
  } catch {
    prices = {};
  }
  let required: Array<Record<string, unknown>> = [];
  try {
    required = JSON.parse(template.required_resources_json || '[]') || [];
  } catch {
    required = [];
  }
  let total = 0;
  for (const entry of required) {
    const amount = Number(entry.targetAmount ?? entry.amountBase ?? entry.amount) || 0;
    const kind = String(entry.kind);
    const price = prices[kind] !== undefined
      ? Number(prices[kind])
      : Number(template.unit_compensation_price) || 0;
    total += amount * price;
  }
  return total;
}

/**
 * Award fulfillment: for every order whose bidding deadline has passed and
 * which still has OPEN bids, the lowest total bid wins (formulas_government.md
 * "Lowest Bid Wins"). The winner is marked AWARDED and the template receives
 * its resourceMultiplierAwarded; losing bids are REJECTED and their security
 * deposits refunded (same refund behaviour as deleteGovernmentBid).
 */
export function awardGovernmentBids(occurrence: Date): void {
  for (const template of governmentOrdersRepository.listAwardableTemplates(occurrence.toISOString())) {
    const openBids = governmentOrdersRepository.listOpenBids(template.id);
    if (openBids.length === 0) continue;

    let winner = openBids[0];
    let winnerValue = bidTotalValue(winner, template);
    for (const bid of openBids.slice(1)) {
      const value = bidTotalValue(bid, template);
      if (value < winnerValue) {
        winner = bid;
        winnerValue = value;
      }
    }

    for (const bid of openBids) {
      if (bid.id === winner.id) {
        governmentOrdersRepository.markBidAwarded(bid.id);
        continue;
      }
      governmentOrdersRepository.markBidRejected(bid.id);
      for (const contractor of governmentOrdersRepository.listDepositHolders(bid.secret)) {
        if (companyRepository.findById(contractor.companyId)) {
          updateCompanyMoney(contractor.companyId, contractor.depositPaid);
        }
        governmentOrdersRepository.forfeitDeposits(bid.secret, contractor.companyId);
      }
    }

    const multiplier = governmentOrdersRepository.mainContractorTierMultiplier(winner.secret);
    governmentOrdersRepository.setAwardedMultiplier(template.id, multiplier);
  }
}

// --- 15:00 UTC Friday: economy phase roll ---

export const ECONOMY_STATE_NAMES: Record<number, string> = {
  0: 'Recession',
  1: 'Normal',
  2: 'Boom'
};

/** Markov-style transition weights per current state (decompile economy_model.json). */
const ECONOMY_TRANSITIONS: Record<number, Array<readonly [number, number]>> = {
  0: [[1, 0.5], [0, 0.25], [2, 0.25]],
  1: [[1, 0.6], [2, 0.2], [0, 0.2]],
  2: [[1, 0.5], [2, 0.25], [0, 0.25]]
};

export interface EconomyPhaseStatus {
  realmId: number;
  state: number;
  phase: 'recession' | 'normal' | 'boom';
  stateName: string;
  status: 'active';
  startAt: string;
  endAt: string;
  updatedAt: string | null;
  source: string;
  productionModifier: number;
  productionBonus: number;
  productionMalus: number;
  modifierKind: 'bonus' | 'malus' | 'neutral';
  modifierSeed: number;
}

export interface EconomyPhaseHistoryEntry {
  id: number;
  realmId: number;
  state: number;
  phase: 'recession' | 'normal' | 'boom';
  stateName: string;
  status: 'active' | 'ended';
  startAt: string;
  endAt: string | null;
  source: string;
  generatedAt: string;
  durationDays: number;
  productionModifier: number;
  productionBonus: number;
  productionMalus: number;
  modifierKind: 'bonus' | 'malus' | 'neutral';
  modifierSeed: number;
}

const ECONOMY_PHASE_NAMES: Record<number, 'recession' | 'normal' | 'boom'> = {
  0: 'recession',
  1: 'normal',
  2: 'boom'
};

function nextEconomyBoundary(from: Date): Date {
  const next = new Date(from.getTime());
  const daysUntilFriday = (5 - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + daysUntilFriday);
  next.setUTCHours(15, 0, 0, 0);
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

function phaseName(state: number): 'recession' | 'normal' | 'boom' {
  return ECONOMY_PHASE_NAMES[state] ?? 'normal';
}

export interface EconomyProductionModifier {
  realmId: number;
  state: number;
  phase: 'recession' | 'normal' | 'boom';
  value: number;
  kind: 'bonus' | 'malus' | 'neutral';
  seed: number;
  source: 'cycle';
}

const ECONOMY_MODIFIER_RANGES: Record<number, readonly [number, number]> = {
  0: [-0.12, 0.06],
  1: [-0.06, 0.06],
  2: [-0.03, 0.12]
};

function economyModifierSeed(realmId: number, state: number, periodStart: string): number {
  let hash = 2166136261;
  const key = `${realmId}:${state}:${periodStart}`;
  for (const character of key) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function computeEconomyProductionModifier(
  realmId: number,
  state: number,
  periodStart: string
): EconomyProductionModifier {
  const seed = economyModifierSeed(realmId, state, periodStart);
  const range = ECONOMY_MODIFIER_RANGES[state] ?? ECONOMY_MODIFIER_RANGES[1];
  const normalized = seed / 0xffffffff;
  const value = Math.round((range[0] + (range[1] - range[0]) * normalized) * 100) / 100;
  return {
    realmId,
    state,
    phase: phaseName(state),
    value,
    seed,
    source: 'cycle'
  };
}

export function getEconomyPhase(realmId: number = 0): EconomyPhaseStatus {
  let row = schedulerStateRepository.getEconomyPhase(realmId);
  if (!row) {
    const now = virtualClock.now();
    setEconomyPhase(realmId, 1, now, 'bootstrap');
    row = schedulerStateRepository.getEconomyPhase(realmId);
  }
  const now = virtualClock.now();
  const startAt = row?.startAt ?? row?.updatedAt ?? now.toISOString();
  const endAt = row?.endAt ?? nextEconomyBoundary(new Date(startAt)).toISOString();
  const state = row?.state ?? 1;
  const modifier = row?.source === 'bootstrap' && row.modifierSeed === 0
    ? { value: 0, kind: 'neutral' as const, seed: 0 }
    : row && row.modifierSeed !== 0
      ? { value: row.productionModifier, kind: row.modifierKind, seed: row.modifierSeed }
      : computeEconomyProductionModifier(realmId, state, startAt);
  return {
    realmId,
    state,
    phase: phaseName(state),
    stateName: ECONOMY_STATE_NAMES[state] ?? 'Normal',
    status: 'active',
    startAt,
    endAt,
    updatedAt: row?.updatedAt ?? null,
    source: row?.source ?? 'bootstrap',
    productionModifier: modifier.value,
    productionBonus: modifier.kind === 'bonus' ? modifier.value : 0,
    productionMalus: modifier.kind === 'malus' ? Math.abs(modifier.value) : 0,
    modifierKind: modifier.kind,
    modifierSeed: modifier.seed
  };
}

export function getEconomyPhaseHistory(
  realmId: number = 0,
  limit = 100,
  offset = 0
): EconomyPhaseHistoryEntry[] {
  const now = virtualClock.nowMs();
  return schedulerStateRepository.getEconomyPhaseHistory(realmId, limit, offset).map(row => {
    const endTime = row.endAt ? Date.parse(row.endAt) : now;
    const startTime = Date.parse(row.startAt);
    const modifier = row.modifierSeed !== 0
      ? { value: row.productionModifier, kind: row.modifierKind, seed: row.modifierSeed }
      : computeEconomyProductionModifier(realmId, row.phase, row.startAt);
    return {
      id: row.id,
      realmId: row.realmId,
      state: row.phase,
      phase: phaseName(row.phase),
      stateName: ECONOMY_STATE_NAMES[row.phase] ?? 'Normal',
      status: row.endAt ? 'ended' : 'active',
      startAt: row.startAt,
      endAt: row.endAt,
      source: row.source,
      generatedAt: row.generatedAt,
      durationDays: Number.isFinite(startTime) && Number.isFinite(endTime)
        ? Math.max(0, (endTime - startTime) / DAY_MS)
        : 0,
      productionModifier: modifier.value,
      productionBonus: modifier.kind === 'bonus' ? modifier.value : 0,
      productionMalus: modifier.kind === 'malus' ? Math.abs(modifier.value) : 0,
      modifierKind: modifier.kind,
      modifierSeed: modifier.seed
    };
  });
}

export function getEconomyPhaseStatistics(realmId: number = 0): {
  realmId: number;
  totalDays: number;
  phases: Record<'recession' | 'normal' | 'boom', { days: number; percentage: number; cycles: number }>;
} {
  const history = getEconomyPhaseHistory(realmId, 500, 0);
  const totals = {
    recession: { days: 0, percentage: 0, cycles: 0 },
    normal: { days: 0, percentage: 0, cycles: 0 },
    boom: { days: 0, percentage: 0, cycles: 0 }
  };
  for (const entry of history) {
    totals[entry.phase].days += entry.durationDays;
    totals[entry.phase].cycles += 1;
  }
  const totalDays = Object.values(totals).reduce((sum, value) => sum + value.days, 0);
  for (const value of Object.values(totals)) {
    value.percentage = totalDays > 0 ? value.days / totalDays : 0;
  }
  return { realmId, totalDays, phases: totals };
}

export function setEconomyPhase(
  realmId: number,
  state: number,
  updatedAt: Date = virtualClock.now(),
  source = 'scheduler',
  forceBoundary = false
): void {
  const periodStart = updatedAt.toISOString();
  const modifier = source === 'bootstrap'
    ? { value: 0, kind: 'neutral' as const, seed: 0 }
    : computeEconomyProductionModifier(realmId, state, periodStart);
  schedulerStateRepository.upsertEconomyPhase(
    realmId,
    state,
    periodStart,
    source,
    forceBoundary,
    modifier.value,
    modifier.kind,
    modifier.seed
  );
}

export function rollEconomyPhase(occurrence: Date, realmId?: number): void {
  const realms = realmId === undefined
    ? schedulerStateRepository.listEconomyRealms()
    : [realmId];
  const targetRealms = realms.length > 0 ? realms : [0];
  for (const targetRealmId of targetRealms) {
    const row = schedulerStateRepository.getEconomyPhase(targetRealmId);
    const cycleStart = row?.startAt
      ? new Date(row.startAt)
      : new Date(occurrence.getTime() - 7 * DAY_MS);
    const current = row?.state ?? 1;
    const table = ECONOMY_TRANSITIONS[current] ?? ECONOMY_TRANSITIONS[1];
    let roll = Math.random();
    let next = table[table.length - 1][0];
    for (const [state, probability] of table) {
      if (roll < probability) {
        next = state;
        break;
      }
      roll -= probability;
    }
    setEconomyPhase(targetRealmId, next, occurrence, 'scheduler', true);
    grantCycleCertificates(targetRealmId, cycleStart, occurrence);
  }
}

// --- 23:30 UTC: retail saturation recalculation ---

/** Same LCG family as encyclopedia.ts seededRandom so saturation values stay consistent. */
export function seededRandom(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s === 0) s = 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Deterministic per (resource kind, UTC date): stable across restarts, changes daily. */
export function computeDailySaturation(kind: number, dateKey: string): number {
  const dayNumber = Number(dateKey.replaceAll('-', '')) || 0;
  const rng = seededRandom(kind * 100000 + dayNumber);
  return round2(0.35 + rng() * 0.4);
}

/** Persisted daily saturation; falls back to the deterministic computation when absent. */
export function getRetailSaturation(dateKey: string, kind: number): number {
  const persisted = schedulerStateRepository.getRetailSaturation(dateKey, kind);
  return persisted ?? computeDailySaturation(kind, dateKey);
}

export function recalculateRetailSaturation(occurrence: Date): void {
  const dateKey = occurrence.toISOString().slice(0, 10);
  const occIso = occurrence.toISOString();
  for (const [kindStr, def] of Object.entries(getAllResourceDefs())) {
    if (!(Number(def.unitsSoldAnHour) > 0)) continue;
    const kind = Number(kindStr);
    const saturation = computeDailySaturation(kind, dateKey);
    schedulerStateRepository.upsertRetailSaturation(dateKey, kind, saturation, occIso);
  }
}

