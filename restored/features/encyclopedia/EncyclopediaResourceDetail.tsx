/**
 * Encyclopedia Resource Detail View
 * Reconstructed from index-cgzgptQ8.js offset ~4071500
 */

import React from 'react';
import type { ResourceDefinition, BuildingDefinition } from '../../shared/types.ts';
import type { ResourceCostBreakdown } from './types.ts';

export interface EncyclopediaResourceDetailProps {
  resource: ResourceDefinition;
  building?: BuildingDefinition;
  costBreakdown: ResourceCostBreakdown;
  onSelectBuilding: (buildingKind: string) => void;
  onBack: () => void;
}

export const EncyclopediaResourceDetail: React.FC<EncyclopediaResourceDetailProps> = ({
  resource,
  building,
  costBreakdown,
  onSelectBuilding,
  onBack
}) => {
  return (
    <div className="resource-detail-view p-6 bg-white dark:bg-gray-800 rounded-lg shadow max-w-4xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
      >
        ← Back to Catalog
      </button>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6 border-b pb-4">
        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center font-bold text-lg text-gray-500">
          #{resource.dbLetter}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{resource.name}</h2>
          <div className="text-sm text-gray-500">
            {resource.isResearch ? 'Patented Technology' : 'Commercial Commodity'}
            {resource.retailSeason && ` • Seasonal (Retail: ${resource.retailSeason})`}
          </div>
        </div>
      </div>

      {/* Production Specifications */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border">
          <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Production Specs</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-300">Producing Facility:</span>
              <button
                type="button"
                onClick={() => onSelectBuilding(resource.producedAt)}
                className="font-medium text-blue-600 hover:underline"
              >
                {building?.name || `Building '${resource.producedAt}'`}
              </button>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-300">Base Hourly Output:</span>
              <span className="font-semibold">{resource.producedPerHourRaw} units/hr</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-300">Transportation Units:</span>
              <span className="font-semibold">{resource.transportation} units</span>
            </div>
            {resource.unitsSoldAnHour > 0 && (
              <div className="flex justify-between text-green-600 font-medium">
                <span>Retail Base Demand:</span>
                <span>{resource.unitsSoldAnHour} units/hr</span>
              </div>
            )}
          </div>
        </div>

        {/* Financial Cost Breakdown */}
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border">
          <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Unit Economics Estimate</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-300">Raw Materials:</span>
              <span>${costBreakdown.rawMaterialCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-300">Labor Wages:</span>
              <span>${costBreakdown.laborCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-300">Admin Overhead:</span>
              <span>${costBreakdown.administrationCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-bold">
              <span>Total Production Cost:</span>
              <span>${costBreakdown.totalProductionCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-indigo-600 font-bold">
              <span>Market Reference Price:</span>
              <span>${costBreakdown.marketPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bill of Materials / Recipe */}
      <div className="recipe-section">
        <h3 className="text-md font-bold mb-3">Required Raw Materials (Recipe)</h3>
        {Object.keys(resource.producedFrom).length === 0 ? (
          <p className="text-sm text-gray-500 italic">Primary raw material (requires no inputs to produce).</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(resource.producedFrom).map(([inId, qty]) => (
              <div key={inId} className="p-3 border rounded bg-white dark:bg-gray-700 text-center">
                <div className="text-xs text-gray-500">Resource #{inId}</div>
                <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{qty}x</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
