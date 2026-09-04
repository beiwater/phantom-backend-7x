/**
 * Construction Building Selection Modal
 */

import React from 'react';

export interface ConstructionOption {
  kind: string;
  name: string;
  category: string;
  costUnits: number;
}

export interface ConstructionModalProps {
  isOpen: boolean;
  position: string | null;
  onClose: () => void;
  onSelectBuilding: (kind: string) => Promise<void>;
}

const AVAILABLE_BUILDINGS: ConstructionOption[] = [
  { kind: 'P', name: 'Plantation', category: 'production', costUnits: 4 },
  { kind: 'F', name: 'Factory', category: 'production', costUnits: 5 },
  { kind: 'M', name: 'Mine', category: 'production', costUnits: 6 },
  { kind: 'G', name: 'Grocery Store', category: 'sales', costUnits: 3 },
  { kind: 'A', name: 'Gas Station', category: 'sales', costUnits: 7 },
  { kind: 'C', name: 'Electronics Store', category: 'sales', costUnits: 5 },
  { kind: 'H', name: 'Fashion Store', category: 'sales', costUnits: 5 },
  { kind: 'd', name: 'Hardware Store', category: 'sales', costUnits: 4 },
  { kind: 'B', name: 'Sales Offices', category: 'sales', costUnits: 18 },
  { kind: 'r', name: 'Restaurant', category: 'sales', costUnits: 26 }
];

export const ConstructionModal: React.FC<ConstructionModalProps> = ({
  isOpen,
  position,
  onClose,
  onSelectBuilding
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl max-w-2xl w-full border dark:border-gray-700 max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b pb-3 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Construct New Facility</h3>
            <span className="text-xs text-gray-500">Target Plot: {position}</span>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3 p-1">
          {AVAILABLE_BUILDINGS.map(b => (
            <button
              key={b.kind}
              type="button"
              onClick={() => onSelectBuilding(b.kind)}
              className="p-3 border rounded-lg hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-gray-700/50 transition text-left flex justify-between items-center"
            >
              <div>
                <div className="font-semibold text-sm text-gray-900 dark:text-white">{b.name}</div>
                <div className="text-xs text-gray-400 capitalize">{b.category} • Cost: {b.costUnits * 3450} $</div>
              </div>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">Build</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
