// UTC recurrence and bounded catch-up policy are pure, independent of persistence (#104).
export interface DailySchedule {
  hourUtc: number;
  minuteUtc: number;
  daysOfWeek?: readonly number[];
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

function utcDayStartMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function scheduledMsOnDay(task: DailySchedule, dayStartMs: number): number {
  return dayStartMs + task.hourUtc * 3600000 + task.minuteUtc * 60000;
}

/** Most recent scheduled occurrence of `task` at or before `now` (UTC). */
export function latestOccurrence(task: DailySchedule, now: Date): Date | null {
  for (let back = 0; back < 8; back++) {
    const dayStartMs = utcDayStartMs(now) - back * DAY_MS;
    if (task.daysOfWeek && !task.daysOfWeek.includes(new Date(dayStartMs).getUTCDay())) continue;
    const occMs = scheduledMsOnDay(task, dayStartMs);
    if (occMs <= now.getTime()) return new Date(occMs);
  }
  return null;
}

/** Next scheduled occurrence of `task` strictly after `now` (UTC). */
export function nextOccurrence(task: DailySchedule, now: Date): Date | null {
  for (let ahead = 0; ahead < 8; ahead++) {
    const dayStartMs = utcDayStartMs(now) + ahead * DAY_MS;
    if (task.daysOfWeek && !task.daysOfWeek.includes(new Date(dayStartMs).getUTCDay())) continue;
    const occMs = scheduledMsOnDay(task, dayStartMs);
    if (occMs > now.getTime()) return new Date(occMs);
  }
  return null;
}

export function scheduledOccurrencesAfter(
  task: DailySchedule,
  now: Date,
  state: SchedulerTaskState | null
): Date[] {
  const latest = latestOccurrence(task, now);
  if (!latest) return [];
  if (!state?.lastScheduledForUtc) return [latest];

  const markerMs = new Date(state.lastScheduledForUtc).getTime();
  const retryingFailure = state.lastStatus === 'error';
  const lookbackStart = now.getTime() - 8 * DAY_MS;
  const firstAllowedMs = retryingFailure
    ? markerMs
    : Math.max(markerMs + 1, lookbackStart);
  const firstDayMs = utcDayStartMs(new Date(firstAllowedMs));
  const lastDayMs = utcDayStartMs(now);
  const occurrences: Date[] = [];

  for (let dayMs = firstDayMs; dayMs <= lastDayMs; dayMs += DAY_MS) {
    if (task.daysOfWeek && !task.daysOfWeek.includes(new Date(dayMs).getUTCDay())) continue;
    const occurrenceMs = scheduledMsOnDay(task, dayMs);
    if (occurrenceMs >= firstAllowedMs && occurrenceMs <= now.getTime()) {
      occurrences.push(new Date(occurrenceMs));
    }
  }
  return occurrences;
}
