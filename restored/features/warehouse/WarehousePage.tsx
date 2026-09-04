/**
 * Root Warehouse & B2B Contracts Page
 */

import React from 'react';
import { useWarehouse } from './useWarehouse.ts';
import { InventoryGrid } from './InventoryGrid.tsx';

export interface WarehousePageProps {
  companyId: number;
}

export const WarehousePage: React.FC<WarehousePageProps> = ({ companyId }) => {
  const { state, filteredItems, setSearchQuery, acceptContract, rejectContract } = useWarehouse(companyId);

  if (state.loading) {
    return <div className="p-8 text-center text-gray-500">Checking inventory records...</div>;
  }

  return (
    <div className="warehouse-page max-w-6xl mx-auto py-6 px-4">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Central Warehouse</h1>
          <p className="text-sm text-gray-500">
            Stored inventory commodities, raw materials, and pending direct business contracts.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Search stock..."
            value={state.searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:border-gray-700"
          />
        </div>
      </div>

      {/* Incoming B2B Contracts Section */}
      {state.incomingContracts.length > 0 && (
        <div className="mb-8 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 rounded-lg">
          <h3 className="font-bold text-sm text-blue-900 dark:text-blue-200 mb-3">
            Pending Incoming Contracts ({state.incomingContracts.length})
          </h3>
          <div className="space-y-2">
            {state.incomingContracts.map(c => (
              <div
                key={c.id}
                className="p-3 bg-white dark:bg-gray-800 rounded border dark:border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-sm"
              >
                <div>
                  <span className="font-semibold text-gray-900 dark:text-white">{c.senderCompanyName}</span> offers{' '}
                  <span className="font-bold">{c.amount} units</span> of Resource #{c.resourceId} (q{c.quality}) @{' '}
                  <span className="text-emerald-600 font-bold">${c.price.toFixed(2)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => acceptContract(c.id)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectContract(c.id)}
                    className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold rounded"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warehouse Stock Grid */}
      <h3 className="font-bold text-base mb-3 text-gray-900 dark:text-white">
        Physical Stock Inventory ({filteredItems.length} Commodities)
      </h3>
      <InventoryGrid items={filteredItems} />
    </div>
  );
};
