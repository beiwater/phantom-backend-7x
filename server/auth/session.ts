import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db } from '../db/database.ts';

export interface SessionRecord {
  session_token: string;
  player_id: number;
  active_company_id: number;
  created_at: string;
  expires_at: string;
}

export function createSession(playerId: number, companyId: number): string {
  const token = 'sess_' + crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 3600 * 1000); // 30 days

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
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
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

export function switchSessionCompany(token: string, newCompanyId: number): void {
  if (!token || !Number.isSafeInteger(newCompanyId) || newCompanyId <= 0) return;
  const session = db.prepare('SELECT player_id FROM sessions WHERE session_token = ?').get(token) as { player_id?: number } | undefined;
  if (!session?.player_id) return;
  const ownedCompany = db.prepare('SELECT 1 FROM companies WHERE company_id = ? AND player_id = ?').get(newCompanyId, session.player_id);
  if (!ownedCompany) throw new Error('Company does not belong to session player');
  db.prepare('UPDATE sessions SET active_company_id = ? WHERE session_token = ? AND player_id = ?')
    .run(newCompanyId, token, session.player_id);
}

export function extractSessionToken(req: IncomingMessage): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // Check Cookie header
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const c of cookies) {
      if (c.startsWith('sessionid=')) {
        return c.slice(10).trim();
      }
    }
  }

  return null;
}
