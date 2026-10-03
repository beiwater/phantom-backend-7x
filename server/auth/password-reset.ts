import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { hashPassword } from '../db/migrations/index.ts';

const RESET_TTL_MS = 30 * 60 * 1000;
const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Returns a local delivery token, never included in an HTTP response. */
export function requestPasswordReset(email: string): string | null {
  return runInTransaction(() => {
    const player = db.prepare('SELECT player_id FROM players WHERE email = ?').get(email) as { player_id: number } | undefined;
    if (!player) return null;
    const token = randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO password_reset_tokens (player_id, token_hash, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`)
      .run(player.player_id, digest(token), new Date(virtualClock.nowMs() + RESET_TTL_MS).toISOString());
    return token;
  });
}

export function completePasswordReset(email: string, token: string, newPassword: string): void {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token) || typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new Error('A valid reset token and new password (min 8 chars) are required');
  }
  runInTransaction(() => {
    const row = db.prepare(`SELECT p.player_id, r.expires_at FROM players p
      JOIN password_reset_tokens r ON r.player_id = p.player_id WHERE p.email = ? AND r.token_hash = ?`)
      .get(email, digest(token)) as { player_id: number; expires_at: string } | undefined;
    if (!row || Date.parse(row.expires_at) <= virtualClock.nowMs()) throw new Error('Invalid or expired reset token');
    db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE player_id = ?').run(hashPassword(newPassword), row.player_id);
    db.prepare('DELETE FROM password_reset_tokens WHERE player_id = ?').run(row.player_id);
    db.prepare('DELETE FROM sessions WHERE player_id = ?').run(row.player_id);
  });
}
