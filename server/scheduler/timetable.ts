// Public scheduler lifecycle. Calendar policy, durable execution and SQL have separate owners (#104).
import { virtualClock } from '../core/virtual-clock.ts';
import { SCHEDULER_TICK_INTERVAL_MS } from '../domain/scheduler/schedule.ts';
import { runDueSchedulerTasks, buildSchedulerStatePayload as buildState } from '../application/scheduler/scheduler-use-cases.ts';

export { latestOccurrence, nextOccurrence, SCHEDULER_TICK_INTERVAL_MS } from '../domain/scheduler/schedule.ts';
export type { SchedulerTaskState, SchedulerRunOutcome, SchedulerRunResult, SchedulerRunReport } from '../domain/scheduler/schedule.ts';
export * from '../application/scheduler/scheduled-tasks.ts';
export { getSchedulerTaskState, getSchedulerState, runDueSchedulerTasks } from '../application/scheduler/scheduler-use-cases.ts';

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;

export function isSchedulerRunning(): boolean {
  return schedulerRunning;
}

/**
 * Start the timetable heartbeat. Fires the boot catch-up immediately: any task
 * whose scheduled time passed while the server was down and which has not run
 * for that occurrence runs exactly once, then the interval keeps scheduling.
 */
export function startScheduler(intervalMs: number = SCHEDULER_TICK_INTERVAL_MS): NodeJS.Timeout {
  if (schedulerTimer) return schedulerTimer;
  schedulerRunning = true;
  runDueSchedulerTasks().catch(err => {
    console.error('[scheduler] boot catch-up failed:', err);
  });
  schedulerTimer = setInterval(() => {
    runDueSchedulerTasks().catch(err => {
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

export function buildSchedulerStatePayload(now: Date = virtualClock.now()) {
  return buildState(now, schedulerRunning);
}
