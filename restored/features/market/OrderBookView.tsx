/**
 * Market Exchange Order Book Table Component
 */

import React from 'react';
import type { MarketOrder } from '../../api/market-api.ts';

export interface OrderBookViewProps {
  orders: MarketOrder[];
  onTakeOrder: (orderId: number, amount: number) => Promise<void>;
  isSubmitting: boolean;
}

export const OrderBookView: React.FC<OrderBookViewProps> = ({ orders, onTakeOrder, isSubmitting }) => {
  if (orders.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">No sell orders listed on exchange.</div>;
  }

  return (
    <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-100 dark:bg-gray-700/60 text-xs text-gray-500 uppercase">
          <tr>
            <th className="p-3">Seller</th>
            <th className="p-3">Quality</th>
            <th className="p-3">Quantity</th>
            <th className="p-3">Unit Price</th>
            <th className="p-3">Total Value</th>
            <th className="p-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {orders.map(o => (
            <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
              <td className="p-3 font-medium text-gray-900 dark:text-white">{o.companyName}</td>
              <td className="p-3">
                <span className="text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 px-1.5 py-0.5 rounded">
                  q{o.quality}
                </span>
              </td>
              <td className="p-3 font-semibold">{o.amount.toLocaleString()}</td>
              <td className="p-3 text-emerald-600 font-bold">${o.price.toFixed(2)}</td>
              <td className="p-3 text-gray-500">${(o.price * o.amount).toLocaleString()}</td>
              <td className="p-3 text-right">
                <button
                  type="button"
                  onClick={() => onTakeOrder(o.id, o.amount)}
                  disabled={isSubmitting}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded disabled:opacity-50"
                >
                  Buy All
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
