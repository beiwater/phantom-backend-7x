/**
 * Income Statement View Component
 */

import React from 'react';
import type { IncomeStatementData } from '../../api/finances-api.ts';

export interface IncomeStatementViewProps {
  data: IncomeStatementData;
}

export const IncomeStatementView: React.FC<IncomeStatementViewProps> = ({ data }) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 border-b pb-2 dark:border-gray-700">
        Income Statement (利润表)
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
        {/* Revenue */}
        <div>
          <h4 className="font-semibold text-gray-500 uppercase text-xs mb-3">Operating Revenue (营业收入)</h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Exchange Market Sales:</span>
              <span>${data.revenue.marketSales.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Direct Contract Sales:</span>
              <span>${data.revenue.contractSales.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Retail Building Sales:</span>
              <span>${data.revenue.retailSales.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-bold text-emerald-600">
              <span>Total Revenue:</span>
              <span>${data.revenue.totalRevenue.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Operating Expenses */}
        <div>
          <h4 className="font-semibold text-gray-500 uppercase text-xs mb-3">Operating Expenses (营业费用)</h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Cost of Goods Sold (COGS):</span>
              <span>${data.expenses.costOfGoodsSold.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Facility Wages:</span>
              <span>${data.expenses.wages.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Administration Overhead:</span>
              <span>${data.expenses.administrationOverhead.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Exchange 4% Taxes & Fees:</span>
              <span>${data.expenses.marketFees.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Bond Interest Paid:</span>
              <span>${data.expenses.bondInterest.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-bold text-red-500">
              <span>Total Expenses:</span>
              <span>${data.expenses.totalExpenses.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex justify-between items-center text-lg font-extrabold">
        <span>Net Income (净收益):</span>
        <span className={data.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}>
          ${data.netIncome.toLocaleString()}
        </span>
      </div>
    </div>
  );
};
