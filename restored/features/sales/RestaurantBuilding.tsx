/**
 * Dedicated Restaurant Building Component
 * Reconstructed from index-cgzgptQ8.js offsets 4899500-4902000
 */

import React, { useState } from 'react';
import type { PlayerBuilding, RestaurantProperties, RestaurantRun } from '../../shared/types.ts';

export interface RestaurantBuildingProps {
  building: PlayerBuilding;
  properties: RestaurantProperties | null;
  runs: RestaurantRun[];
  onUpdateProperties: (props: Partial<RestaurantProperties>) => Promise<unknown>;
  onToggleRun: (open: boolean) => Promise<unknown>;
}

export const RestaurantBuilding: React.FC<RestaurantBuildingProps> = ({
  building,
  properties,
  runs,
  onUpdateProperties,
  onToggleRun
}) => {
  const currentOpen = properties?.keepOpen ?? properties?.isOpen ?? false;
  const [isOpen, setIsOpen] = useState<boolean>(currentOpen);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  React.useEffect(() => {
    setIsOpen(properties?.keepOpen ?? properties?.isOpen ?? false);
  }, [properties?.keepOpen, properties?.isOpen]);

  const handleToggleOpen = async () => {
    setIsUpdating(true);
    setErrorMessage(null);
    try {
      const next = !isOpen;
      await onToggleRun(next);
      setIsOpen(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update restaurant cycle';
      setErrorMessage(msg);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="restaurant-container p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Restaurant (Level {building.size})
          </h2>
          <p className="text-sm text-gray-500">
            Current Rating: <span className="font-semibold text-yellow-500">{properties?.rating.toFixed(2) ?? 'N/A'} ★</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggleOpen}
          disabled={isUpdating}
          className={`px-4 py-2 text-white font-medium rounded text-sm ${
            isOpen ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {isUpdating ? 'Updating...' : isOpen ? 'Close Restaurant' : 'Open Restaurant'}
        </button>
      </div>

      {/* Property Controls: Seating & Staff */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded border">
          <h4 className="font-semibold text-sm mb-2">Seating Capacity</h4>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            {properties?.seatingCapacity ?? 100 * building.size} Seats
          </p>
          <span className="text-xs text-gray-500">Scales directly with building level</span>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded border">
          <h4 className="font-semibold text-sm mb-2">Staff Level</h4>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            Level {properties?.staffLevel ?? 1}
          </p>
          <span className="text-xs text-gray-500">Higher staff levels improve service rating</span>
        </div>
      </div>

      {/* Run History */}
      <div className="runs-history">
        <h3 className="text-md font-semibold mb-3">Service Shift History</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No shift records available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100 dark:bg-gray-700 text-xs uppercase">
                <tr>
                  <th className="p-2">Ended</th>
                  <th className="p-2">Customers</th>
                  <th className="p-2">Revenue</th>
                  <th className="p-2">Cost</th>
                  <th className="p-2">Net Profit</th>
                  <th className="p-2">Rating Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {runs.slice(0, 5).map(run => (
                  <tr key={run.id}>
                    <td className="p-2">{new Date(run.endedAt).toLocaleDateString()}</td>
                    <td className="p-2">{run.customersServed}</td>
                    <td className="p-2 text-green-600 font-medium">${run.revenue.toLocaleString()}</td>
                    <td className="p-2 text-red-600 font-medium">${run.cost.toLocaleString()}</td>
                    <td className="p-2 font-bold">${run.profit.toLocaleString()}</td>
                    <td className="p-2">{run.ratingDelta > 0 ? `+${run.ratingDelta}` : run.ratingDelta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
