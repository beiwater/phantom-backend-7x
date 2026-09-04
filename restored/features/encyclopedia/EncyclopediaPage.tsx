/**
 * Root Encyclopedia Page
 * Reconstructed from index-cgzgptQ8.js offsets 4068000-4085000
 */

import React from 'react';
import { useEncyclopedia } from './useEncyclopedia.ts';
import { EncyclopediaCategoryList } from './EncyclopediaCategoryList.tsx';
import { EncyclopediaResourceDetail } from './EncyclopediaResourceDetail.tsx';
import { EncyclopediaBuildingDetail } from './EncyclopediaBuildingDetail.tsx';
import type { ResourceDefinition, BuildingDefinition } from '../../shared/types.ts';

export interface EncyclopediaPageProps {
  realmId?: number;
  initialResources: ResourceDefinition[];
  initialBuildings: BuildingDefinition[];
}

export const EncyclopediaPage: React.FC<EncyclopediaPageProps> = ({
  realmId = 0,
  initialResources,
  initialBuildings
}) => {
  const {
    state,
    filteredResources,
    setSearchQuery,
    setActiveCategory,
    setSelectedResource,
    setSelectedBuilding,
    calculateCostBreakdown
  } = useEncyclopedia(realmId, initialResources, initialBuildings);

  // If a resource is selected, render detail view
  if (state.selectedResourceId !== null) {
    const resource = state.resources.find(r => r.dbLetter === state.selectedResourceId);
    if (resource) {
      const building = state.buildings.find(b => b.dbLetter === resource.producedAt);
      const costBreakdown = calculateCostBreakdown(resource, building);
      return (
        <EncyclopediaResourceDetail
          resource={resource}
          building={building}
          costBreakdown={costBreakdown}
          onSelectBuilding={kind => setSelectedBuilding(kind)}
          onBack={() => setSelectedResource(null)}
        />
      );
    }
  }

  // If a building is selected, render building detail view
  if (state.selectedBuildingKind !== null) {
    const building = state.buildings.find(b => b.dbLetter === state.selectedBuildingKind);
    if (building) {
      return (
        <EncyclopediaBuildingDetail
          building={building}
          allResources={state.resources}
          onSelectResource={id => setSelectedResource(id)}
          onBack={() => setSelectedBuilding(null)}
        />
      );
    }
  }

  return (
    <div className="encyclopedia-portal max-w-6xl mx-auto py-6 px-4">
      {/* Header & Search */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Industry Encyclopedia
          </h1>
          <p className="text-sm text-gray-500">
            Comprehensive production recipes, building specifications, and market unit economics.
          </p>
        </div>
        <div className="w-full md:w-72">
          <input
            type="text"
            placeholder="Search resources by name or ID..."
            value={state.searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:border-gray-700"
          />
        </div>
      </div>

      {/* Industrial Sectors */}
      <EncyclopediaCategoryList
        activeCategory={state.activeCategory}
        onSelectCategory={setActiveCategory}
      />

      {/* Resource Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filteredResources.map(resource => (
          <button
            key={resource.dbLetter}
            type="button"
            onClick={() => setSelectedResource(resource.dbLetter)}
            className="p-3 bg-white dark:bg-gray-800 rounded-lg border hover:border-blue-500 hover:shadow-md transition text-left flex flex-col justify-between"
          >
            <div>
              <div className="text-xs font-semibold text-gray-400 mb-1">
                #{resource.dbLetter}
              </div>
              <div className="font-medium text-sm text-gray-900 dark:text-white line-clamp-2">
                {resource.name}
              </div>
            </div>
            <div className="mt-3 text-xs text-gray-500 flex justify-between items-center">
              <span>{resource.producedPerHourRaw} /hr</span>
              {resource.unitsSoldAnHour > 0 && (
                <span className="text-green-600 font-semibold">Retail</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
