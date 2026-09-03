/**
 * Audit/admin repository (Issue #109 build-out).
 * Persists real moderation events (bans, suspensions, notes) and exposes
 * them to the admin surfaces, replacing the hardcoded demo data.
 * Ban semantics: company.deleted = 1 + all player sessions revoked.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface AuditEntity {
  id: number;
  actorCompanyId: number | null;
  targetCompanyId: number | null;
  targetPlayerId: number | null;
  action: string;
  reason: string;
  createdAt: string;
}

export class AuditRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  record(entry: {
    actorCompanyId?: number | null;
    targetCompanyId?: number | null;
    targetPlayerId?: number | null;
    action: string;
    reason?: string;
  }): AuditEntity {
    const now = new Date().toISOString();
    const res = this.database
      .prepare(
        'INSERT INTO audits (actor_company_id, target_company_id, target_player_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        entry.actorCompanyId ?? null,
        entry.targetCompanyId ?? null,
        entry.targetPlayerId ?? null,
        entry.action,
        entry.reason ?? '',
        now
      );
    return {
      id: Number(res.lastInsertRowid),
      actorCompanyId: entry.actorCompanyId ?? null,
      targetCompanyId: entry.targetCompanyId ?? null,
      targetPlayerId: entry.targetPlayerId ?? null,
      action: entry.action,
      reason: entry.reason ?? '',
      createdAt: now
    };
  }

  list(limit = 100): AuditEntity[] {
    const rows = this.database
      .prepare('SELECT * FROM audits ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{
        id: number;
        actor_company_id: number | null;
        target_company_id: number | null;
        target_player_id: number | null;
        action: string;
        reason: string;
        created_at: string;
      }>;
    return rows.map(r => ({
      id: Number(r.id),
      actorCompanyId: r.actor_company_id === null ? null : Number(r.actor_company_id),
      targetCompanyId: r.target_company_id === null ? null : Number(r.target_company_id),
      targetPlayerId: r.target_player_id === null ? null : Number(r.target_player_id),
      action: r.action,
      reason: r.reason,
      createdAt: r.created_at
    }));
  }

  listForCompany(targetCompanyId: number): AuditEntity[] {
    return this.list(500).filter(a => a.targetCompanyId === targetCompanyId);
  }
}

/** Ban: mark company deleted and revoke every session of its player(s). */
export function banCompany(targetCompanyId: number, actorCompanyId: number | null, reason: string): { banned: boolean; audits: AuditEntity } {
  const company = db.prepare('SELECT company_id, player_id FROM companies WHERE company_id = ?')
    .get(targetCompanyId) as { company_id: number; player_id: number } | undefined;
  if (!company) {
    return { banned: false, audits: auditRepository.record({ actorCompanyId, targetCompanyId, action: 'ban-failed', reason: 'company not found' }) };
  }
  db.prepare(
    "INSERT INTO company_settings (company_id, key, value) VALUES (?, 'banned', '1') ON CONFLICT(company_id, key) DO UPDATE SET value = '1'"
  ).run(targetCompanyId);
  db.prepare('DELETE FROM sessions WHERE player_id = ?').run(company.player_id);
  const audit = auditRepository.record({
    actorCompanyId,
    targetCompanyId,
    targetPlayerId: Number(company.player_id),
    action: 'ban',
    reason
  });
  return { banned: true, audits: audit };
}

export const auditRepository = new AuditRepository();
