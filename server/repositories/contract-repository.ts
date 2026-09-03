import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface ContractRow {
  id: number;
  sender_company_id: number;
  recipient_company_id: number;
  kind: number;
  quality: number;
  amount: number;
  price: number;
  status: string;
  created_at: string;
}

/** Shaped summary row for the warehouse contracts panel (snake_case SQL -> camelCase). */
export interface WarehouseContractsSummaryRow {
  kind: number;
  quality: number;
  incomingCount: number;
  outgoingCount: number;
  incomingAmount: number;
  outgoingAmount: number;
}

/**
 * Contract lifecycle persistence (Issue #179 vertical slice: moved verbatim
 * from game/contracts.ts). Every statement is the exact SQL the legacy engine
 * ran — the migration preserves economy semantics, never rewrites them.
 */
export class ContractRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  /**
   * Pending contract by id, or null. Collapses the legacy SELECT-then-status
   * check; callers keep their original error messages for the null case.
   */
  findPendingById(contractId: number): ContractRow | null {
    const row = this.database.prepare(`
      SELECT * FROM contracts
      WHERE id = ? AND status = 'pending'
    `).get(contractId) as ContractRow | undefined;
    return row || null;
  }

  /** Insert a pending contract; returns the new contract id. */
  insertPending(
    senderCompanyId: number,
    recipientCompanyId: number,
    kind: number,
    quality: number,
    amount: number,
    price: number,
    createdAt: string
  ): number {
    const res = this.database.prepare(`
      INSERT INTO contracts (sender_company_id, recipient_company_id, kind, quality, amount, price, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(senderCompanyId, recipientCompanyId, kind, quality, amount, price, createdAt);
    return Number(res.lastInsertRowid);
  }

  /** Pending contracts sent to the company, newest first. */
  listIncomingRows(companyId: number): ContractRow[] {
    return this.database.prepare(`
      SELECT * FROM contracts
      WHERE recipient_company_id = ? AND status = 'pending'
      ORDER BY id DESC
    `).all(companyId) as unknown as ContractRow[];
  }

  /** Pending contracts sent by the company, newest first. */
  listOutgoingRows(companyId: number): ContractRow[] {
    return this.database.prepare(`
      SELECT * FROM contracts
      WHERE sender_company_id = ? AND status = 'pending'
      ORDER BY id DESC
    `).all(companyId) as unknown as ContractRow[];
  }

  /** Settled (non-pending) contracts, newest first, capped at 200 like the legacy query. */
  listHistoryRows(companyId: number, direction: 'incoming' | 'outgoing'): ContractRow[] {
    const column = direction === 'incoming' ? 'recipient_company_id' : 'sender_company_id';
    return this.database.prepare(`
      SELECT * FROM contracts
      WHERE ${column} = ? AND status != 'pending'
      ORDER BY id DESC
      LIMIT 200
    `).all(companyId) as unknown as ContractRow[];
  }

  /**
   * Pending per-(kind, quality) volume summary for the warehouse panel,
   * including the pure snake_case -> camelCase row shaping of the legacy query.
   */
  warehouseContractsSummaryRows(companyId: number): WarehouseContractsSummaryRow[] {
    const rows = this.database.prepare(`
      SELECT kind, quality,
        SUM(CASE WHEN recipient_company_id = ? THEN 1 ELSE 0 END) AS incoming_count,
        SUM(CASE WHEN sender_company_id = ? THEN 1 ELSE 0 END) AS outgoing_count,
        SUM(CASE WHEN recipient_company_id = ? THEN amount ELSE 0 END) AS incoming_amount,
        SUM(CASE WHEN sender_company_id = ? THEN amount ELSE 0 END) AS outgoing_amount
      FROM contracts
      WHERE status = 'pending' AND (recipient_company_id = ? OR sender_company_id = ?)
      GROUP BY kind, quality
      ORDER BY kind ASC
    `).all(companyId, companyId, companyId, companyId, companyId, companyId) as Array<{
      kind: number;
      quality: number;
      incoming_count: number;
      outgoing_count: number;
      incoming_amount: number;
      outgoing_amount: number;
    }>;
    return rows.map(r => ({
      kind: Number(r.kind),
      quality: Number(r.quality),
      incomingCount: Number(r.incoming_count),
      outgoingCount: Number(r.outgoing_count),
      incomingAmount: Number(r.incoming_amount),
      outgoingAmount: Number(r.outgoing_amount)
    }));
  }

  /** Accept a pending contract addressed to buyerCompanyId; returns affected row count. */
  markAccepted(contractId: number, buyerCompanyId: number): number {
    const res = this.database.prepare(`
      UPDATE contracts SET status = 'accepted'
      WHERE id = ? AND recipient_company_id = ? AND status = 'pending'
    `).run(contractId, buyerCompanyId);
    return Number(res.changes);
  }

  /** Reject a pending contract (either party); returns affected row count. */
  markRejected(contractId: number): number {
    const res = this.database.prepare(`
      UPDATE contracts SET status = 'rejected'
      WHERE id = ? AND status = 'pending'
    `).run(contractId);
    return Number(res.changes);
  }

  /** Cancel a pending contract (sender only); returns affected row count. */
  markCancelled(contractId: number, senderCompanyId: number): number {
    const res = this.database.prepare(`
      UPDATE contracts SET status = 'cancelled'
      WHERE id = ? AND sender_company_id = ? AND status = 'pending'
    `).run(contractId, senderCompanyId);
    return Number(res.changes);
  }
}

export const contractRepository = new ContractRepository();
