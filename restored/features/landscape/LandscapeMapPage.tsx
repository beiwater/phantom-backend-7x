/**
 * Root Landscape City Map Page
 */

import React from 'react';
import { useLandscape } from './useLandscape.ts';
import { ConstructionModal } from './ConstructionModal.tsx';
import type { PlayerBuilding } from '../../shared/types.ts';

export interface LandscapeMapPageProps {
  companyId: number;
  onOpenBuilding: (building: PlayerBuilding) => void;
}

export const LandscapeMapPage: React.FC<LandscapeMapPageProps> = ({ companyId, onOpenBuilding }) => {
  const {
    state,
    gridSlots,
    openConstruction,
    closeConstruction,
    constructBuilding
  } = useLandscape(companyId);

  if (state.loading) {
    return <div className="p-8 text-center text-gray-500">Surveying city terrain & facilities...</div>;
  }

  return (
    <div className="landscape-map-page max-w-6xl mx-auto py-6 px-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Corporate Territory & Facilities</h1>
          <p className="text-sm text-gray-500">
            Expand your industrial empire across plots. Click any facility to manage operations.
          </p>
        </div>
        <div className="text-sm font-semibold text-gray-500">
          Occupied: {state.buildings.length} / {gridSlots.filter(s => s.isUnlocked).length} Slots
        </div>
      </div>

      {/* Grid of Plots */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
        {gridSlots.map(slot => (
          <div
            key={slot.position}
            className={`h-36 rounded-xl border-2 transition p-3 flex flex-col justify-between ${
              slot.building
                ? 'bg-white dark:bg-gray-800 border-blue-400/80 shadow-md cursor-pointer hover:scale-[1.02]'
                : slot.isUnlocked
                ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-dashed border-emerald-300 dark:border-emerald-800 cursor-pointer hover:bg-emerald-100/50'
                : 'bg-gray-100 dark:bg-gray-800/30 border-gray-300 dark:border-gray-700 cursor-not-allowed opacity-50'
            }`}
            onClick={() => {
              if (slot.building) onOpenBuilding(slot.building);
              else if (slot.isUnlocked) openConstruction(slot.position);
            }}
          >
            {slot.building ? (
              <>
                <div className="flex justify-between items-start">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                    Level {slot.building.size}
                  </span>
                  <span className="text-[10px] text-gray-400 uppercase font-mono">{slot.building.kind}</span>
                </div>
                <div className="font-bold text-sm text-gray-900 dark:text-white line-clamp-2">
                  {slot.building.name}
                </div>
                <div className="text-[11px] text-gray-400 capitalize">{slot.building.category}</div>
              </>
            ) : slot.isUnlocked ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <span className="text-2xl text-emerald-600 mb-1">+</span>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Empty Plot</span>
                <span className="text-[10px] text-gray-400">Click to Build</span>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
                <span className="text-lg">🔒</span>
                <span className="text-xs font-semibold">Locked</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <ConstructionModal
        isOpen={state.isConstructing}
        position={state.targetSlotPosition}
        onClose={closeConstruction}
        onSelectBuilding={constructBuilding}
      />
    </div>
  );
};
