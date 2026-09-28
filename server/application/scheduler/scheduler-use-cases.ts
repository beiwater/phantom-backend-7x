import { runInTransaction } from '../../db/transaction.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { schedulerStateRepository } from '../../repositories/scheduler-state-repository.ts';
import { latestOccurrence, nextOccurrence, scheduledOccurrencesAfter, SCHEDULER_TICK_INTERVAL_MS } from '../../domain/scheduler/schedule.ts';
import type { SchedulerRunReport, SchedulerTaskState } from '../../domain/scheduler/schedule.ts';
import { SCHEDULED_TASKS } from './scheduled-tasks.ts';
import { getEconomyPhase } from './daily-jobs.ts';

export function getSchedulerTaskState(taskName: string): SchedulerTaskState | null {
  return schedulerStateRepository.getTaskState(taskName);
}

export function getSchedulerState(): SchedulerTaskState[] {
  return schedulerStateRepository.listTaskStates();
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
let schedulerRunQueue: Promise<void> = Promise.resolve();

export function runDueSchedulerTasks(
  now: Date = virtualClock.now(),
  taskNames?: readonly string[]
): Promise<SchedulerRunReport> {
  const run = schedulerRunQueue.then(() => runDueSchedulerTasksInner(now, taskNames));
  schedulerRunQueue = run.then(() => undefined, () => undefined);
  return run;
}


async function runDueSchedulerTasksInner(
  now: Date,
  taskNames?: readonly string[]
): Promise<SchedulerRunReport> {
  const report: SchedulerRunReport = { ranAt: virtualClock.nowIso(), results: [] };
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
    const latest = latestOccurrence(task, now);
    if (!latest) {
      report.results.push({ task: task.name, occurrence: null, outcome: 'skipped-not-due' });
      continue;
    }
    const state = getSchedulerTaskState(task.name);
    const occurrences = scheduledOccurrencesAfter(task, now, state);
    if (occurrences.length === 0) {
      const latestIso = latest.toISOString();
      const alreadyRun = state?.lastStatus !== 'error'
        && Boolean(state?.lastScheduledForUtc && state.lastScheduledForUtc >= latestIso);
      report.results.push({
        task: task.name,
        occurrence: latestIso,
        outcome: alreadyRun ? 'skipped-already-run' : 'skipped-not-due'
      });
      continue;
    }

    for (const occurrence of occurrences) {
      const occurrenceIso = occurrence.toISOString();
      try {
        if (task.transactional === false) {
          await task.run(occurrence);
          await runInTransaction(() => schedulerStateRepository.markTaskRan(task.name, virtualClock.now(), occurrenceIso, 'ok', null));
        } else {
          await runInTransaction(async () => {
            await task.run(occurrence);
            schedulerStateRepository.markTaskRan(task.name, virtualClock.now(), occurrenceIso, 'ok', null);
          });
        }
        report.results.push({ task: task.name, occurrence: occurrenceIso, outcome: 'ran' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Persist the failed occurrence and retry it before any later one.
        await runInTransaction(() => schedulerStateRepository.markTaskRan(task.name, virtualClock.now(), occurrenceIso, 'error', message));
        report.results.push({ task: task.name, occurrence: occurrenceIso, outcome: 'error', error: message });
        break;
      }
    }
  }
  return report;
}

export function buildSchedulerStatePayload(now: Date, running: boolean) {
  const states: Record<string, SchedulerTaskState> = {};
  for (const state of getSchedulerState()) states[state.taskName] = state;
  return {
    running,
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
    retailSaturationDate: schedulerStateRepository.latestRetailSaturationDate()
  };
}
