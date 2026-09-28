import { db } from '../db/connection.ts';

export interface LoanRow {
  id: number;
  company_id: number;
  principal: number;
  interest_rate: number;
  remaining: number;
  status: string;
  created_at: string;
  due_at: string;
}

export class LoanRepository {
  list(companyId: number): LoanRow[] {
    return db.prepare('SELECT * FROM loans WHERE company_id = ? ORDER BY created_at ASC, id ASC')
      .all(companyId) as unknown as LoanRow[];
  }

  find(id: number): LoanRow | undefined {
    return db.prepare('SELECT * FROM loans WHERE id = ?').get(id) as LoanRow | undefined;
  }

  activePrincipal(companyId: number): number {
    const row = db.prepare("SELECT COALESCE(SUM(remaining), 0) AS total FROM loans WHERE company_id = ? AND status = 'active'")
      .get(companyId) as { total: number };
    return Number(row.total) || 0;
  }

  insert(companyId: number, principal: number, rate: number, createdAt: string, dueAt: string): number {
    return Number(db.prepare(
      "INSERT INTO loans (company_id, principal, interest_rate, remaining, status, created_at, due_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
    ).run(companyId, principal, rate, principal, createdAt, dueAt).lastInsertRowid);
  }

  updateBalance(id: number, remaining: number, status: string, dueAt: string): void {
    db.prepare('UPDATE loans SET remaining = ?, status = ?, due_at = ? WHERE id = ?')
      .run(remaining, status, dueAt, id);
  }

  due(now: string, companyId?: number): LoanRow[] {
    return (companyId === undefined
      ? db.prepare("SELECT * FROM loans WHERE status = 'active' AND due_at IS NOT NULL AND due_at <= ?").all(now)
      : db.prepare("SELECT * FROM loans WHERE status = 'active' AND due_at IS NOT NULL AND due_at <= ? AND company_id = ?")
        .all(now, companyId)) as unknown as LoanRow[];
  }
}

export const loanRepository = new LoanRepository();
