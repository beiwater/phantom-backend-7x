/**
 * Shared Generic Retail Building Component
 * Reconstructed for: Grocery Store, Electronics Store, Gas Station,
 * Fashion Store, Hardware Store, Car Dealership, and Seasonal Shops.
 */

import React, { useState } from 'react';
import { RETAIL_BUILDING_RESOURCES } from '../../shared/game-constants.ts';
import type { PlayerBuilding, RetailTask } from '../../shared/types.ts';

export interface GenericRetailBuildingProps {
  building: PlayerBuilding;
  queue: RetailTask[];
  onStartSale: (resourceId: number, amount: number, price: number) => Promise<void>;
  onCancelSale: (taskId: number) => Promise<void>;
}

export const GenericRetailBuilding: React.FC<GenericRetailBuildingProps> = ({
  building,
  queue,
  onStartSale,
  onCancelSale
}) => {
  const sellableResourceIds = RETAIL_BUILDING_RESOURCES[building.kind] || [];
  const [selectedResource, setSelectedResource] = useState<number>(sellableResourceIds[0] ?? 0);
  const [amount, setAmount] = useState<number>(100);
  const [price, setPrice] = useState<number>(10);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleStartSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResource || amount <= 0 || price <= 0) return;
    setIsSubmitting(true);
    try {
      await onStartSale(selectedResource, amount, price);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="retail-building-container p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
      <div className="building-header mb-4 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {building.name || 'Retail Store'} (Level {building.size})
          </h2>
          <span className="text-sm text-gray-500">Retail Sales Queue</span>
        </div>
      </div>

      {/* Active Sales Queue */}
      <div className="active-queue mb-6">
        <h3 className="text-md font-semibold mb-2">Current Retail Orders</h3>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No retail operations currently running.</p>
        ) : (
          <div className="space-y-3">
            {queue.map(task => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded border"
              >
                <div>
                  <div className="font-medium text-sm">
                    Resource #{task.resourceId} — {task.amount} units @ ${task.price.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">Busy until: {new Date(task.busyUntil).toLocaleTimeString()}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onCancelSale(task.id)}
                  className="px-3 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Start New Retail Sale Form */}
      <form onSubmit={handleStartSale} className="border-t pt-4">
        <h3 className="text-md font-semibold mb-3">Start New Retail Operation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Select Product
            </label>
            <select
              value={selectedResource}
              onChange={e => setSelectedResource(Number(e.target.value))}
              className="w-full border rounded p-2 text-sm dark:bg-gray-700 dark:border-gray-600"
            >
              {sellableResourceIds.map(resId => (
                <option key={resId} value={resId}>
                  Resource ID #{resId}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="w-full border rounded p-2 text-sm dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Retail Price ($)
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={price}
              onChange={e => setPrice(Number(e.target.value))}
              className="w-full border rounded p-2 text-sm dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm disabled:opacity-50"
        >
          {isSubmitting ? 'Starting Sale...' : 'Begin Selling'}
        </button>
      </form>
    </div>
  );
};
