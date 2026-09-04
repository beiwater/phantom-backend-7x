/**
 * Root Market Exchange Page
 */

import React, { useState } from 'react';
import { useMarket } from './useMarket.ts';
import { OrderBookView } from './OrderBookView.tsx';

export interface MarketExchangePageProps {
  realmId?: number;
}

export const MarketExchangePage: React.FC<MarketExchangePageProps> = ({ realmId = 0 }) => {
  const { state, selectResource, takeOrder, postOrder } = useMarket(realmId, 3);
  const [postAmount, setPostAmount] = useState(100);
  const [postPrice, setPostPrice] = useState(10);
  const [postQuality, setPostQuality] = useState(0);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (postAmount <= 0 || postPrice <= 0) return;
    await postOrder(postAmount, postPrice, postQuality);
  };

  return (
    <div className="market-exchange-page max-w-6xl mx-auto py-6 px-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Commodity Exchange Market</h1>
          <p className="text-sm text-gray-500">
            Real-time public order book trading with 4% transaction fee.
          </p>
        </div>
      </div>

      {/* Post New Order Form */}
      <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700">
        <h3 className="font-bold text-sm mb-3">Place Sell Order to Public Exchange</h3>
        <form onSubmit={handlePost} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold mb-1">Resource ID</label>
            <input
              type="number"
              value={state.selectedResourceId}
              onChange={e => selectResource(Number(e.target.value))}
              className="w-full border rounded p-2 text-sm dark:bg-gray-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Quantity</label>
            <input
              type="number"
              min={1}
              value={postAmount}
              onChange={e => setPostAmount(Number(e.target.value))}
              className="w-full border rounded p-2 text-sm dark:bg-gray-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Unit Price ($)</label>
            <input
              type="number"
              step={0.01}
              min={0.01}
              value={postPrice}
              onChange={e => setPostPrice(Number(e.target.value))}
              className="w-full border rounded p-2 text-sm dark:bg-gray-700"
            />
          </div>
          <button
            type="submit"
            disabled={state.submitting}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm disabled:opacity-50"
          >
            {state.submitting ? 'Posting...' : 'List on Market'}
          </button>
        </form>
      </div>

      {/* Order Book */}
      <h3 className="font-bold text-base mb-3 text-gray-900 dark:text-white">
        Live Order Book for Resource #{state.selectedResourceId}
      </h3>
      <OrderBookView
        orders={state.orderBook}
        onTakeOrder={takeOrder}
        isSubmitting={state.submitting}
      />
    </div>
  );
};
