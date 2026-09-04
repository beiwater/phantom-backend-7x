/**
 * Custom Hook for Financial Statements
 */

import { useState, useEffect, useCallback } from 'react';
import { financesApi } from '../../api/finances-api.ts';
import type { FinancesState, FinanceTab } from './types.ts';

export function useFinances(companyId: number) {
  const [state, setState] = useState<FinancesState>({
    currentTab: 'balance_sheet',
    balanceSheet: null,
    incomeStatement: null,
    cashflowStatement: null,
    loading: true,
    error: null
  });

  const loadData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const [bs, is, cf] = await Promise.all([
        financesApi.fetchBalanceSheet(companyId),
        financesApi.fetchIncomeStatement(companyId),
        financesApi.fetchCashflowStatement(companyId)
      ]);
      setState(prev => ({
        ...prev,
        balanceSheet: bs,
        incomeStatement: is,
        cashflowStatement: cf,
        loading: false
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load financial statements' }));
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setTab = (tab: FinanceTab) => {
    setState(prev => ({ ...prev, currentTab: tab }));
  };

  return {
    state,
    setTab,
    reload: loadData
  };
}
