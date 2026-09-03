import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db } from '../db/database.ts';
import { CONFIG } from '../config.ts';
import { virtualClock } from '../core/virtual-clock.ts';

export interface SessionRecord {
  session_token: string;
  player_id: number;
  active_company_id: number;
  created_at: string;
  expires_at: string;
}

/** Issue #17: session lifetime in ms — 30 days, shared by DB expiry and cookie Max-Age. */
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
/** Issue #17: periodic cleanup interval for expired sessions (1 hour). */
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function createSession(playerId: number, companyId: number): string {
  const token = 'sess_' + crypto.randomBytes(32).toString('hex');
  const now = virtualClock.now();
  const expires = new Date(now.getTime() + SESSION_TTL_MS); // 30 days

  db.prepare(`
    INSERT INTO sessions (session_token, player_id, active_company_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, playerId, companyId, now.toISOString(), expires.toISOString());

  return token;
}

export function getSession(token: string): { playerId: number; companyId: number } | null {
  if (!token) return null;
  const row = db.prepare(`
    SELECT * FROM sessions WHERE session_token = ?
  `).get(token) as unknown as SessionRecord | undefined;

  if (!row) return null;
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= virtualClock.nowMs()) {
    db.prepare('DELETE FROM sessions WHERE session_token = ?').run(token);
    return null;
  }
  return {
    playerId: row.player_id,
    companyId: row.active_company_id
  };
}

export function destroySession(token: string): void {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE session_token = ?').run(token);
}

/**
 * Issue #17: delete all sessions whose expiry has passed. Runs once at
 * startup and then periodically so expired rows do not accumulate
 * indefinitely (getSession only removes them on access).
 */
export function cleanupExpiredSessions(): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .run(virtualClock.nowIso());
  return Number(result.changes);
}

export function startExpiredSessionCleanup(intervalMs: number = SESSION_CLEANUP_INTERVAL_MS): NodeJS.Timeout {
  const removed = cleanupExpiredSessions();
  if (removed > 0) console.log(`[auth] Removed ${removed} expired session(s) at startup`);
  return setInterval(() => {
    try {
      cleanupExpiredSessions();
    } catch (err: unknown) {
      console.error('[auth] Expired session cleanup failed:', err);
    }
  }, intervalMs);
}

export function switchSessionCompany(token: string, newCompanyId: number): void {
  if (!token || !Number.isSafeInteger(newCompanyId) || newCompanyId <= 0) return;
  const session = db.prepare('SELECT player_id FROM sessions WHERE session_token = ?').get(token) as { player_id?: number } | undefined;
  if (!session?.player_id) return;
  const ownedCompany = db.prepare('SELECT 1 FROM companies WHERE company_id = ? AND player_id = ?').get(newCompanyId, session.player_id);
  if (!ownedCompany) throw new Error('Company does not belong to session player');
  db.prepare('UPDATE sessions SET active_company_id = ? WHERE session_token = ? AND player_id = ?')
    .run(newCompanyId, token, session.player_id);
}

export const SESSION_TOKEN_REGEX = /^sess_[0-9a-f]{24,64}$/;

export function extractSessionToken(req: IncomingMessage): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice(7).trim();
    if (SESSION_TOKEN_REGEX.test(candidate)) {
      return candidate;
    }
  }

  // Check Cookie header
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const c of cookies) {
      if (c.startsWith('sessionid=')) {
        const candidate = c.slice(10).trim();
        if (SESSION_TOKEN_REGEX.test(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

/**
 * Issue #17: single source of truth for the sessionid cookie. Lifetime
 * matches the DB session TTL; `Secure` is enabled via COOKIE_SECURE=1 for
 * HTTPS deployments. For `token === ''` this emits a deletion cookie.
 */
export function buildSessionCookie(token: string): string {
  if (!token) {
    return 'sessionid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly'
      + cookieSecureSuffix();
  }
  const maxAge = Math.floor(SESSION_TTL_MS / 1000); // 2592000
  return `sessionid=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${cookieSecureSuffix()}`;
}

function cookieSecureSuffix(): string {
  if (process.env.COOKIE_SECURE === '1') return '; Secure';
  if (process.env.COOKIE_SECURE === '0') return '';
  if (process.env.NODE_ENV === 'production' && (process.env.HTTPS === 'true' || process.env.BASE_URL?.startsWith('https:'))) {
    return '; Secure';
  }
  return '';
}
