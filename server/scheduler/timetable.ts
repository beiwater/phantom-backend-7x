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
import {
  chargeDailyBondInterest,
  chargeDailyAccountingOverhead,
  debitExecutiveSalaries,
  publishGovernmentOrders,
  awardGovernmentBids,
  rollEconomyPhase,
  recalculateRetailSaturation,
  getEconomyPhase
} from '../application/scheduler/daily-jobs.ts';

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
