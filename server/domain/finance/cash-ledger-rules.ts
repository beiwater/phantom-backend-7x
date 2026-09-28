export interface LedgerAggregate {
  total: number;
  byCategory: Record<string, number>;
  count: number;
}

export interface StatementWindow {
  rows: Array<{ amount: number; category: string }>;
  aggregate: LedgerAggregate;
  date: string;
  dateFrom: string;
}

/** Aggregate ledger rows by category. */
export function aggregateRows(rows: Array<{ amount: number; category: string }>): LedgerAggregate {
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    total += amount;
    byCategory[row.category] = (byCategory[row.category] || 0) + amount;
  }
  return { total, byCategory, count: rows.length };
}

/** Sum of income rows (positive amounts). Operates on raw rows: a category
 * bucket may net income+expense rows, which must not cancel here. */
export function sumPositive(rows: Array<{ amount: number }>): number {
  let sum = 0;
  for (const row of rows) {
    if (row.amount > 0) sum += row.amount;
  }
  return Math.round(sum * 100) / 100;
}

/** Sum of expense rows (negative amounts). Operates on raw rows. */
export function sumNegative(rows: Array<{ amount: number }>): number {
  let sum = 0;
  for (const row of rows) {
    if (row.amount < 0) sum += row.amount;
  }
  return Math.round(sum * 100) / 100;
}


/** Original-style snapshot date format: "2026-08-24 01:04:54.287288+00:00". */
export function formatSnapshotDate(created_at: string, snapshot_date: string): string {
  // Rebuild from the stored day key to a client-parseable format. The
  // original feeds a JS Date parser; keep an ISO-like tail.
  const time = created_at.slice(11) || '00:00:00.000000+00:00';
  return `${snapshot_date} ${time}`;
}
