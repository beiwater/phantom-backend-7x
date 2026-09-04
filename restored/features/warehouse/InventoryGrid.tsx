/**
 * Warehouse Inventory Grid Component
 */

import React from 'react';
import type { WarehouseItem } from '../../api/warehouse-api.ts';

export interface InventoryGridProps {
  items: WarehouseItem[];
  onSelectItem?: (item: WarehouseItem) => void;
}

export const InventoryGrid: React.FC<InventoryGridProps> = ({ items, onSelectItem }) => {
  if (items.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">Warehouse is currently empty.</div>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {items.map(item => (
        <div
          key={`${item.resourceId}-${item.quality}`}
          onClick={() => onSelectItem?.(item)}
          className="p-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm hover:border-blue-500 transition cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-gray-400 font-bold">#{item.resourceId}</span>
              {item.quality > 0 && (
                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 px-1 rounded">
                  q{item.quality}
                </span>
              )}
            </div>
            <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">
              {item.name || `Resource #${item.resourceId}`}
            </div>
          </div>

          <div className="mt-3 pt-2 border-t dark:border-gray-700 flex justify-between items-center text-xs">
            <span className="font-bold text-gray-800 dark:text-gray-200">{item.amount.toLocaleString()}</span>
            <span className="text-gray-400 text-[10px]">${item.averageCost.toFixed(2)}/u</span>
          </div>
        </div>
      ))}
    </div>
  );
};
