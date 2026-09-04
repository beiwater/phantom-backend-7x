/**
 * Balance Sheet View Component
 */

import React from 'react';
import type { BalanceSheetData } from '../../api/finances-api.ts';

export interface BalanceSheetViewProps {
  data: BalanceSheetData;
}

export const BalanceSheetView: React.FC<BalanceSheetViewProps> = ({ data }) => {
  return (
    <div className="space-y-6">
      {/* Assets */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 border-b pb-2 dark:border-gray-700">
          Assets (资产)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h4 className="font-semibold text-gray-500 uppercase text-xs mb-2">Current Assets (流动资产)</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Cash on Hand:</span>
                <span className="font-semibold text-emerald-600">${data.currentAssets.cash.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Warehouse Inventory Value:</span>
                <span>${data.currentAssets.inventoryValue.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Accounts Receivable:</span>
                <span>${data.currentAssets.receivables.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span>Total Current Assets:</span>
                <span>${data.currentAssets.total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-gray-500 uppercase text-xs mb-2">Fixed Assets (固定资产)</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Building Facilities Book Value:</span>
                <span>${data.fixedAssets.buildingsCost.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Patents & Research:</span>
                <span>${data.fixedAssets.patentsValue.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span>Total Fixed Assets:</span>
                <span>${data.fixedAssets.total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Liabilities & Equity */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 border-b pb-2 dark:border-gray-700">
          Liabilities & Equity (负债与所有者权益)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h4 className="font-semibold text-gray-500 uppercase text-xs mb-2">Liabilities (负债)</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Bonds Issued Outstanding:</span>
                <span className="text-red-500">${data.liabilities.bondsIssued.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Accounts Payable:</span>
                <span>${data.liabilities.payables.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span>Total Liabilities:</span>
                <span className="text-red-500">${data.liabilities.total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-gray-500 uppercase text-xs mb-2">Equity (所有者权益)</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Retained Earnings:</span>
                <span>${data.equity.retainedEarnings.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold text-indigo-600 text-base">
                <span>Total Net Worth:</span>
                <span>${data.equity.totalNetWorth.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
