/**
 * FPA custom reports repository (Issue #109 build-out).
 * Persists user-defined Financial Planning & Analysis reports.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface CustomReportEntity {
  id: number;
  companyId: number;
  name: string;
  category: string;
  config: Record<string, unknown>;
  createdAt: string;
}

export class FpaReportsRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  list(companyId: number): CustomReportEntity[] {
    const rows = this.database
      .prepare('SELECT * FROM fpa_custom_reports WHERE company_id = ? ORDER BY id DESC')
      .all(companyId) as Array<{
        id: number;
        company_id: number;
        name: string;
        category: string;
        config_json: string;
        created_at: string;
      }>;
    return rows.map(r => {
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(r.config_json || '{}');
      } catch {
        config = {};
      }
      return {
        id: Number(r.id),
        companyId: Number(r.company_id),
        name: r.name,
        category: r.category,
        config,
        createdAt: r.created_at
      };
    });
  }

  create(companyId: number, name: string, category: string, config: Record<string, unknown>): CustomReportEntity {
    const now = new Date().toISOString();
    const res = this.database
      .prepare(
        'INSERT INTO fpa_custom_reports (company_id, name, category, config_json, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(companyId, name, category, JSON.stringify(config), now);
    return {
      id: Number(res.lastInsertRowid),
      companyId,
      name,
      category,
      config,
      createdAt: now
    };
  }

  findOwned(id: number, companyId: number): CustomReportEntity | undefined {
    return this.list(companyId).find(r => r.id === id);
  }

  delete(id: number, companyId: number): boolean {
    const res = this.database
      .prepare('DELETE FROM fpa_custom_reports WHERE id = ? AND company_id = ?')
      .run(id, companyId);
    return Number(res.changes) > 0;
  }
}

export const fpaReportsRepository = new FpaReportsRepository();
