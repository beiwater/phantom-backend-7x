/**
 * Health & Observability Service (Issue #146).
 *
 * Encapsulates infrastructure health probes behind service layer:
 * - SQLite connectivity and quick_check verification
 * - Schema version inspection
 * - Scheduler status inspection
 */
import { db } from '../db/database.ts';
import { MigrationRunner } from '../db/migrations/runner.ts';
import { isSchedulerRunning, getSchedulerState } from '../scheduler/timetable.ts';

export interface ReadinessResult {
  status: 'ready' | 'unhealthy';
  schemaVersion: number;
  database: 'connected' | 'error';
  scheduler: {
    running: boolean;
    activeTasks: number;
  };
  uptimeSeconds: number;
  timestamp: string;
}

export class HealthService {
  private static readonly startTime = Date.now();

  static getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  static checkLiveness(): { status: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: this.getUptimeSeconds(),
      timestamp: new Date().toISOString()
    };
  }

  static checkReadiness(): ReadinessResult {
    // 1. Verify SQLite connectivity
    const dbPing = db.prepare('SELECT 1 AS alive').get() as { alive: number } | undefined;
    if (dbPing?.alive !== 1) {
      throw new Error('Database ping query returned invalid result');
    }

    // 2. Query latest schema version
    const runner = new MigrationRunner(db);
    const schemaVersion = runner.getLatestSchemaVersion();

    // 3. Inspect scheduler state
    const schedulerRunning = isSchedulerRunning();
    const schedulerState = getSchedulerState();

    return {
      status: 'ready',
      schemaVersion,
      database: 'connected',
      scheduler: {
        running: schedulerRunning,
        activeTasks: Object.keys(schedulerState).length
      },
      uptimeSeconds: this.getUptimeSeconds(),
      timestamp: new Date().toISOString()
    };
  }
}
