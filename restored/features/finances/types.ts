/**
 * Financial Statements Feature Types
 */

import type { BalanceSheetData, IncomeStatementData, CashflowStatementData } from '../../api/finances-api.ts';

export type FinanceTab = 'balance_sheet' | 'income_statement' | 'cash_flow';

export interface FinancesState {
  currentTab: FinanceTab;
  balanceSheet: BalanceSheetData | null;
  incomeStatement: IncomeStatementData | null;
  cashflowStatement: CashflowStatementData | null;
  loading: boolean;
  error: string | null;
}
