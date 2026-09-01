/**
 * Issue #98 — Scheduler observability + ops endpoints (admin only).
 *
 * GET  /api/v2/scheduler/state/  full timetable state for observability
 * POST /api/v2/scheduler/tick/   run due tasks now, optionally against a
 *                                simulated clock: { now?: ISO string, tasks?: string[] }
 *
 * Both require an authenticated admin player (players.is_admin = 1).
 * Registered on the globalRouteRegistry (strangler fig dispatch in router.ts),
 * so no router.ts edits are needed — importing this module is enough.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../db/database.ts';
import { sendJson } from '../routes/utils.ts';
import { globalRouteRegistry } from '../http/route-registry.ts';
import {
  buildSchedulerStatePayload,
  getSchedulerTaskState,
  isSchedulerRunning,
  runDueSchedulerTasks,
  SCHEDULER_TICK_INTERVAL_MS,
  SCHEDULED_TASKS,
  startScheduler
} from './timetable.ts';

function isAdminPlayer(playerId: number | null | undefined): boolean {
  if (!playerId) return false;
  const row = db.prepare('SELECT is_admin FROM players WHERE player_id = ?').get(playerId) as {
    is_admin?: number;
  } | undefined;
  return Boolean(row && row.is_admin === 1);
}

function requireAdmin(res: ServerResponse, playerId: number | null | undefined): boolean {
  if (!isAdminPlayer(playerId)) {
    sendJson(res, { error: 'Forbidden' }, 403);
    return false;
  }
  return true;
}

globalRouteRegistry.register({
  method: 'GET',
  pattern: '/api/v2/scheduler/state/',
  auth: 'player',
  handler: async (_req: IncomingMessage, res: ServerResponse, ctx) => {
    if (!requireAdmin(res, ctx?.playerId)) return;
    sendJson(res, buildSchedulerStatePayload());
  }
});

interface SchedulerTickBody {
  now?: string;
  tasks?: string[];
  start?: boolean;
}

globalRouteRegistry.register({
  method: 'POST',
  pattern: '/api/v2/scheduler/tick/',
  auth: 'player',
  handler: async (_req: IncomingMessage, res: ServerResponse, ctx, _params, body) => {
    if (!requireAdmin(res, ctx?.playerId)) return;
    const payload = (body ?? {}) as SchedulerTickBody;

    let now = new Date();
    if (payload.now !== undefined) {
      const parsed = new Date(payload.now);
      if (Number.isNaN(parsed.getTime())) {
        sendJson(res, { error: 'Invalid "now" timestamp (expected ISO 8601)' }, 400);
        return;
      }
      now = parsed;
    }

    if (payload.tasks !== undefined && !Array.isArray(payload.tasks)) {
      sendJson(res, { error: '"tasks" must be an array of task names' }, 400);
      return;
    }
    const known = new Set(SCHEDULED_TASKS.map(task => task.name));
    for (const name of payload.tasks ?? []) {
      if (!known.has(name)) {
        sendJson(res, { error: `Unknown scheduler task: ${name}`, knownTasks: [...known] }, 400);
        return;
      }
    }

    // Ops convenience: allow the heartbeat to be armed from the tick endpoint
    // (e.g. when a host runs the API without booting index.ts directly).
    if (payload.start && !isSchedulerRunning()) {
      startScheduler();
    }

    const report = await runDueSchedulerTasks(now, payload.tasks);
    sendJson(res, {
      report,
      state: buildSchedulerStatePayload(now),
      running: isSchedulerRunning(),
      intervalMs: SCHEDULER_TICK_INTERVAL_MS,
      taskState: payload.tasks
        ? Object.fromEntries(payload.tasks.map(name => [name, getSchedulerTaskState(name)]))
        : undefined
    });
  }
});
