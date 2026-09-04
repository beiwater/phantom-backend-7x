/**
 * Encyclopedia Building Detail View
 * Reconstructed from index-cgzgptQ8.js offset ~4071500
 */

import React from 'react';
import { AVERAGE_SALARY, RETAIL_BUILDING_RESOURCES } from '../../shared/game-constants.ts';
import type { BuildingDefinition, ResourceDefinition } from '../../shared/types.ts';

export interface EncyclopediaBuildingDetailProps {
  building: BuildingDefinition;
  allResources: ResourceDefinition[];
  onSelectResource: (resourceId: number) => void;
  onBack: () => void;
}

export const EncyclopediaBuildingDetail: React.FC<EncyclopediaBuildingDetailProps> = ({
  building,
  allResources,
  onSelectResource,
  onBack
}) => {
  // Find resources produced or sold here
  const products = allResources.filter(r => r.producedAt === building.dbLetter);
  const retailProductIds = RETAIL_BUILDING_RESOURCES[building.dbLetter] || [];
  const retailProducts = allResources.filter(r => retailProductIds.includes(r.dbLetter));

  const baseWagePerHour = AVERAGE_SALARY * building.salaryModifier;

  return (
    <div className="building-detail-view p-6 bg-white dark:bg-gray-800 rounded-lg shadow max-w-4xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
      >
        ← Back to Catalog
      </button>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6 border-b pb-4">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center font-bold text-xl text-blue-600">
          {building.dbLetter}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{building.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 rounded capitalize">
              Category: {building.category}
            </span>
            <span className="text-xs text-gray-500">
              Construction Units: {building.costUnits}
            </span>
          </div>
        </div>
      </div>

      {/* Building Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded border">
          <div className="text-xs text-gray-500 mb-1">Base Wage per Level</div>
          <div className="text-lg font-bold text-gray-800 dark:text-gray-100">
            ${baseWagePerHour.toFixed(2)}/hr
          </div>
          <div className="text-xs text-gray-400">Modifier: {building.salaryModifier}x</div>
        </div>
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded border">
          <div className="text-xs text-gray-500 mb-1">Upgrade Tiers</div>
          <div className="text-lg font-bold text-gray-800 dark:text-gray-100">
            {building.tiers.length > 0 ? building.tiers.join(', ') : 'Standard scaling'}
          </div>
          <div className="text-xs text-gray-400">Level thresholds</div>
        </div>
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded border">
          <div className="text-xs text-gray-500 mb-1">Cataloged Products</div>
          <div className="text-lg font-bold text-gray-800 dark:text-gray-100">
            {products.length > 0 ? products.length : retailProducts.length} Items
          </div>
          <div className="text-xs text-gray-400">Production / Sales catalog</div>
        </div>
      </div>

      {/* Production or Retail Items */}
      {products.length > 0 && (
        <div className="mb-6">
          <h3 className="text-md font-bold mb-3">Manufacturing Output</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {products.map(product => (
              <button
                key={product.dbLetter}
                type="button"
                onClick={() => onSelectResource(product.dbLetter)}
                className="p-3 border rounded-lg text-left hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-gray-700 transition"
              >
                <div className="font-semibold text-sm">{product.name}</div>
                <div className="text-xs text-gray-500">
                  Rate: {product.producedPerHourRaw} units/hr
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {retailProducts.length > 0 && (
        <div>
          <h3 className="text-md font-bold mb-3">Authorized Retail Inventory</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {retailProducts.map(product => (
              <button
                key={product.dbLetter}
                type="button"
                onClick={() => onSelectResource(product.dbLetter)}
                className="p-3 border rounded-lg text-left hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-gray-700 transition"
              >
                <div className="font-semibold text-sm">{product.name}</div>
                <div className="text-xs text-green-600 font-medium">
                  Base Demand: {product.unitsSoldAnHour} units/hr
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
