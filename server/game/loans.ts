import { db } from '../db/database.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';

// Assumption: a company may hold active loan principal up to 2x its level * 50000
// (level 5 starter => 500000 cap). No in-game reference exists yet; adjust here when
// a real economy model lands.
const LOAN_CAP_PER_LEVEL = 50000;
const LOAN_CAP_MULTIPLIER = 2;
const DEFAULT_INTEREST_RATE = 0.1;
const LOAN_TERM_DAYS = 7;

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

// Legacy DBs may predate the loans table (schema migrations are CREATE IF NOT EXISTS
// only, so a long-lived sqlite file won't have it). Defensive: lazily create on use.
function ensureTable() {
  try {
    db.prepare('SELECT 1 FROM loans LIMIT 1').get();
  } catch {
    db.exec(`
      CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        principal REAL,
        interest_rate REAL DEFAULT 0.1,
        remaining REAL,
        status TEXT DEFAULT 'active',
        created_at TEXT,
        due_at TEXT
      );
    `);
  }
}

function loanCap(companyLevel: number): number {
  return LOAN_CAP_MULTIPLIER * companyLevel * LOAN_CAP_PER_LEVEL;
}

function getCompanyLevel(companyId: number): number {
  const comp = getCompanyById(companyId);
  return comp ? (Number(comp.level) || 1) : 1;
}

function activePrincipal(companyId: number): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(remaining), 0) AS total FROM loans WHERE company_id = ? AND status = 'active'`
  ).get(companyId) as { total: number | null };
  return Number(row?.total) || 0;
}

export function getActiveLoans(companyId: number): LoanRow[] {
  ensureTable();
  settleDueLoans(companyId);
  const rows = db.prepare(
    `SELECT * FROM loans WHERE company_id = ? ORDER BY created_at ASC, id ASC`
  ).all(companyId) as unknown as LoanRow[];
  return rows;
}

export function takeLoan(companyId: number, amount: number) {
  ensureTable();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Loan amount must be positive');
  const comp = getCompanyById(companyId);
  if (!comp) throw new Error('Company not found');

  const cap = loanCap(getCompanyLevel(companyId));
  const current = activePrincipal(companyId);
  if (current + amt > cap) {
    throw new Error(`Loan cap exceeded: active principal ${current} + ${amt} > cap ${cap}`);
  }

  const now = new Date();
  const due = new Date(now.getTime() + LOAN_TERM_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const res = db.prepare(`
      INSERT INTO loans (company_id, principal, interest_rate, remaining, status, created_at, due_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(companyId, amt, DEFAULT_INTEREST_RATE, amt, now.toISOString(), due.toISOString());
    const loanId = Number(res.lastInsertRowid);
    const newMoney = updateCompanyMoney(companyId, amt);
    db.prepare('COMMIT').run();
    return { loanId, money: newMoney, cap, activePrincipal: current + amt };
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

export function repayLoan(companyId: number, loanId: number, amount: number) {
  ensureTable();
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) as unknown as LoanRow | undefined;
  if (!loan || loan.company_id !== companyId) throw new Error('Loan not found');
  if (loan.status !== 'active') throw new Error('Loan is not active');

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Repayment amount must be positive');

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    // Re-read inside the transaction to avoid paying down a loan another call just closed.
    const current = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) as unknown as LoanRow | undefined;
    if (!current || current.status !== 'active') throw new Error('Loan is not active');
    const pay = Math.min(amt, Number(current.remaining) || 0);
    const newMoney = updateCompanyMoney(companyId, -pay);
    const newRemaining = (Number(current.remaining) || 0) - pay;
    const status = newRemaining <= 0 ? 'repaid' : 'active';
    db.prepare('UPDATE loans SET remaining = ?, status = ? WHERE id = ?').run(newRemaining, status, loanId);
    db.prepare('COMMIT').run();
    return { loanId, paid: pay, remaining: newRemaining, status, money: newMoney };
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

// Lazy settlement: overdue active loans with remaining > 0 deduct what the company can
// afford from its money (updateCompanyMoney clamps at 0) and accrue one term of interest,
// pushing the due date forward. Settled loans never block reads.
export function settleDueLoans(companyId?: number) {
  ensureTable();
  const now = new Date().toISOString();
  const rows = (companyId !== undefined
    ? db.prepare(
        `SELECT * FROM loans WHERE status = 'active' AND due_at IS NOT NULL AND due_at <= ? AND company_id = ?`
      ).all(now, companyId)
    : db.prepare(
        `SELECT * FROM loans WHERE status = 'active' AND due_at IS NOT NULL AND due_at <= ?`
      ).all(now)
  ) as unknown as LoanRow[];

  for (const loan of rows) {
    if ((Number(loan.remaining) || 0) <= 0) {
      db.prepare(`UPDATE loans SET status = 'repaid' WHERE id = ?`).run(loan.id);
      continue;
    }
    const comp = getCompanyById(loan.company_id);
    const owed = Number(loan.remaining) || 0;
    const affordable = comp ? Math.min(owed, Number(comp.money) || 0) : 0;
    const rate = Number(loan.interest_rate) || DEFAULT_INTEREST_RATE;
    const nextDue = new Date(
      new Date(loan.due_at).getTime() + LOAN_TERM_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    db.prepare('BEGIN IMMEDIATE').run();
    try {
      if (affordable > 0) updateCompanyMoney(loan.company_id, -affordable);
      const newRemaining = owed - affordable + owed * rate;
      db.prepare('UPDATE loans SET remaining = ?, due_at = ? WHERE id = ?').run(newRemaining, nextDue, loan.id);
      db.prepare('COMMIT').run();
    } catch {
      db.prepare('ROLLBACK').run();
    }
  }
}
