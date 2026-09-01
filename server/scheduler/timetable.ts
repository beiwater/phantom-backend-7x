/**
 * Issue #98 — Daily UTC timetable engine ("time table" decompiled spec).
 *
 * Timetable (all times UTC):
 *   00:00  Bond interest deduction + accounting overhead charge per company
 *   04:00  Executive daily salary debit (cash ledger category 'e')
 *   13:00  Wednesday: Government Orders publication
 *          Monday: Government Orders award fulfillment (lowest bid wins)
 *   15:00  Friday: economy phase roll (Recession 0 / Normal 1 / Boom 2)
 *   23:30  Daily retail market saturation recalculation
 *
 * Reliability contract:
 *   - `scheduler_state` persists per task: last_run_utc (wall clock of the run),
 *     last_scheduled_for_utc (the scheduled occurrence the run was for), status
 *     and error. Restarts therefore never re-fire an already-run occurrence.
 *   - On boot and on every tick, a task whose scheduled time has passed and
 *     which has not yet fired for that occurrence runs exactly once (catch-up),
 *     then the interval schedules the next occurrence.
 *   - GET /api/v2/scheduler/state/ (admin) exposes the full state; see
 *     scheduler-routes.ts. POST /api/v2/scheduler/tick/ (admin) runs due tasks
 *     against an optional simulated `now` (ops/testing hook).
 */
import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { getCompanyById, updateCompanyMoney } from '../game/company.ts';
import { recordCashLedger } from '../game/cash-ledger.ts';
import { ensureSeededProjects } from '../game/government.ts';
import { getAllResourceDefs } from '../game-data/resources.ts';

// --- Persisted world-state tables (module-level, same pattern as government.ts) ---

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduler_state (
    task_name TEXT PRIMARY KEY,
    last_run_utc TEXT,
    last_scheduled_for_utc TEXT,
    last_status TEXT NOT NULL DEFAULT 'ok',
    last_error TEXT,
    runs INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS economy_state (
    realm_id INTEGER PRIMARY KEY,
    state INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS retail_saturation (
    date TEXT NOT NULL,
    kind INTEGER NOT NULL,
    saturation REAL NOT NULL,
    updated_at TEXT,
    PRIMARY KEY (date, kind)
  );
`);

// --- Timetable engine types ---

export interface SchedulerTaskDefinition {
  name: string;
  description: string;
  hourUtc: number;
  minuteUtc: number;
  /** 0=Sunday … 6=Saturday. Omit for tasks that run every day. */
  daysOfWeek?: readonly number[];
  run(occurrence: Date): void;
}

export interface SchedulerTaskState {
  taskName: string;
  lastRunUtc: string | null;
  lastScheduledForUtc: string | null;
  lastStatus: string;
  lastError: string | null;
  runs: number;
  updatedAt: string | null;
}

export type SchedulerRunOutcome =
  | 'ran'
  | 'skipped-already-run'
  | 'skipped-not-due'
  | 'error'
  | 'skipped-unknown-task';

export interface SchedulerRunResult {
  task: string;
  occurrence: string | null;
  outcome: SchedulerRunOutcome;
  error?: string;
}

export interface SchedulerRunReport {
  ranAt: string;
  results: SchedulerRunResult[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Issue #98: timetable engine heartbeat. */
export const SCHEDULER_TICK_INTERVAL_MS = 60 * 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function utcDayStartMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function scheduledMsOnDay(task: SchedulerTaskDefinition, dayStartMs: number): number {
  return dayStartMs + task.hourUtc * 3600000 + task.minuteUtc * 60000;
}

/** Most recent scheduled occurrence of `task` at or before `now` (UTC). */
export function latestOccurrence(task: SchedulerTaskDefinition, now: Date): Date | null {
  for (let back = 0; back < 8; back++) {
    const dayStartMs = utcDayStartMs(now) - back * DAY_MS;
    if (task.daysOfWeek && !task.daysOfWeek.includes(new Date(dayStartMs).getUTCDay())) continue;
    const occMs = scheduledMsOnDay(task, dayStartMs);
    if (occMs <= now.getTime()) return new Date(occMs);
  }
  return null;
}

/** Next scheduled occurrence of `task` strictly after `now` (UTC). */
export function nextOccurrence(task: SchedulerTaskDefinition, now: Date): Date | null {
  for (let ahead = 0; ahead < 8; ahead++) {
    const dayStartMs = utcDayStartMs(now) + ahead * DAY_MS;
    if (task.daysOfWeek && !task.daysOfWeek.includes(new Date(dayStartMs).getUTCDay())) continue;
    const occMs = scheduledMsOnDay(task, dayStartMs);
    if (occMs > now.getTime()) return new Date(occMs);
  }
  return null;
}

// --- scheduler_state persistence ---

export function getSchedulerTaskState(taskName: string): SchedulerTaskState | null {
  const row = db.prepare(`
    SELECT task_name, last_run_utc, last_scheduled_for_utc, last_status, last_error, runs, updated_at
    FROM scheduler_state WHERE task_name = ?
  `).get(taskName) as {
    task_name: string; last_run_utc: string | null; last_scheduled_for_utc: string | null;
    last_status: string; last_error: string | null; runs: number; updated_at: string | null;
  } | undefined;
  if (!row) return null;
  return {
    taskName: row.task_name,
    lastRunUtc: row.last_run_utc,
    lastScheduledForUtc: row.last_scheduled_for_utc,
    lastStatus: row.last_status,
    lastError: row.last_error,
    runs: Number(row.runs) || 0,
    updatedAt: row.updated_at
  };
}

export function getSchedulerState(): SchedulerTaskState[] {
  const rows = db.prepare(`
    SELECT task_name, last_run_utc, last_scheduled_for_utc, last_status, last_error, runs, updated_at
    FROM scheduler_state ORDER BY task_name
  `).all() as Array<{
    task_name: string; last_run_utc: string | null; last_scheduled_for_utc: string | null;
    last_status: string; last_error: string | null; runs: number; updated_at: string | null;
  }>;
  return rows.map(row => ({
    taskName: row.task_name,
    lastRunUtc: row.last_run_utc,
    lastScheduledForUtc: row.last_scheduled_for_utc,
    lastStatus: row.last_status,
    lastError: row.last_error,
    runs: Number(row.runs) || 0,
    updatedAt: row.updated_at
  }));
}

function markTaskRan(
  taskName: string,
  ranAt: Date,
  occurrenceIso: string,
  status: 'ok' | 'error',
  error: string | null
): void {
  db.prepare(`
    INSERT INTO scheduler_state (task_name, last_run_utc, last_scheduled_for_utc, last_status, last_error, runs, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(task_name) DO UPDATE SET
      last_run_utc = excluded.last_run_utc,
      last_scheduled_for_utc = excluded.last_scheduled_for_utc,
      last_status = excluded.last_status,
      last_error = excluded.last_error,
      runs = runs + 1,
      updated_at = excluded.updated_at
  `).run(taskName, ranAt.toISOString(), occurrenceIso, status, error, ranAt.toISOString());
}

// --- Scheduled task implementations (00:00 UTC: bond interest + accounting overhead) ---

/**
 * Daily bond interest. Only bonds actually held by a buyer accrue interest
 * (open offers do not). Player-issued bonds deduct the interest from the
 * issuer; an issuer who cannot cover it defaults and the holder receives
 * whatever could still be paid (decompile formulas_bonds.md §7). System-seeded
 * bonds (issuer 999900, no company row) pay the yield to the holder directly.
 */
function chargeDailyBondInterest(): void {
  const bonds = db.prepare(`
    SELECT id, seller_company_id, buyer_company_id, amount, interest_rate
    FROM bonds
    WHERE status = 'active' AND buyer_company_id IS NOT NULL
  `).all() as Array<{
    id: number; seller_company_id: number | null; buyer_company_id: number;
    amount: number; interest_rate: number;
  }>;

  for (const bond of bonds) {
    const interest = round2(Number(bond.amount) * Number(bond.interest_rate));
    if (!(interest > 0)) continue;

    const holderId = Number(bond.buyer_company_id);
    const holder = getCompanyById(holderId);
    if (!holder) continue;

    const issuerId = bond.seller_company_id === null ? null : Number(bond.seller_company_id);
    const issuer = issuerId !== null ? getCompanyById(issuerId) : null;

    if (issuer) {
      const funds = Number(issuer.money) || 0;
      const paid = round2(Math.max(0, Math.min(funds, interest)));
      if (paid > 0) {
        recordCashLedger({
          companyId: issuerId as number,
          amount: -paid,
          category: 'i',
          description: 'Bond interest payment',
          descriptionKey: 'bondInterestPayment',
          details: { bondId: bond.id }
        });
        updateCompanyMoney(issuerId as number, -paid, true);
        recordCashLedger({
          companyId: holderId,
          amount: paid,
          category: 'i',
          description: 'Bond interest collected',
          descriptionKey: 'bondInterestCollected',
          details: { bondId: bond.id }
        });
        updateCompanyMoney(holderId, paid, true);
      }
      if (paid < interest) {
        db.prepare(`UPDATE bonds SET status = 'defaulted' WHERE id = ?`).run(bond.id);
      }
    } else {
      recordCashLedger({
        companyId: holderId,
        amount: interest,
        category: 'i',
        description: 'Bond interest collected',
        descriptionKey: 'bondInterestCollected',
        details: { bondId: bond.id }
      });
      updateCompanyMoney(holderId, interest, true);
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
function chargeDailyAccountingOverhead(): void {
  const companies = db.prepare('SELECT company_id, money FROM companies').all() as Array<{
    company_id: number; money: number;
  }>;
  for (const comp of companies) {
    const companyId = Number(comp.company_id);
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buildings WHERE company_id = ?) AS building_count,
        (SELECT COALESCE(SUM(size), 0) FROM buildings WHERE company_id = ?) AS total_size,
        (SELECT COALESCE(MAX(COALESCE(skill_accounting, 0)), 0) FROM executives
           WHERE company_id = ? AND status = 'employed' AND position = 'coo') AS coo_skill
    `).get(companyId, companyId, companyId) as { building_count: number; total_size: number; coo_skill: number };

    const buildingCount = Number(stats.building_count) || 0;
    if (buildingCount === 0) continue;

    const ao = 1 + Math.max(0, buildingCount - 1) * 0.035;
    const cooSkill = Math.max(0, Math.min(100, Number(stats.coo_skill) || 0));
    const effective = ao - (ao - 1) * cooSkill / 100;
    const charge = round2((Number(stats.total_size) || 0) * 100 * (effective - 1));
    if (!(charge > 0)) continue;

    const funds = Number(comp.money) || 0;
    const paid = round2(Math.max(0, Math.min(funds, charge)));
    if (!(paid > 0)) continue;

    recordCashLedger({
      companyId,
      amount: -paid,
      category: 'a',
      description: 'Daily accounting overhead',
      descriptionKey: 'accountingOverhead'
    });
    updateCompanyMoney(companyId, -paid, true);
  }
}

// --- 04:00 UTC: executive salaries ---

/**
 * Daily executive salary debit (category 'e'). Companies that cannot cover the
 * full payroll pay what they have — the same "pay what you can" convention the
 * daily loan accrual already uses (loans.ts).
 */
function debitExecutiveSalaries(): void {
  const rows = db.prepare(`
    SELECT c.company_id AS company_id, c.money AS money,
           COALESCE((SELECT SUM(e.salary) FROM executives e
                     WHERE e.company_id = c.company_id AND e.status = 'employed'), 0) AS salaries
    FROM companies c
  `).all() as Array<{ company_id: number; money: number; salaries: number }>;

  for (const row of rows) {
    const total = round2(Number(row.salaries) || 0);
    if (!(total > 0)) continue;
    const companyId = Number(row.company_id);
    const funds = Number(row.money) || 0;
    const paid = round2(Math.max(0, Math.min(funds, total)));
    if (!(paid > 0)) continue;

    recordCashLedger({
      companyId,
      amount: -paid,
      category: 'e',
      description: 'Executive daily salaries',
      descriptionKey: 'executiveSalaries'
    });
    updateCompanyMoney(companyId, -paid, true);
  }
}

// --- 13:00 UTC Wednesday: Government Orders publication ---

/**
 * Weekly Government Orders publication: makes sure every realm has the standard
 * project pool and republishes any order whose bidding deadline already passed
 * with a fresh window starting at this occurrence.
 */
function publishGovernmentOrders(occurrence: Date): void {
  const realmRows = db.prepare('SELECT DISTINCT realm_id FROM government_orders').all() as Array<{ realm_id: number }>;
  const realms = realmRows.length > 0 ? realmRows.map(r => Number(r.realm_id)) : [0];
  for (const realmId of realms) {
    ensureSeededProjects(realmId);
  }

  const occIso = occurrence.toISOString();
  const stale = db.prepare(`
    SELECT id, days_to_fulfill FROM government_orders
    WHERE deadline IS NULL OR deadline < ?
  `).all(occIso) as Array<{ id: number; days_to_fulfill: number }>;
  for (const order of stale) {
    const days = Math.max(1, Number(order.days_to_fulfill) || 7);
    const deadline = new Date(occurrence.getTime() + days * DAY_MS).toISOString();
    db.prepare('UPDATE government_orders SET start_date = ?, deadline = ? WHERE id = ?')
      .run(occIso, deadline, order.id);
  }
}

// --- 13:00 UTC Monday: Government Orders award fulfillment ---

function bidTotalValue(
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
function awardGovernmentBids(occurrence: Date): void {
  const templates = db.prepare(`
    SELECT id, required_resources_json, unit_compensation_price
    FROM government_orders
    WHERE deadline IS NOT NULL AND deadline <= ? AND resource_multiplier_awarded IS NULL
  `).all(occurrence.toISOString()) as Array<{
    id: number; required_resources_json: string; unit_compensation_price: number;
  }>;

  for (const template of templates) {
    const openBids = db.prepare(`
      SELECT id, secret, price_breakdown_json FROM government_bids
      WHERE template_id = ? AND status = 'OPEN'
    `).all(template.id) as Array<{ id: number; secret: string; price_breakdown_json: string | null }>;
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
        db.prepare(`UPDATE government_bids SET status = 'AWARDED' WHERE id = ?`).run(bid.id);
        continue;
      }
      db.prepare(`UPDATE government_bids SET status = 'REJECTED' WHERE id = ?`).run(bid.id);
      const contractors = db.prepare(`
        SELECT company_id, deposit_paid FROM government_bid_contractors
        WHERE bid_secret = ? AND deposit_paid > 0
      `).all(bid.secret) as Array<{ company_id: number; deposit_paid: number }>;
      for (const contractor of contractors) {
        const companyId = Number(contractor.company_id);
        if (getCompanyById(companyId)) {
          updateCompanyMoney(companyId, Number(contractor.deposit_paid) || 0);
        }
        db.prepare('UPDATE government_bid_contractors SET deposit_paid = 0 WHERE bid_secret = ? AND company_id = ?')
          .run(bid.secret, contractor.company_id);
      }
    }

    const mainContractor = db.prepare(`
      SELECT tier_multiplier FROM government_bid_contractors
      WHERE bid_secret = ? AND is_main = 1
    `).get(winner.secret) as { tier_multiplier: number } | undefined;
    const multiplier = Number(mainContractor?.tier_multiplier) || 1;
    db.prepare('UPDATE government_orders SET resource_multiplier_awarded = ? WHERE id = ?')
      .run(multiplier, template.id);
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

export function getEconomyPhase(realmId: number = 0): {
  realmId: number; state: number; stateName: string; updatedAt: string | null;
} {
  const row = db.prepare('SELECT state, updated_at FROM economy_state WHERE realm_id = ?')
    .get(realmId) as { state: number; updated_at: string } | undefined;
  const state = row ? Number(row.state) : 1;
  return {
    realmId,
    state,
    stateName: ECONOMY_STATE_NAMES[state] ?? 'Normal',
    updatedAt: row?.updated_at ?? null
  };
}

export function setEconomyPhase(realmId: number, state: number, updatedAt: Date = new Date()): void {
  db.prepare(`
    INSERT INTO economy_state (realm_id, state, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(realm_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `).run(realmId, state, updatedAt.toISOString());
}

function rollEconomyPhase(occurrence: Date): void {
  const current = getEconomyPhase(0).state;
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
  setEconomyPhase(0, next, occurrence);
}

// --- 23:30 UTC: retail saturation recalculation ---

/** Same LCG family as encyclopedia.ts seededRandom so saturation values stay consistent. */
function seededRandom(seed: number): () => number {
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
  const row = db.prepare('SELECT saturation FROM retail_saturation WHERE date = ? AND kind = ?')
    .get(dateKey, kind) as { saturation: number } | undefined;
  return row ? Number(row.saturation) : computeDailySaturation(kind, dateKey);
}

function recalculateRetailSaturation(occurrence: Date): void {
  const dateKey = occurrence.toISOString().slice(0, 10);
  const occIso = occurrence.toISOString();
  for (const [kindStr, def] of Object.entries(getAllResourceDefs())) {
    if (!(Number(def.unitsSoldAnHour) > 0)) continue;
    const kind = Number(kindStr);
    const saturation = computeDailySaturation(kind, dateKey);
    db.prepare(`
      INSERT INTO retail_saturation (date, kind, saturation, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(date, kind) DO UPDATE SET saturation = excluded.saturation, updated_at = excluded.updated_at
    `).run(dateKey, kind, saturation, occIso);
  }
}

// --- Timetable definition ---

export const TASK_BOND_INTEREST_AND_OVERHEAD = 'bond_interest_and_admin_overhead';
export const TASK_EXECUTIVE_SALARIES = 'executive_salaries';
export const TASK_GOVERNMENT_ORDERS_PUBLISH = 'government_orders_publish';
export const TASK_GOVERNMENT_ORDERS_AWARD = 'government_orders_award';
export const TASK_ECONOMY_PHASE_ROLL = 'economy_phase_roll';
export const TASK_RETAIL_SATURATION_REFRESH = 'retail_saturation_refresh';

export const SCHEDULED_TASKS: readonly SchedulerTaskDefinition[] = [
  {
    name: TASK_BOND_INTEREST_AND_OVERHEAD,
    description: 'Bond interest deduction + accounting overhead charge per company',
    hourUtc: 0,
    minuteUtc: 0,
    run: () => {
      chargeDailyBondInterest();
      chargeDailyAccountingOverhead();
    }
  },
  {
    name: TASK_EXECUTIVE_SALARIES,
    description: 'Executive daily salary debit (cash ledger category e)',
    hourUtc: 4,
    minuteUtc: 0,
    run: () => debitExecutiveSalaries()
  },
  {
    name: TASK_GOVERNMENT_ORDERS_AWARD,
    description: 'Government Orders award fulfillment (lowest bid wins)',
    hourUtc: 13,
    minuteUtc: 0,
    daysOfWeek: [1],
    run: occurrence => awardGovernmentBids(occurrence)
  },
  {
    name: TASK_GOVERNMENT_ORDERS_PUBLISH,
    description: 'Government Orders weekly publication',
    hourUtc: 13,
    minuteUtc: 0,
    daysOfWeek: [3],
    run: occurrence => publishGovernmentOrders(occurrence)
  },
  {
    name: TASK_ECONOMY_PHASE_ROLL,
    description: 'Economy phase roll (Recession/Normal/Boom)',
    hourUtc: 15,
    minuteUtc: 0,
    daysOfWeek: [5],
    run: occurrence => rollEconomyPhase(occurrence)
  },
  {
    name: TASK_RETAIL_SATURATION_REFRESH,
    description: 'Daily retail market saturation recalculation',
    hourUtc: 23,
    minuteUtc: 30,
    run: occurrence => recalculateRetailSaturation(occurrence)
  }
];

// --- Engine ---

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;

export function isSchedulerRunning(): boolean {
  return schedulerRunning;
}

/**
 * Run every task whose latest scheduled occurrence is at or before `now` and
 * which has not yet fired for that occurrence. Each task runs atomically
 * together with its scheduler_state bookkeeping (Issue #68): either the domain
 * effects and the dedup marker commit together, or neither does.
 *
 * Serialized through a promise queue so the heartbeat interval and an admin
 * tick can never interleave two runs.
 */
let schedulerRunQueue: Promise<unknown> = Promise.resolve();

export function runDueSchedulerTasks(
  now: Date = new Date(),
  taskNames?: readonly string[]
): Promise<SchedulerRunReport> {
  return schedulerRunQueue.then(() => runDueSchedulerTasksInner(now, taskNames));
}


async function runDueSchedulerTasksInner(
  now: Date,
  taskNames?: readonly string[]
): Promise<SchedulerRunReport> {
  const report: SchedulerRunReport = { ranAt: now.toISOString(), results: [] };
  const selected = taskNames
    ? SCHEDULED_TASKS.filter(task => taskNames.includes(task.name))
    : SCHEDULED_TASKS;

  if (taskNames) {
    const known = new Set(SCHEDULED_TASKS.map(task => task.name));
    for (const name of taskNames) {
      if (!known.has(name)) {
        report.results.push({ task: name, occurrence: null, outcome: 'skipped-unknown-task' });
      }
    }
  }

  for (const task of selected) {
    const occurrence = latestOccurrence(task, now);
    if (!occurrence) {
      report.results.push({ task: task.name, occurrence: null, outcome: 'skipped-not-due' });
      continue;
    }
    const occurrenceIso = occurrence.toISOString();
    const state = getSchedulerTaskState(task.name);
    if (state?.lastScheduledForUtc && state.lastScheduledForUtc >= occurrenceIso) {
      report.results.push({ task: task.name, occurrence: occurrenceIso, outcome: 'skipped-already-run' });
      continue;
    }
    try {
      await runInTransaction(() => {
        task.run(occurrence);
        markTaskRan(task.name, now, occurrenceIso, 'ok', null);
      });
      report.results.push({ task: task.name, occurrence: occurrenceIso, outcome: 'ran' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Record the failure outside the rolled-back domain transaction so the
      // error is observable; the task will retry on the next tick.
      await runInTransaction(() => markTaskRan(task.name, now, occurrenceIso, 'error', message));
      report.results.push({ task: task.name, occurrence: occurrenceIso, outcome: 'error', error: message });
    }
  }
  return report;
}

/**
 * Start the timetable heartbeat. Fires the boot catch-up immediately: any task
 * whose scheduled time passed while the server was down and which has not run
 * for that occurrence runs exactly once, then the interval keeps scheduling.
 */
export function startScheduler(intervalMs: number = SCHEDULER_TICK_INTERVAL_MS): NodeJS.Timeout {
  if (schedulerTimer) return schedulerTimer;
  schedulerRunning = true;
  runDueSchedulerTasks(new Date()).catch(err => {
    console.error('[scheduler] boot catch-up failed:', err);
  });
  schedulerTimer = setInterval(() => {
    runDueSchedulerTasks(new Date()).catch(err => {
      console.error('[scheduler] tick failed:', err);
    });
  }, intervalMs);
  schedulerTimer.unref();
  return schedulerTimer;
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerRunning = false;
}

// --- Observability payload (GET /api/v2/scheduler/state/) ---

export function buildSchedulerStatePayload(now: Date = new Date()) {
  const states: Record<string, SchedulerTaskState> = {};
  for (const state of getSchedulerState()) states[state.taskName] = state;
  const saturationDate = db.prepare('SELECT MAX(date) AS latest FROM retail_saturation')
    .get() as { latest: string | null };
  return {
    running: isSchedulerRunning(),
    intervalMs: SCHEDULER_TICK_INTERVAL_MS,
    generatedAt: now.toISOString(),
    tasks: SCHEDULED_TASKS.map(task => {
      const state = states[task.name];
      return {
        name: task.name,
        description: task.description,
        hourUtc: task.hourUtc,
        minuteUtc: task.minuteUtc,
        daysOfWeek: task.daysOfWeek ? [...task.daysOfWeek] : null,
        nextOccurrenceUtc: nextOccurrence(task, now)?.toISOString() ?? null,
        lastRunUtc: state?.lastRunUtc ?? null,
        lastScheduledForUtc: state?.lastScheduledForUtc ?? null,
        lastStatus: state?.lastStatus ?? null,
        lastError: state?.lastError ?? null,
        runs: state?.runs ?? 0
      };
    }),
    economyPhase: getEconomyPhase(0),
    retailSaturationDate: saturationDate.latest ?? null
  };
}
