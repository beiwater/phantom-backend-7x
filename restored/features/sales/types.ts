/**
 * Sales Feature Types
 */

import type { PlayerBuilding, RetailTask, SalesOrder, RestaurantProperties, RestaurantRun } from '../../shared/types.ts';

export type SalesBuildingCategory = 'generic_retail' | 'sales_office' | 'restaurant';

export interface SalesBuildingState {
  building: PlayerBuilding | null;
  buildingKind: string;
  category: SalesBuildingCategory;
  loading: boolean;
  error: string | null;

  // Generic Retail Queue State
  retailQueue: RetailTask[];

  // Sales Office State
  salesOrders: SalesOrder[];
  isSearchingCustomer: boolean;

  // Restaurant State
  restaurantProperties: RestaurantProperties | null;
  restaurantRuns: RestaurantRun[];
}

export interface RetailItemOption {
  resourceId: number;
  name: string;
  image: string;
  transportationUnits: number;
  marketSaturation: number;
  averageRetailPrice: number;
}
