/**
 * Restored Domain Types for SimCompanies Frontend
 * Reconstructed from index-cgzgptQ8.js bundles, Redux slices, and contract registries.
 */

export interface ResourceDefinition {
  dbLetter: number;
  name: string;
  image: string;
  producedPerHourRaw: number;
  producedAt: string; // building dbLetter, e.g. "P"
  producedFrom: Record<number, number>; // { [resourceId]: quantity }
  transportation: number;
  unitsSoldAnHour: number; // 0 if not retailable
  consumption: number;
  isExchangeTradable: boolean;
  isResearch: boolean;
  hasEconomyModel: boolean;
  decay: number;
  productionSeason: string | null;
  retailSeason: string | null;
  productionMechanic?: {
    kind: string;
    baseValue: number;
    max: number;
    bonusPerQuality: number;
  };
}

export interface BuildingDefinition {
  dbLetter: string; // e.g. "G", "B", "r", "2", "C", "A"
  name: string;
  category: 'production' | 'sales' | 'research' | 'recreation' | 'seasonal' | 'other';
  costUnits: number;
  buildDuration: number;
  salaryModifier: number;
  tiers: number[];
  images: {
    tier01?: string;
    tier02?: string;
    tier03?: string;
    default?: string;
  };
}

export interface PlayerBuilding {
  id: number;
  companyId: number;
  position: string;
  kind: string; // dbLetter
  size: number;
  name: string;
  cost: number;
  category: string;
  busyUntil?: string | null;
  level?: number;
}

export interface RetailTask {
  id: number;
  buildingId: number;
  resourceId: number;
  amount: number;
  price: number;
  quality: number;
  durationSeconds: number;
  busyUntil: string;
  startedAt: string;
}

export interface SalesOrder {
  id: number;
  buildingId: number;
  resourceId: number;
  resourceName?: string;
  amount: number;
  price: number;
  quality: number;
  delivered?: boolean;
  createdAt: string;
}

export interface RestaurantProperties {
  buildingId: number;
  rating: number;
  menu: Array<{
    resourceId: number;
    price: number;
    quality: number;
  }>;
  staffLevel: number;
  seatingCapacity: number;
  isOpen: boolean;
}

export interface RestaurantRun {
  id: number;
  buildingId: number;
  startedAt: string;
  endedAt: string;
  revenue: number;
  cost: number;
  profit: number;
  customersServed: number;
  ratingDelta: number;
}

export interface ResourceRetailInfo {
  resourceId: number;
  saturation: number;
  averagePrice: number;
  demandMultiplier: number;
}

export interface EncyclopediaResourceDetail {
  dbLetter: number;
  name: string;
  quality: number;
  productionCost: number;
  marketPrice: number;
  retailProfitPerHour?: number;
  saturation?: number;
  recipes: Array<{
    buildingKind: string;
    durationSeconds: number;
    inputs: Array<{ resourceId: number; amount: number; cost: number }>;
    outputAmount: number;
  }>;
}
