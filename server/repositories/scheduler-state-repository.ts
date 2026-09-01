/**
 * Scheduler state repository (Issue #105 hardening).
 * Owns the economy_state and retail_saturation projection tables the
 * scheduler rolls daily. Pure persistence — transition tables and saturation
 * math stay in the application layer.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface EconomyPhaseRow {
  state: number;
  updatedAt: string | null;
}

export class SchedulerStateRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  getEconomyPhase(realmId: number): EconomyPhaseRow | undefined {
    const row = this.database
      .prepare('SELECT state, updated_at FROM economy_state WHERE realm_id = ?')
      .get(realmId) as { state: number; updated_at: string } | undefined;
    return row ? { state: Number(row.state), updatedAt: row.updated_at } : undefined;
  }

  upsertEconomyPhase(realmId: number, state: number, updatedAtIso: string): void {
    this.database
      .prepare(
        `INSERT INTO economy_state (realm_id, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(realm_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
      )
      .run(realmId, state, updatedAtIso);
  }

  getRetailSaturation(dateKey: string, kind: number): number | undefined {
    const row = this.database
      .prepare('SELECT saturation FROM retail_saturation WHERE date = ? AND kind = ?')
      .get(dateKey, kind) as { saturation: number } | undefined;
    return row ? Number(row.saturation) : undefined;
  }

  upsertRetailSaturation(dateKey: string, kind: number, saturation: number, updatedAtIso: string): void {
    this.database
      .prepare(
        `INSERT INTO retail_saturation (date, kind, saturation, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(date, kind) DO UPDATE SET saturation = excluded.saturation, updated_at = excluded.updated_at`
      )
      .run(dateKey, kind, saturation, updatedAtIso);
  }
}

export const schedulerStateRepository = new SchedulerStateRepository();
