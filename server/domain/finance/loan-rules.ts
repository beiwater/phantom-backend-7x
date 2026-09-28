// Preserve existing private-server terms during #179's architecture migration.
// This cap is a server rule, not claimed as an observed official contract.
export const DEFAULT_INTEREST_RATE = 0.1;
export const LOAN_TERM_MS = 7 * 24 * 60 * 60 * 1000;

export function loanCap(level: number): number {
  return 2 * level * 50000;
}

export function balanceAfterDuePayment(owed: number, paid: number, rate: number): number {
  return Math.max(0, (owed - paid) * (1 + rate));
}
