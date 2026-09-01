/**
 * Government Orders repository (Issue #105 hardening).
 * Owns government_orders / government_bids / government_bid_contractors SQL
 * for the scheduler's publication + award jobs. Pure persistence: no economy
 * semantics live here.
 */
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
}

export const governmentOrdersRepository = new GovernmentOrdersRepository();
