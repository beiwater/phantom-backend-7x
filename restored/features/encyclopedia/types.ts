/**
 * Encyclopedia Feature Types
 */

import type { ResourceDefinition, BuildingDefinition, ResourceRetailInfo } from '../../shared/types.ts';

export type EncyclopediaViewMode = 'categories' | 'resources' | 'buildings' | 'resource_detail' | 'building_detail';

export interface EncyclopediaState {
  realmId: number;
  activeCategory: string | null;
  searchQuery: string;
  selectedResourceId: number | null;
  selectedBuildingKind: string | null;
  selectedQuality: number;
  loading: boolean;
  error: string | null;

  // Data collections
  resources: ResourceDefinition[];
  buildings: BuildingDefinition[];
  retailInfo: Record<number, ResourceRetailInfo>;
  tickerPrices: Record<number, number>;
  adminOverhead: number;
}

export interface ResourceCostBreakdown {
  rawMaterialCost: number;
  laborCost: number;
  administrationCost: number;
  totalProductionCost: number;
  marketPrice: number;
  estimatedProfit: number;
}
