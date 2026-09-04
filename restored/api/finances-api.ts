/**
 * Financial Statements API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface BalanceSheetData {
  currentAssets: {
    cash: number;
    inventoryValue: number;
    receivables: number;
    total: number;
  };
  fixedAssets: {
    buildingsCost: number;
    patentsValue: number;
    total: number;
  };
  liabilities: {
    bondsIssued: number;
    payables: number;
    total: number;
  };
  equity: {
    retainedEarnings: number;
    totalNetWorth: number;
  };
}

export interface IncomeStatementData {
  revenue: {
    marketSales: number;
    contractSales: number;
    retailSales: number;
    totalRevenue: number;
  };
  expenses: {
    costOfGoodsSold: number;
    wages: number;
    administrationOverhead: number;
    marketFees: number;
    bondInterest: number;
    totalExpenses: number;
  };
  netIncome: number;
}

export interface CashflowStatementData {
  operatingActivities: number;
  investingActivities: number;
  financingActivities: number;
  netCashFlow: number;
  endingCash: number;
}

export const financesApi = {
  async fetchBalanceSheet(companyId: number | string): Promise<BalanceSheetData> {
    const res = await httpClient.get<BalanceSheetData>(Routes.api.finances.balanceSheet(companyId));
    return res.data;
  },

  async fetchIncomeStatement(companyId: number | string): Promise<IncomeStatementData> {
    const res = await httpClient.get<IncomeStatementData>(Routes.api.finances.incomeStatement(companyId));
    return res.data;
  },

  async fetchCashflowStatement(companyId: number | string): Promise<CashflowStatementData> {
    const res = await httpClient.get<CashflowStatementData>(Routes.api.finances.cashflowStatement(companyId));
    return res.data;
  }
};
