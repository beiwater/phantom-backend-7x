// Compatibility exports; application owns the only mutation implementation.
export { getActiveLoans, takeLoan, repayLoan, settleDueLoans } from '../application/finance/loan-use-cases.ts';
export type { LoanRow } from '../repositories/loan-repository.ts';
