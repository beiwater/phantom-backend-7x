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
  startAt: string | null;
  endAt: string | null;
  source: string;
  productionModifier: number;
  modifierKind: 'bonus' | 'malus' | 'neutral';
  modifierSeed: number;
}

export interface EconomyPhaseHistoryRow {
  id: number;
  realmId: number;
  phase: number;
  startAt: string;
  endAt: string | null;
  source: string;
  productionModifier: number;
  modifierKind: 'bonus' | 'malus' | 'neutral';
  modifierSeed: number;
  generatedAt: string;
}
export class SchedulerStateRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  getEconomyPhase(realmId: number): EconomyPhaseRow | undefined {
    const row = this.database
      .prepare(`
        SELECT e.state, e.updated_at, e.phase_started_at, e.phase_ends_at, e.source,
               h.production_modifier, h.modifier_kind, h.modifier_seed
        FROM economy_state e
        LEFT JOIN economy_phase_history h
          ON h.realm_id = e.realm_id AND h.end_at IS NULL
        WHERE e.realm_id = ?
      `)
      .get(realmId) as {
        state: number;
        updated_at: string | null;
        phase_started_at: string | null;
        phase_ends_at: string | null;
        source: string | null;
        production_modifier: number | null;
        modifier_kind: 'bonus' | 'malus' | 'neutral' | null;
        modifier_seed: number | null;
      } | undefined;
    if (!row) return undefined;
    return {
      state: Number(row.state),
      updatedAt: row.updated_at,
      startAt: row.phase_started_at,
      endAt: row.phase_ends_at,
      source: row.source || 'scheduler',
      productionModifier: Number(row.production_modifier ?? 0),
      modifierKind: row.modifier_kind || 'neutral',
      modifierSeed: Number(row.modifier_seed ?? 0)
    };
  }

  getEconomyPhaseHistory(realmId: number, limit = 100, offset = 0): EconomyPhaseHistoryRow[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const boundedOffset = Math.max(0, Math.floor(offset));
    const rows = this.database.prepare(`
      SELECT id, realm_id, phase, start_at, end_at, source,
             production_modifier, modifier_kind, modifier_seed, generated_at
      FROM economy_phase_history
      WHERE realm_id = ?
      ORDER BY start_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(realmId, boundedLimit, boundedOffset) as Array<{
      id: number;
      realm_id: number;
      phase: number;
      start_at: string;
      end_at: string | null;
      source: string;
      production_modifier: number;
      modifier_kind: 'bonus' | 'malus' | 'neutral';
      modifier_seed: number;
      generated_at: string;
    }>;
    return rows.map(row => ({
      id: Number(row.id),
      realmId: Number(row.realm_id),
      phase: Number(row.phase),
      startAt: row.start_at,
      endAt: row.end_at,
      source: row.source,
      productionModifier: Number(row.production_modifier),
      modifierKind: row.modifier_kind,
      modifierSeed: Number(row.modifier_seed),
      generatedAt: row.generated_at
    }));
  }

  countEconomyPhaseHistory(realmId: number): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM economy_phase_history WHERE realm_id = ?')
      .get(realmId) as { count: number };
    return Number(row.count);
  }

  listEconomyRealms(): number[] {
    const rows = this.database.prepare(`
      SELECT realm_id FROM economy_state
      UNION
      SELECT DISTINCT realm_id FROM companies WHERE realm_id IS NOT NULL
      ORDER BY realm_id
    `).all() as Array<{ realm_id: number }>;
    return rows.map(row => Number(row.realm_id));
  }

  upsertEconomyPhase(
    realmId: number,
    state: number,
    updatedAtIso: string,
    source = 'scheduler',
    forceBoundary = false,
    productionModifier = 0,
    modifierKind: 'bonus' | 'malus' | 'neutral' = 'neutral',
    modifierSeed = 0
  ): void {
    if (![0, 1, 2].includes(state)) {
      throw new Error(`Invalid economy phase: ${state}`);
    }
    const current = this.database.prepare(`
      SELECT id, phase, start_at
      FROM economy_phase_history
      WHERE realm_id = ? AND end_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `).get(realmId) as { id: number; phase: number; start_at: string } | undefined;
    if (current && updatedAtIso <= current.start_at) return;

    const startsNewInterval = !current || forceBoundary || Number(current.phase) !== state;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (current && startsNewInterval) {
        this.database.prepare(
          'UPDATE economy_phase_history SET end_at = ? WHERE id = ? AND end_at IS NULL'
        ).run(updatedAtIso, current.id);
      }
      if (startsNewInterval) {
        this.database.prepare(`
          INSERT OR IGNORE INTO economy_phase_history
            (realm_id, phase, start_at, end_at, source, production_modifier, modifier_kind, modifier_seed, generated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
        `).run(
          realmId,
          state,
          updatedAtIso,
          source,
          productionModifier,
          modifierKind,
          modifierSeed,
          updatedAtIso
        );
      }
      this.database.prepare(`
        INSERT INTO economy_state
          (realm_id, state, updated_at, phase_started_at, phase_ends_at, source)
        VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(realm_id) DO UPDATE SET
          state = excluded.state,
          updated_at = excluded.updated_at,
          phase_started_at = CASE
            WHEN ? THEN excluded.phase_started_at
            ELSE economy_state.phase_started_at
          END,
          phase_ends_at = NULL,
          source = excluded.source
      `).run(realmId, state, updatedAtIso, updatedAtIso, source, startsNewInterval ? 1 : 0);
      this.database.exec('COMMIT');
    } catch (err) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original transition error.
      }
      throw err;
    }
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
