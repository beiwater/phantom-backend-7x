/**
 * Restaurant repository (Issue #105 hardening).
 * Owns restaurant_properties / restaurant_runs persistence plus the
 * executive-skill and restaurant-market reads the engine consumes.
 * Pure persistence + row mapping — no economy semantics, no money movement.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { virtualClock } from '../core/virtual-clock.ts';

export interface RestaurantPropertyRowEntity {
  buildingId: number;
  goodService: boolean;
  isLuxury: boolean;
  professionalStaff: boolean;
  keepOpen: boolean;
  menuJson: string;
  menuPrice: number;
  rating: number;
  occupancy: number;
  lastCycleAt: string | null;
  reconstructionStartedAt: string | null;
  reconstructionUntil: string | null;
}

export interface RestaurantUpsertEntity {
  buildingId: number;
  companyId: number;
  goodService: boolean;
  isLuxury: boolean;
  keepOpen: boolean;
  menuJson: string;
  menuPrice: number;
  rating: number;
  occupancy: number;
  professionalStaff: boolean;
  lastCycleAt: string | null;
  reconstructionStartedAt: string | null;
  reconstructionUntil: string | null;
  ratingPenaltyApplied: boolean;
}

export interface RestaurantMarketEntity {
  marketGuests: number;
  activeRestaurants: Array<{ id: number; size: number }>;
}

export class RestaurantRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findPropertyRow(buildingId: number, companyId?: number | null): RestaurantPropertyRowEntity | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM restaurant_properties
         WHERE building_id = ? AND (? IS NULL OR company_id = ?)`
      )
      .get(buildingId, companyId ?? null, companyId ?? null) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      buildingId: Number(row.building_id),
      goodService: Boolean(row.good_service),
      isLuxury: Boolean(row.is_luxury),
      professionalStaff: Boolean(row.professional_staff),
      keepOpen: Boolean(row.keep_open),
      menuJson: String(row.menu_json ?? '[]'),
      menuPrice: Number(row.menu_price),
      rating: Number(row.rating) || 0,
      occupancy: Number(row.occupancy) || 0,
      lastCycleAt: (row.last_cycle_at as string | null) || null,
      reconstructionStartedAt: (row.reconstruction_started_at as string | null) || null,
      reconstructionUntil: (row.reconstruction_until as string | null) || null
    };
  }

  findReconstructionWindow(buildingId: number): { startedAt: string | null; until: string | null } | undefined {
    const row = this.database
      .prepare('SELECT reconstruction_started_at, reconstruction_until FROM restaurant_properties WHERE building_id = ?')
      .get(buildingId) as { reconstruction_started_at: string | null; reconstruction_until: string | null } | undefined;
    return row
      ? { startedAt: row.reconstruction_started_at || null, until: row.reconstruction_until || null }
      : undefined;
  }

  upsertProperties(entity: RestaurantUpsertEntity): void {
    this.database
      .prepare(
        `INSERT INTO restaurant_properties (
          building_id, company_id, good_service, is_luxury, keep_open, menu_json, menu_price, rating, occupancy,
          updated_at, professional_staff, last_cycle_at, reconstruction_started_at, reconstruction_until, rating_penalty_applied
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(building_id) DO UPDATE SET
          company_id = excluded.company_id,
          good_service = excluded.good_service,
          is_luxury = excluded.is_luxury,
          keep_open = excluded.keep_open,
          menu_json = excluded.menu_json,
          menu_price = excluded.menu_price,
          rating = excluded.rating,
          occupancy = excluded.occupancy,
          updated_at = excluded.updated_at,
          professional_staff = excluded.professional_staff,
          last_cycle_at = excluded.last_cycle_at,
          reconstruction_started_at = excluded.reconstruction_started_at,
          reconstruction_until = excluded.reconstruction_until,
          rating_penalty_applied = excluded.rating_penalty_applied`
      )
      .run(
        entity.buildingId,
        entity.companyId,
        entity.goodService ? 1 : 0,
        entity.isLuxury ? 1 : 0,
        entity.keepOpen ? 1 : 0,
        entity.menuJson,
        entity.menuPrice,
        entity.rating,
        entity.occupancy,
        virtualClock.nowIso(),
        entity.professionalStaff ? 1 : 0,
        entity.lastCycleAt,
        entity.reconstructionStartedAt,
        entity.reconstructionUntil,
        entity.ratingPenaltyApplied ? 1 : 0
      );
  }

  touchLastCycle(buildingId: number, cycleStartIso: string): void {
    this.database
      .prepare('UPDATE restaurant_properties SET last_cycle_at = ?, updated_at = ? WHERE building_id = ?')
      .run(cycleStartIso, virtualClock.nowIso(), buildingId);
  }

  updateRatingOccupancy(buildingId: number, rating: number, occupancy: number): void {
    this.database
      .prepare('UPDATE restaurant_properties SET rating = ?, occupancy = ?, updated_at = ? WHERE building_id = ?')
      .run(rating, occupancy, virtualClock.nowIso(), buildingId);
  }

  getActiveRunRow(buildingId: number, companyId?: number | null): Record<string, unknown> | undefined {
    return this.database
      .prepare(
        `SELECT * FROM restaurant_runs
         WHERE building_id = ? AND resolved = 0 AND (? IS NULL OR company_id = ?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(buildingId, companyId ?? null, companyId ?? null) as Record<string, unknown> | undefined;
  }

  findRunRow(runId: number): Record<string, unknown> | undefined {
    return this.database
      .prepare('SELECT * FROM restaurant_runs WHERE id = ?')
      .get(runId) as Record<string, unknown> | undefined;
  }

  insertRun(values: unknown[]): number {
    const insert = this.database
      .prepare(
        `INSERT INTO restaurant_runs (
          building_id, company_id, datetime, rating, new_rating, rating_before, rating_after, rating_delta,
          occupied, capacity, occupancy, revenue, cost, profit, menu_price, review, menu_json,
          good_service, is_luxury, resolved, cycle_start, cycle_end, prepared, served, spoiled, food_cost, wages
        ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, ?, '', ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?)`
      )
      .run(...values);
    return Number(insert.lastInsertRowid);
  }

  resolveRun(
    runId: number,
    values: {
      ratingBefore: number;
      ratingAfter: number;
      ratingDelta: number;
      newRating: number;
      served: number;
      occupancy: number;
      revenue: number;
      profit: number;
      spoiled: number;
      review: string;
    }
  ): void {
    this.database
      .prepare(
        `UPDATE restaurant_runs
         SET rating_before = ?, rating_after = ?, rating_delta = ?, new_rating = ?, occupied = ?, occupancy = ?,
             revenue = ?, profit = ?, served = ?, spoiled = ?, resolved = 1, review = ?
         WHERE id = ? AND resolved = 0`
      )
      .run(
        values.ratingBefore,
        values.ratingAfter,
        values.ratingDelta,
        values.newRating,
        values.served,
        values.occupancy,
        values.revenue,
        values.profit,
        values.served,
        values.spoiled,
        values.review,
        runId
      );
  }


  /** Due (cycle ended) unresolved runs, oldest first. */
  listDueRunIds(nowIso: string, buildingId?: number | null, companyId?: number | null): number[] {
    const rows = this.database
      .prepare(
        `SELECT id FROM restaurant_runs
         WHERE resolved = 0 AND cycle_end <= ?
           AND (? IS NULL OR building_id = ?)
           AND (? IS NULL OR company_id = ?)
         ORDER BY id ASC`
      )
      .all(nowIso, buildingId ?? null, buildingId ?? null, companyId ?? null, companyId ?? null) as Array<{
        id: number;
      }>;
    return rows.map(r => Number(r.id));
  }

  /** Latest runs for a building (history view), newest first. */
  listRecentRunRows(buildingId: number, companyId?: number | null, limit = 30): Array<Record<string, unknown>> {
    return this.database
      .prepare(
        'SELECT * FROM restaurant_runs WHERE building_id = ? AND (? IS NULL OR company_id = ?) ORDER BY id DESC LIMIT ?'
      )
      .all(buildingId, companyId ?? null, companyId ?? null, limit) as Array<Record<string, unknown>>;
  }

  countResolvedRuns(buildingId: number): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM restaurant_runs WHERE building_id = ? AND resolved = 1')
      .get(buildingId) as { count: number };
    return Number(row?.count) || 0;
  }

  /** COO management skill (0-100) for a company. */
  getCooManagement(companyId: number): number {
    const row = this.database
      .prepare(
        `SELECT COALESCE(MAX(skill_management), 0) AS skill
         FROM executives
         WHERE company_id = ? AND LOWER(position) IN ('coo', 'coo apprentice') AND status = 'employed'`
      )
      .get(companyId) as { skill: number };
    return Number(row?.skill) || 0;
  }

  /** CMO communication skill (0-100) for a company. */
  getCmoCommunication(companyId: number): number {
    const row = this.database
      .prepare(
        `SELECT COALESCE(MAX(skill_communication), 0) AS skill
         FROM executives
         WHERE company_id = ? AND LOWER(position) IN ('cmo', 'cmo apprentice') AND status = 'employed'`
      )
      .get(companyId) as { skill: number };
    return Number(row?.skill) || 0;
  }

  /** Market guests (global worker seats across all companies) + competitor restaurant list (Issue #108). */
  getRestaurantMarket(companyId: number, currentBuildingId: number): RestaurantMarketEntity {
    const workers = this.database
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN kind != 'r' THEN size * 100 ELSE 0 END), 0) AS workers
         FROM buildings`
      )
      .get() as { workers: number };
    const restaurants = this.database
      .prepare("SELECT id, size FROM buildings WHERE kind = 'r' AND id != ?")
      .all(currentBuildingId) as Array<{ id: number; size: number }>;
    return {
      marketGuests: Math.max(5000, Number(workers?.workers) || 0),
      activeRestaurants: restaurants.map(b => ({ id: Number(b.id), size: Number(b.size) }))
    };
  }
}

export const restaurantRepository = new RestaurantRepository();
