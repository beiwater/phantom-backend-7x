/**
 * Dedicated Sales Office Component (Aerospace Contracts)
 * Reconstructed from index-cgzgptQ8.js offsets 4918500-4925000, 4983000-4985000
 */

import React, { useState } from 'react';
import type { PlayerBuilding, SalesOrder } from '../../shared/types.ts';

export interface SalesOfficeBuildingProps {
  building: PlayerBuilding;
  orders: SalesOrder[];
  isSearching: boolean;
  onFindCustomer: () => Promise<void>;
  onDeliverOrder: (orderId: number, lowestQualityFirst: boolean) => Promise<unknown>;
  onRejectOrder: (orderId: number) => Promise<void>;
}

export const SalesOfficeBuilding: React.FC<SalesOfficeBuildingProps> = ({
  building,
  orders,
  isSearching,
  onFindCustomer,
  onDeliverOrder,
  onRejectOrder
}) => {
  const [lowestQualityFirst, setLowestQualityFirst] = useState<boolean>(true);
  const [actionInProgress, setActionInProgress] = useState<number | null>(null);

  const handleDeliver = async (orderId: number) => {
    setActionInProgress(orderId);
    try {
      await onDeliverOrder(orderId, lowestQualityFirst);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (orderId: number) => {
    setActionInProgress(orderId);
    try {
      await onRejectOrder(orderId);
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="sales-office-container p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Sales Office (Level {building.size})
          </h2>
          <p className="text-sm text-gray-500">
            Source aerospace orders and deliver high-value contracts directly to clients.
          </p>
        </div>
        <button
          type="button"
          onClick={onFindCustomer}
          disabled={isSearching}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded text-sm disabled:opacity-50"
        >
          {isSearching ? 'Searching for Client...' : 'Search for Customer'}
        </button>
      </div>

      <div className="delivery-preferences mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded flex items-center justify-between text-sm">
        <span className="font-medium">Inventory Delivery Preference:</span>
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={lowestQualityFirst}
            onChange={e => setLowestQualityFirst(e.target.checked)}
            className="rounded text-indigo-600"
          />
          <span>Deliver lowest quality available first</span>
        </label>
      </div>

      {/* Orders List */}
      <div className="orders-section">
        <h3 className="text-md font-semibold mb-3">Active Customer Orders ({orders.length})</h3>
        {orders.length === 0 ? (
          <div className="text-center py-8 text-gray-400 border border-dashed rounded">
            No active contracts found. Click &quot;Search for Customer&quot; to source new orders.
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map(order => (
              <div
                key={order.id}
                className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
              >
                <div>
                  <div className="font-bold text-base text-gray-900 dark:text-white">
                    {order.resourceName || `Resource #${order.resourceId}`}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    Demand: <span className="font-semibold">{order.amount} units</span> (Min Quality: q{order.quality})
                  </div>
                  <div className="text-sm text-green-600 dark:text-green-400 font-semibold">
                    Offer Price: ${(order.price * order.amount).toLocaleString()} (${order.price.toFixed(2)}/unit)
                  </div>
                </div>

                <div className="flex items-center space-x-3 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={() => handleDeliver(order.id)}
                    disabled={actionInProgress === order.id}
                    className="flex-1 md:flex-initial px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded disabled:opacity-50"
                  >
                    {actionInProgress === order.id ? 'Fulfilling...' : 'Fulfill Contract'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(order.id)}
                    disabled={actionInProgress === order.id}
                    className="flex-1 md:flex-initial px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded border border-red-300"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
