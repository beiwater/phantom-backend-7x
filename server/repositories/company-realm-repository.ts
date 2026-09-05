import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import {
  mapCompanyRow,
  type CompanyDbRow,
  type CompanyEntity
} from './company-repository.ts';

export interface CompanyRealmMigrationBlocker {
  key: string;
  count: number;
  message: string;
}

export interface CompanyRealmMigrationResult {
  company: CompanyEntity;
  fromRealmId: number;
  toRealmId: number;
  updatedRows: Record<string, number>;
}

/** Persistence boundary for company-scoped realm identity transitions. */
export class CompanyRealmRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  findByIdForPlayer(companyId: number, playerId: number): CompanyEntity | null {
    const row = this.database.prepare(
      'SELECT * FROM companies WHERE company_id = ? AND player_id = ?'
    ).get(companyId, playerId) as CompanyDbRow | undefined;

    return row ? mapCompanyRow(row) : null;
  }

  private tableHasColumns(table: string, columns: readonly string[]): boolean {
    const available = new Set(
      (this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map(column => column.name)
    );
    return columns.every(column => available.has(column));
  }

  private countRows(
    table: string,
    columns: readonly string[],
    predicate: string,
    params: readonly (string | number | null)[]
  ): number {
    if (!this.tableHasColumns(table, columns)) return 0;
    const row = this.database.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE ${predicate}`
    ).get(...params) as { count?: number } | undefined;
    return Number(row?.count) || 0;
  }

  /**
   * Active orders and obligations can carry funds or a realm-sensitive
   * settlement context. Refuse those cases so a requested move is all-or-
   * nothing instead of silently changing economic semantics mid-flight.
   */
  listRealmMigrationBlockers(companyId: number): CompanyRealmMigrationBlocker[] {
    const definitions: Array<{
      key: string;
      table: string;
      columns: readonly string[];
      predicate: string;
      params: readonly (string | number | null)[];
      message: string;
    }> = [
      {
        key: 'active_production',
        table: 'production_queues',
        columns: ['company_id', 'resolved'],
        predicate: 'company_id = ? AND resolved = 0',
        params: [companyId],
        message: 'active production must finish or be cancelled first'
      },
      {
        key: 'active_retail',
        table: 'retail_orders',
        columns: ['company_id', 'revenue_credited'],
        predicate: 'company_id = ? AND revenue_credited = 0',
        params: [companyId],
        message: 'unsettled retail sales must be collected first'
      },
      {
        key: 'pending_contracts',
        table: 'contracts',
        columns: ['sender_company_id', 'recipient_company_id', 'status'],
        predicate: 'status = ? AND (sender_company_id = ? OR recipient_company_id = ?)',
        params: ['pending', companyId, companyId],
        message: 'pending contracts must be settled or cancelled first'
      },
      {
        key: 'active_bonds',
        table: 'bonds',
        columns: ['seller_company_id', 'buyer_company_id', 'status'],
        predicate: 'status = ? AND (seller_company_id = ? OR buyer_company_id = ?)',
        params: ['active', companyId, companyId],
        message: 'active bond positions must be settled first'
      },
      {
        key: 'active_loans',
        table: 'loans',
        columns: ['company_id', 'status'],
        predicate: 'company_id = ? AND status = ?',
        params: [companyId, 'active'],
        message: 'active loans must be repaid first'
      },
      {
        key: 'active_building_auction',
        table: 'building_auctions',
        columns: ['seller_id', 'status'],
        predicate: 'seller_id = ? AND status = ?',
        params: [companyId, 'active'],
        message: 'active building auctions must be settled or cancelled first'
      },
      {
        key: 'active_auction_bid',
        table: 'building_auction_bids',
        columns: ['company_id', 'status'],
        predicate: 'company_id = ? AND status = ?',
        params: [companyId, 'active'],
        message: 'active building-auction bids must be withdrawn first'
      },
      {
        key: 'active_government_bid',
        table: 'government_bids',
        columns: ['creator_company_id', 'status'],
        predicate: 'creator_company_id = ? AND status = ?',
        params: [companyId, 'OPEN'],
        message: 'open government bids must be closed first'
      },
      {
        key: 'government_contract',
        table: 'government_bid_contractors',
        columns: ['company_id', 'fulfilled'],
        predicate: 'company_id = ? AND fulfilled = 0',
        params: [companyId],
        message: 'government contracts must be fulfilled or left first'
      },
      {
        key: 'active_collectible_listing',
        table: 'nft_listings',
        columns: ['seller_id', 'status'],
        predicate: 'seller_id = ? AND status = ?',
        params: [companyId, 'active'],
        message: 'active collectible listings must be closed first'
      },
      {
        key: 'active_aerospace_sale',
        table: 'aerospace_sales_orders',
        columns: ['company_id', 'fulfilled'],
        predicate: 'company_id = ? AND fulfilled = 0',
        params: [companyId],
        message: 'active aerospace sales must be fulfilled first'
      },
      {
        key: 'active_launch',
        table: 'launchpad_flights',
        columns: ['company_id', 'status'],
        predicate: 'company_id = ? AND status IN (?, ?)',
        params: [companyId, 'queued', 'active'],
        message: 'active launchpad flights must finish first'
      }
    ];

    return definitions.flatMap(definition => {
      const count = this.countRows(
        definition.table,
        definition.columns,
        definition.predicate,
        definition.params
      );
      return count > 0
        ? [{ key: definition.key, count, message: definition.message }]
        : [];
    });
  }

  private updateRealmRows(
    table: string,
    realmColumn: string,
    companyColumn: string,
    companyId: number,
    fromRealmId: number,
    toRealmId: number
  ): number {
    if (!this.tableHasColumns(table, [realmColumn, companyColumn])) return 0;
    const result = this.database.prepare(
      `UPDATE ${table}
       SET ${realmColumn} = ?
       WHERE ${companyColumn} = ? AND ${realmColumn} = ?`
    ).run(toRealmId, companyId, fromRealmId);
    return Number(result.changes) || 0;
  }

  /**
   * Update all known company-owned denormalized realm fields in the same
   * transaction as companies.realm_id. Realm-global phase/catalog rows are
   * intentionally never touched.
   */
  migrateOwnedRealm(
    companyId: number,
    playerId: number,
    fromRealmId: number,
    toRealmId: number
  ): CompanyRealmMigrationResult {
    const owned = this.findByIdForPlayer(companyId, playerId);
    if (!owned) {
      throw new Error('Company does not belong to the authenticated player');
    }
    if (owned.realmId !== fromRealmId) {
      throw new Error('Company realm changed while migration was in progress');
    }

    const updatedRows: Record<string, number> = {};
    const companyUpdate = this.database.prepare(
      `UPDATE companies
       SET realm_id = ?
       WHERE company_id = ? AND player_id = ? AND realm_id = ?`
    ).run(toRealmId, companyId, playerId, fromRealmId);
    if (Number(companyUpdate.changes) !== 1) {
      throw new Error('Company realm could not be updated');
    }
    updatedRows.companies = Number(companyUpdate.changes);

    const ownedRealmFields: Array<[string, string, string]> = [
      ['rocket_launches', 'realm_id', 'company_id'],
      ['retail_sales_history', 'realm_id', 'company_id'],
      ['certificates', 'realm_id', 'company_id'],
      ['government_bids', 'realm_id', 'creator_company_id'],
      ['newspaper_articles', 'realm_id', 'author_company_id'],
      ['building_auctions', 'realm', 'seller_id'],
      ['challenge_attempts', 'company_realm_id', 'company_id'],
      ['course_students', 'company_realm_id', 'company_id'],
      ['contest_participants', 'company_realm_id', 'company_id']
    ];
    for (const [table, realmColumn, companyColumn] of ownedRealmFields) {
      updatedRows[table] = this.updateRealmRows(
        table,
        realmColumn,
        companyColumn,
        companyId,
        fromRealmId,
        toRealmId
      );
    }

    const company = this.findByIdForPlayer(companyId, playerId);
    if (!company) {
      throw new Error('Company disappeared after realm migration');
    }
    return { company, fromRealmId, toRealmId, updatedRows };
  }
}

export const companyRealmRepository = new CompanyRealmRepository();
