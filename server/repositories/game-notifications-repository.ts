/**
 * Game notifications repository + service (Issue #107 build-out).
 *
 * Owns the game_notifications table: per-company feed entries written from
 * post-commit domain events. Pure persistence — event wiring lives in
 * notifications.ts, schema belongs to versioned migrations.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';


export interface GameNotificationEntity {
  id: number;
  companyId: number;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export class GameNotificationsRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  insert(companyId: number, type: string, payload: Record<string, unknown>, createdAt: string): void {
    this.database
      .prepare(
        'INSERT INTO game_notifications (company_id, type, payload_json, read, created_at) VALUES (?, ?, ?, 0, ?)'
      )
      .run(companyId, type, JSON.stringify(payload), createdAt);
  }

  list(companyId: number, limit = 100): GameNotificationEntity[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM game_notifications WHERE company_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(companyId, limit) as Array<{
        id: number;
        company_id: number;
        type: string;
        payload_json: string;
        read: number;
        created_at: string;
      }>;
    return rows.map(r => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(r.payload_json || '{}');
      } catch {
        payload = {};
      }
      return {
        id: Number(r.id),
        companyId: Number(r.company_id),
        type: r.type,
        payload,
        read: Boolean(r.read),
        createdAt: r.created_at
      };
    });
  }

  unreadCount(companyId: number): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM game_notifications WHERE company_id = ? AND read = 0')
      .get(companyId) as { count: number };
    return Number(row?.count) || 0;
  }

  markAllRead(companyId: number): void {
    this.database
      .prepare('UPDATE game_notifications SET read = 1 WHERE company_id = ? AND read = 0')
      .run(companyId);
  }
}

export const gameNotificationsRepository = new GameNotificationsRepository();
