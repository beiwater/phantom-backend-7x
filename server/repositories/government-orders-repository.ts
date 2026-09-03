/**
 * Government Orders repository (Issue #105 hardening).
 * Owns government_orders / government_bids / government_bid_contractors SQL
 * for the scheduler's publication + award jobs. Pure persistence: no economy
 * semantics live here.
 */
import { virtualClock } from '../core/virtual-clock.ts';
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface StaleOrderEntity {
  id: number;
  daysToFulfill: number;
}

export interface AwardTemplateEntity {
  id: number;
  requiredResourcesJson: string;
  unitCompensationPrice: number;
}

export interface OpenBidEntity {
  id: number;
  secret: string;
  priceBreakdownJson: string | null;
}

export class GovernmentOrdersRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  listRealms(): number[] {
    const rows = this.database.prepare('SELECT DISTINCT realm_id FROM government_orders').all() as Array<{
      realm_id: number;
    }>;
    return rows.map(r => Number(r.realm_id));
  }

  /** Orders past their deadline (or with none) that need a fresh bidding window. */
  listStaleOrders(occurrenceIso: string): StaleOrderEntity[] {
    const stale = this.database.prepare(`
      SELECT id, days_to_fulfill FROM government_orders
      WHERE deadline IS NULL OR deadline < ?
    `).all(occurrenceIso) as Array<{ id: number; days_to_fulfill: number }>;
    return stale.map(o => ({ id: Number(o.id), daysToFulfill: Number(o.days_to_fulfill) }));
  }

  republishOrder(orderId: number, startDateIso: string, deadlineIso: string): void {
    this.database
      .prepare('UPDATE government_orders SET start_date = ?, deadline = ? WHERE id = ?')
      .run(startDateIso, deadlineIso, orderId);
  }

  /** Awardable templates: deadline passed, no multiplier awarded yet. */
  listAwardableTemplates(occurrenceIso: string): AwardTemplateEntity[] {
    const templates = this.database.prepare(`
      SELECT id, required_resources_json, unit_compensation_price
      FROM government_orders
      WHERE deadline IS NOT NULL AND deadline <= ? AND resource_multiplier_awarded IS NULL
    `).all(occurrenceIso) as Array<{
      id: number;
      required_resources_json: string;
      unit_compensation_price: number;
    }>;
    return templates.map(t => ({
      id: Number(t.id),
      requiredResourcesJson: String(t.required_resources_json),
      unitCompensationPrice: Number(t.unit_compensation_price)
    }));
  }

  listOpenBids(templateId: number): OpenBidEntity[] {
    const openBids = this.database.prepare(`
      SELECT id, secret, price_breakdown_json FROM government_bids
      WHERE template_id = ? AND status = 'OPEN'
    `).all(templateId) as Array<{ id: number; secret: string; price_breakdown_json: string | null }>;
    return openBids.map(b => ({
      id: Number(b.id),
      secret: String(b.secret),
      priceBreakdownJson: b.price_breakdown_json === null ? null : String(b.price_breakdown_json)
    }));
  }

  markBidAwarded(bidId: number): void {
    this.database.prepare(`UPDATE government_bids SET status = 'AWARDED' WHERE id = ?`).run(bidId);
  }

  markBidRejected(bidId: number): void {
    this.database.prepare(`UPDATE government_bids SET status = 'REJECTED' WHERE id = ?`).run(bidId);
  }

  /** Contractors with a positive deposit on a losing bid. */
  listDepositHolders(bidSecret: string): Array<{ companyId: number; depositPaid: number }> {
    const contractors = this.database.prepare(`
      SELECT company_id, deposit_paid FROM government_bid_contractors
      WHERE bid_secret = ? AND deposit_paid > 0
    `).all(bidSecret) as Array<{ company_id: number; deposit_paid: number }>;
    return contractors.map(c => ({
      companyId: Number(c.company_id),
      depositPaid: Number(c.deposit_paid) || 0
    }));
  }

  forfeitDeposits(bidSecret: string, companyId: number): void {
    this.database
      .prepare('UPDATE government_bid_contractors SET deposit_paid = 0 WHERE bid_secret = ? AND company_id = ?')
      .run(bidSecret, companyId);
  }

  mainContractorTierMultiplier(bidSecret: string): number {
    const main = this.database
      .prepare(
        `SELECT tier_multiplier FROM government_bid_contractors
         WHERE bid_secret = ? AND is_main = 1`
      )
      .get(bidSecret) as { tier_multiplier: number } | undefined;
    return Number(main?.tier_multiplier) || 1;
  }

  setAwardedMultiplier(orderId: number, multiplier: number): void {
    this.database
      .prepare('UPDATE government_orders SET resource_multiplier_awarded = ? WHERE id = ?')
      .run(multiplier, orderId);
  }

  /**
   * 7 Standard Government Procurement Projects matching formulas_government.md
   * & prompt specifications (moved verbatim from game/government.ts, Issue #179).
   */
  static STANDARD_PROJECTS = [
    {
      key: 'FIRE_TRUCKS',
      name: 'Fire Trucks',
      agency: 'FIRE_DEPARTMENT',
      value: 260000,
      days: 7,
      unitCompensationPrice: 85.0,
      resources: [
        { id: 1, kind: 12, quality: 0, amountBase: 600, targetAmount: 600, unitCompensationPrice: 40.0, unitPrice: 40.0 },
        { id: 2, kind: 48, quality: 1, amountBase: 180, targetAmount: 180, unitCompensationPrice: 200.0, unitPrice: 200.0 },
        { id: 3, kind: 18, quality: 1, amountBase: 350, targetAmount: 350, unitCompensationPrice: 100.0, unitPrice: 100.0 },
        { id: 4, kind: 13, quality: 0, amountBase: 200, targetAmount: 200, unitCompensationPrice: 50.0, unitPrice: 50.0 }
      ]
    },
    {
      key: 'MARS_ROVER',
      name: 'Mars Rover',
      agency: 'SPACE_EXPLORATION_AGENCY',
      value: 720000,
      days: 10,
      unitCompensationPrice: 1250.0,
      resources: [
        { id: 5, kind: 80, quality: 2, amountBase: 25, targetAmount: 25, unitCompensationPrice: 8000.0, unitPrice: 8000.0 },
        { id: 6, kind: 85, quality: 1, amountBase: 15, targetAmount: 15, unitCompensationPrice: 12000.0, unitPrice: 12000.0 },
        { id: 7, kind: 100, quality: 0, amountBase: 500, targetAmount: 500, unitCompensationPrice: 300.0, unitPrice: 300.0 },
        { id: 8, kind: 78, quality: 1, amountBase: 30, targetAmount: 30, unitCompensationPrice: 5000.0, unitPrice: 5000.0 }
      ]
    },
    {
      key: 'DRONE_FLEET',
      name: 'Drone Fleet',
      agency: 'DEPARTMENT_OF_DEFENSE',
      value: 550000,
      days: 8,
      unitCompensationPrice: 280.0,
      resources: [
        { id: 9, kind: 11, quality: 0, amountBase: 1500, targetAmount: 1500, unitCompensationPrice: 45.0, unitPrice: 45.0 },
        { id: 10, kind: 80, quality: 2, amountBase: 20, targetAmount: 20, unitCompensationPrice: 8000.0, unitPrice: 8000.0 },
        { id: 11, kind: 100, quality: 0, amountBase: 400, targetAmount: 400, unitCompensationPrice: 300.0, unitPrice: 300.0 },
        { id: 12, kind: 98, quality: 1, amountBase: 50, targetAmount: 50, unitCompensationPrice: 900.0, unitPrice: 900.0 }
      ]
    },
    {
      key: 'GREEN_DIPLOMATIC_FLEET',
      name: 'Green Diplomatic Fleet',
      agency: 'ENVIRONMENTAL_PROTECTION_AGENCY',
      value: 310000,
      days: 6,
      unitCompensationPrice: 2.3,
      resources: [
        { id: 13, kind: 2, quality: 0, amountBase: 80000, targetAmount: 80000, unitCompensationPrice: 0.5, unitPrice: 0.5 },
        { id: 14, kind: 1, quality: 0, amountBase: 50000, targetAmount: 50000, unitCompensationPrice: 0.3, unitPrice: 0.3 },
        { id: 15, kind: 22, quality: 1, amountBase: 400, targetAmount: 400, unitCompensationPrice: 150.0, unitPrice: 150.0 },
        { id: 16, kind: 75, quality: 1, amountBase: 200, targetAmount: 200, unitCompensationPrice: 300.0, unitPrice: 300.0 }
      ]
    },
    {
      key: 'CROP_DIVERSITY_PROGRAM',
      name: 'Crop Diversity Program',
      agency: 'DEPARTMENT_OF_AGRICULTURE',
      value: 210000,
      days: 5,
      unitCompensationPrice: 2.6,
      resources: [
        { id: 17, kind: 3, quality: 0, amountBase: 15000, targetAmount: 15000, unitCompensationPrice: 4.5, unitPrice: 4.5 },
        { id: 18, kind: 2, quality: 0, amountBase: 60000, targetAmount: 60000, unitCompensationPrice: 0.5, unitPrice: 0.5 },
        { id: 19, kind: 66, quality: 0, amountBase: 5000, targetAmount: 5000, unitCompensationPrice: 8.0, unitPrice: 8.0 },
        { id: 20, kind: 4, quality: 0, amountBase: 12000, targetAmount: 12000, unitCompensationPrice: 4.5, unitPrice: 4.5 }
      ]
    },
    {
      key: 'FUEL_RESERVES',
      name: 'Fuel Reserves',
      agency: 'ENERGY_DEPARTMENT',
      value: 480000,
      days: 7,
      unitCompensationPrice: 4.0,
      resources: [
        { id: 21, kind: 1, quality: 0, amountBase: 100000, targetAmount: 100000, unitCompensationPrice: 0.3, unitPrice: 0.3 },
        { id: 22, kind: 22, quality: 1, amountBase: 600, targetAmount: 600, unitCompensationPrice: 150.0, unitPrice: 150.0 },
        { id: 23, kind: 18, quality: 1, amountBase: 500, targetAmount: 500, unitCompensationPrice: 100.0, unitPrice: 100.0 },
        { id: 24, kind: 101, quality: 0, amountBase: 1200, targetAmount: 1200, unitCompensationPrice: 40.0, unitPrice: 40.0 }
      ]
    },
    {
      key: 'MEDICAL_SUPPLIES',
      name: 'Medical Supplies',
      agency: 'PUBLIC_HEALTH_DEPARTMENT',
      value: 350000,
      days: 5,
      unitCompensationPrice: 7.2,
      resources: [
        { id: 25, kind: 2, quality: 1, amountBase: 40000, targetAmount: 40000, unitCompensationPrice: 0.8, unitPrice: 0.8 },
        { id: 26, kind: 3, quality: 1, amountBase: 8000, targetAmount: 8000, unitCompensationPrice: 6.0, unitPrice: 6.0 },
        { id: 27, kind: 22, quality: 1, amountBase: 500, targetAmount: 500, unitCompensationPrice: 150.0, unitPrice: 150.0 },
        { id: 28, kind: 8, quality: 1, amountBase: 3000, targetAmount: 3000, unitCompensationPrice: 8.0, unitPrice: 8.0 }
      ]
    }
  ];

  static LEGACY_KEY_RENAMES: Record<string, string> = {
    FIRE_TRUCK_FLEET: 'FIRE_TRUCKS',
    STRATEGIC_GRAIN_RESERVE: 'CROP_DIVERSITY_PROGRAM',
    GRID_REINFORCEMENT: 'FUEL_RESERVES',
    EMERGENCY_MEDICAL_SUPPLY: 'MEDICAL_SUPPLIES',
    SATELLITE_NETWORK: 'MARS_ROVER',
    BORDER_SECURITY_LOGISTICS: 'DRONE_FLEET',
    CLEAN_WATER_INITIATIVE: 'GREEN_DIPLOMATIC_FLEET'
  };

  projectDefinition(projectKey: string): {
    key: string;
    name: string;
    agency: string;
    value: number;
    days: number;
    unitCompensationPrice: number;
    resources: Array<Record<string, number>>;
  } | undefined {
    const canonicalKey = GovernmentOrdersRepository.LEGACY_KEY_RENAMES[projectKey] || projectKey;
    return GovernmentOrdersRepository.STANDARD_PROJECTS.find(
      project => project.key === canonicalKey || project.key === projectKey
    );
  }

  ensureSeededProjects(realmId: number = 0): void {
    const now = virtualClock.now();
    const nowIso = now.toISOString();
    for (const [oldKey, newKey] of Object.entries(GovernmentOrdersRepository.LEGACY_KEY_RENAMES)) {
      const hasNewKey = this.database.prepare(
        'SELECT 1 FROM government_orders WHERE realm_id = ? AND project_key = ? LIMIT 1'
      ).get(realmId, newKey);
      if (!hasNewKey) {
        this.database.prepare(
          'UPDATE government_orders SET project_key = ? WHERE realm_id = ? AND project_key = ?'
        ).run(newKey, realmId, oldKey);
      } else {
        this.database.prepare(
          'DELETE FROM government_orders WHERE realm_id = ? AND project_key = ?'
        ).run(realmId, oldKey);
      }
    }

    for (const project of GovernmentOrdersRepository.STANDARD_PROJECTS) {
      const existing = this.database.prepare(`
        SELECT id, created_at, start_date, deadline, resource_multiplier_awarded
        FROM government_orders
        WHERE realm_id = ? AND project_key = ?
        ORDER BY id ASC
        LIMIT 1
      `).get(realmId, project.key) as {
        id: number;
        created_at: string | null;
        start_date: string | null;
        deadline: string | null;
        resource_multiplier_awarded: number | null;
      } | undefined;
      const createdAt = existing?.created_at || nowIso;
      const startDate = existing?.start_date || createdAt;
      const deadline = existing?.deadline || new Date(
        Date.parse(startDate) + project.days * 24 * 60 * 60 * 1000
      ).toISOString();
      if (existing) {
        this.database.prepare(`
          UPDATE government_orders
          SET agency = ?, estimated_base_value = ?, days_to_fulfill = ?,
              required_resources_json = ?, unit_compensation_price = ?,
              start_date = ?, deadline = ?, created_at = ?
          WHERE id = ?
        `).run(
          project.agency,
          project.value,
          project.days,
          JSON.stringify(project.resources),
          project.unitCompensationPrice,
          startDate,
          deadline,
          createdAt,
          existing.id
        );
      } else {
        this.database.prepare(`
          INSERT INTO government_orders (
            realm_id, project_key, agency, estimated_base_value, days_to_fulfill,
            resource_multiplier_awarded, required_resources_json, unit_compensation_price,
            start_date, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
        `).run(
          realmId,
          project.key,
          project.agency,
          project.value,
          project.days,
          JSON.stringify(project.resources),
          project.unitCompensationPrice,
          startDate,
          deadline,
          createdAt
        );
      }
    }
  }
}

export const governmentOrdersRepository = new GovernmentOrdersRepository();
