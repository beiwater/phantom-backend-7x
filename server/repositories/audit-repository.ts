/**
 * Audit/admin repository (Issue #109 build-out).
 * Persists real moderation events (bans, suspensions, notes) and exposes
 * them to the admin surfaces, replacing the hardcoded demo data.
 * Ban semantics: company.deleted = 1 + all player sessions revoked.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';
import { virtualClock } from '../core/virtual-clock.ts';

export interface AuditEntity {
  id: number;
  actorCompanyId: number | null;
  targetCompanyId: number | null;
  targetPlayerId: number | null;
  action: string;
  reason: string;
  createdAt: string;
}

/** Row shape for recent player-session listings (admin audit views). */
export interface AdminSessionRow {
  created_at: string;
  expires_at: string | null;
}

/** Row shape for inactive (filled/cancelled) market-order reads. */
export interface AdminMarketOrderRow {
  id: number;
  seller_id: number;
  kind: number;
  quality: number;
  quantity: number;
  price: number;
  posted_at: string;
}

/** Row shape for contract reads spanning a company (admin audit views). */
export interface AdminContractRow {
  id: number;
  sender_company_id: number;
  recipient_company_id: number;
  status: string;
  kind: number;
  quality: number;
  amount: number;
  price: number;
  created_at: string;
}

/** Subset of the players row consumed by the admin personal-audit view. */
export interface AdminPlayerRow {
  player_id: number;
  email: string | null;
  is_admin: number;
  language: string | null;
  created_at: string | null;
}

/** Minimal company identity row (companies owned by one player). */
export interface AdminCompanyBasicRow {
  company_id: number;
  name: string;
}

/** Row shape for the newcomers listing (newest companies). */
export interface AdminNewcomerCompanyRow {
  company_id: number;
  name: string;
  logo: string | null;
  realm_id: number | null;
  created_at: string | null;
  note: string | null;
}

/** Row shape for a player's first (oldest) company, used by redeem-code rewards. */
export interface AdminPlayerFirstCompanyRow {
  company_id: number;
  simboosts: number;
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
    const now = virtualClock.nowIso();
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

  /** Issue #180: admin flag for a player id (moved verbatim from audit-routes). */
  isPlayerAdmin(playerId: number): boolean {
    const player = this.database
      .prepare('SELECT is_admin FROM players WHERE player_id = ?')
      .get(playerId) as { is_admin?: number } | undefined;
    return Boolean(player && player.is_admin === 1);
  }

  /** Issue #180: admin flag for a company via the company-to-player join (moved verbatim from audit-routes). */
  isCompanyAdmin(companyId: number): boolean {
    const player = this.database
      .prepare('SELECT p.is_admin FROM players p JOIN companies c ON c.player_id = p.player_id WHERE c.company_id = ?')
      .get(companyId) as { is_admin?: number } | undefined;
    return Boolean(player && player.is_admin === 1);
  }

  /** Issue #180: large inactive market orders for the admin purchase-detective view. */
  listLargeInactiveMarketOrders(): AdminMarketOrderRow[] {
    return this.database.prepare(`
      SELECT id, seller_id, kind, quality, quantity, price, posted_at
      FROM market_orders WHERE active = 0 AND quantity * price >= 100000
      ORDER BY posted_at DESC LIMIT 100
    `).all() as AdminMarketOrderRow[];
  }

  /** Issue #180: full players row by id for the personal-audit view. */
  getPlayerById(playerId: number | null | undefined): AdminPlayerRow | undefined {
    return this.database
      .prepare('SELECT * FROM players WHERE player_id = ?')
      .get(playerId) as AdminPlayerRow | undefined;
  }

  /** Issue #180: recent sessions of a player, newest first. */
  listPlayerSessions(playerId: number): AdminSessionRow[] {
    return this.database.prepare(`
      SELECT created_at, expires_at FROM sessions WHERE player_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(playerId) as AdminSessionRow[];
  }

  /** Issue #180: contracts sent or received by a company, newest first. */
  listCompanyContracts(companyId: number): AdminContractRow[] {
    return this.database.prepare(`
      SELECT id, sender_company_id, recipient_company_id, status, kind, quality, amount, price, created_at
      FROM contracts WHERE sender_company_id = ? OR recipient_company_id = ?
      ORDER BY id DESC LIMIT 100
    `).all(companyId, companyId) as AdminContractRow[];
  }

  /** Issue #180: inactive market orders sold by a company, newest first. */
  listCompanyMarketTrades(companyId: number): AdminMarketOrderRow[] {
    return this.database.prepare(`
      SELECT id, seller_id, kind, quality, quantity, price, posted_at
      FROM market_orders WHERE seller_id = ? AND active = 0
      ORDER BY id DESC LIMIT 100
    `).all(companyId) as AdminMarketOrderRow[];
  }

  /** Issue #180: all companies owned by a player (IP-audit view). */
  listCompaniesByPlayer(playerId: number): AdminCompanyBasicRow[] {
    return this.database
      .prepare('SELECT company_id, name FROM companies WHERE player_id = ?')
      .all(playerId) as AdminCompanyBasicRow[];
  }

  /** Issue #180: newest 50 companies for the newcomers listing. */
  listNewcomerCompanies(): AdminNewcomerCompanyRow[] {
    return this.database.prepare(`
      SELECT company_id, name, logo, realm_id, created_at, note
      FROM companies
      ORDER BY id DESC
      LIMIT 50
    `).all() as AdminNewcomerCompanyRow[];
  }

  /** Issue #180: a player's first (oldest) company, if any (redeem-code target). */
  findFirstCompanyByPlayer(playerId: number): AdminPlayerFirstCompanyRow | undefined {
    return this.database
      .prepare('SELECT company_id, simboosts FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1')
      .get(playerId) as AdminPlayerFirstCompanyRow | undefined;
  }

  /** Issue #180: credit 50 loyalty SimBoosts to a company (redeem-code reward). */
  grantLoyaltySimboosts(companyId: number): void {
    this.database
      .prepare('UPDATE companies SET simboosts = simboosts + 50 WHERE company_id = ?')
      .run(companyId);
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
