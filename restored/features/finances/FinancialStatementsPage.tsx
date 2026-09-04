/**
 * Root Financial Statements Page
 */

import React from 'react';
import { useFinances } from './useFinances.ts';
import { BalanceSheetView } from './BalanceSheetView.tsx';
import { IncomeStatementView } from './IncomeStatementView.tsx';
import { CashFlowView } from './CashFlowView.tsx';

export interface FinancialStatementsPageProps {
  companyId: number;
}

export const FinancialStatementsPage: React.FC<FinancialStatementsPageProps> = ({ companyId }) => {
  const { state, setTab } = useFinances(companyId);

  if (state.loading) {
    return <div className="p-8 text-center text-gray-500">Auditing corporate ledger & statements...</div>;
  }

  if (state.error) {
    return <div className="p-8 text-center text-red-500">{state.error}</div>;
  }

  return (
    <div className="finances-page max-w-5xl mx-auto py-6 px-4">
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Corporate Financial Accounting</h1>
          <p className="text-sm text-gray-500">
            Real-time balance sheet, cash flows, and operating profitability analysis.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab('balance_sheet')}
            className={`px-3 py-1.5 rounded-md transition ${
              state.currentTab === 'balance_sheet'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Balance Sheet
          </button>
          <button
            type="button"
            onClick={() => setTab('income_statement')}
            className={`px-3 py-1.5 rounded-md transition ${
              state.currentTab === 'income_statement'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Income Statement
          </button>
          <button
            type="button"
            onClick={() => setTab('cash_flow')}
            className={`px-3 py-1.5 rounded-md transition ${
              state.currentTab === 'cash_flow'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Cash Flow
          </button>
        </div>
      </div>

      {state.currentTab === 'balance_sheet' && state.balanceSheet && (
        <BalanceSheetView data={state.balanceSheet} />
      )}

      {state.currentTab === 'income_statement' && state.incomeStatement && (
        <IncomeStatementView data={state.incomeStatement} />
      )}

      {state.currentTab === 'cash_flow' && state.cashflowStatement && (
        <CashFlowView data={state.cashflowStatement} />
      )}
    </div>
  );
};
