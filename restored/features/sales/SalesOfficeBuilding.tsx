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

      <div className="delivery-preferences mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
        <span className="font-medium text-gray-700 dark:text-gray-200">Aerospace Inventory Delivery Priority:</span>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="radio"
              name="qualityPreference"
              checked={!lowestQualityFirst}
              onChange={() => setLowestQualityFirst(false)}
              className="text-indigo-600"
            />
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Highest Quality (Earn Bonus)</span>
          </label>
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="radio"
              name="qualityPreference"
              checked={lowestQualityFirst}
              onChange={() => setLowestQualityFirst(true)}
              className="text-indigo-600"
            />
            <span>Lowest Quality First</span>
          </label>
        </div>
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
            {orders.map((rawOrder: any) => {
              const resId = rawOrder.resourceId ?? rawOrder.resource?.kind ?? rawOrder.resources?.[0]?.kind ?? 0;
              const units = rawOrder.amount ?? rawOrder.units ?? rawOrder.resources?.[0]?.amount ?? 1;
              const unitPrice = rawOrder.price ?? rawOrder.sellingPrice ?? rawOrder.resources?.[0]?.price ?? 0;
              const qual = rawOrder.quality ?? rawOrder.resource?.quality ?? 0;
              const resName = rawOrder.resourceName || (
                resId === 94 ? 'BFR (Big Falcon Rocket)' :
                resId === 91 ? 'Sub-Orbital Rocket' :
                resId === 95 ? 'Jumbo Jet' :
                resId === 96 ? 'Luxury Jet' :
                resId === 97 ? 'Single Engine Plane' :
                resId === 99 ? 'Satellite' :
                `Resource #${resId}`
              );
              return (
              <div
                key={rawOrder.id}
                className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm"
              >
                <div>
                  <div className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2">
                    <span>🚀</span>
                    <span>{resName}</span>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    Demand: <span className="font-semibold text-gray-900 dark:text-white">{units} units</span> (Min Quality: q{qual})
                  </div>
                  <div className="text-sm text-green-600 dark:text-green-400 font-semibold">
                    Contract Total: ${(unitPrice * units).toLocaleString()} (${unitPrice.toLocaleString()}/unit)
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Term: 47h validity • Delivered from warehouse inventory
                  </div>
                </div>
                <div className="flex items-center space-x-3 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={() => handleDeliver(rawOrder.id)}
                    disabled={actionInProgress === rawOrder.id}
                    className="flex-1 md:flex-initial px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded disabled:opacity-50"
                  >
                    {actionInProgress === order.id ? 'Fulfilling...' : 'Fulfill Contract'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(rawOrder.id)}
                    disabled={actionInProgress === rawOrder.id}
                    className="flex-1 md:flex-initial px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded border border-red-300"
                  >
                    Reject
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
