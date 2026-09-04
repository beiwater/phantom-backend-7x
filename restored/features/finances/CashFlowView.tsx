/**
 * Cash Flow Statement View Component
 */

import React from 'react';
import type { CashflowStatementData } from '../../api/finances-api.ts';

export interface CashFlowViewProps {
  data: CashflowStatementData;
}

export const CashFlowView: React.FC<CashFlowViewProps> = ({ data }) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 border-b pb-2 dark:border-gray-700">
        Cash Flow Statement (现金流量表)
      </h3>

      <div className="max-w-xl mx-auto space-y-4 text-sm">
        <div className="flex justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
          <span>Net Cash from Operating Activities (经营活动):</span>
          <span className={`font-semibold ${data.operatingActivities >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            ${data.operatingActivities.toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
          <span>Net Cash from Investing Activities (投资活动):</span>
          <span className={`font-semibold ${data.investingActivities >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            ${data.investingActivities.toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
          <span>Net Cash from Financing Activities (筹资活动):</span>
          <span className={`font-semibold ${data.financingActivities >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            ${data.financingActivities.toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between p-4 border-t-2 text-base font-bold">
          <span>Net Change in Cash (现金净变动):</span>
          <span className={data.netCashFlow >= 0 ? 'text-emerald-600' : 'text-red-500'}>
            ${data.netCashFlow.toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg text-emerald-800 dark:text-emerald-200 text-lg font-extrabold">
          <span>Ending Cash Balance (期末流动现金):</span>
          <span>${data.endingCash.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};
