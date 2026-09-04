/**
 * Reconstructed Game Constants and Mappings
 * Extracted from chunk_oX.js (Ji, dpr, on, r3t)
 */

export const AVERAGE_SALARY = 345;
export const ROBOT_COST = 940;
export const EXCHANGE_FEE_RATE = 0.04; // 4%

export const BUILDING_CATEGORIES = {
  PRODUCTION: 'production',
  SALES: 'sales',
  RESEARCH: 'research',
  RECREATION: 'recreation',
  OTHER: 'other',
  SEASONAL: 'seasonal'
} as const;

/**
 * All Sales and Retail Buildings
 */
export const SALES_BUILDING_KINDS = {
  // Generic retail stores
  GROCERY_STORE: 'G',
  ELECTRONICS_STORE: 'C',
  GAS_STATION: 'A',
  FASHION_STORE: 'H',
  HARDWARE_STORE: 'd',
  CAR_DEALERSHIP: '2',

  // Dedicated sales implementations
  SALES_OFFICE: 'B',
  RESTAURANT: 'r',

  // Seasonal retail shops
  HALLOWEEN_SHOP: 't',
  SUMMER_SHOP: 'z',
  EASTER_SHOP: 'I',
  XMAS_MARKET: 'u'
} as const;

/**
 * Mapping of building kind -> sellable resource IDs
 * Source: dpr / Ji.SALES
 */
export const RETAIL_BUILDING_RESOURCES: Record<string, number[]> = {
  [SALES_BUILDING_KINDS.GROCERY_STORE]: [3, 4, 5, 7, 8, 9, 119, 122, 123, 124, 125, 126, 127, 140, 152],
  [SALES_BUILDING_KINDS.ELECTRONICS_STORE]: [11, 12, 24, 25, 26, 27, 28, 98],
  [SALES_BUILDING_KINDS.GAS_STATION]: [11, 12],
  [SALES_BUILDING_KINDS.FASHION_STORE]: [60, 61, 62, 63, 64, 65, 70, 71],
  [SALES_BUILDING_KINDS.HARDWARE_STORE]: [91, 94, 95, 96, 97, 99],
  [SALES_BUILDING_KINDS.CAR_DEALERSHIP]: [53, 54, 55, 56, 57],
  [SALES_BUILDING_KINDS.RESTAURANT]: [117, 119, 121, 122, 123, 124, 125, 126, 129, 130, 131, 132, 134, 142, 143, 149],
  [SALES_BUILDING_KINDS.HALLOWEEN_SHOP]: [146, 147, 148],
  [SALES_BUILDING_KINDS.SUMMER_SHOP]: [153, 154],
  [SALES_BUILDING_KINDS.EASTER_SHOP]: [151, 155],
  [SALES_BUILDING_KINDS.XMAS_MARKET]: [67, 144, 150]
};

export const RESOURCE_CATEGORIES = [
  { id: 'UP', name: 'Agriculture' },
  { id: 'OP', name: 'Food & Drinks' },
  { id: 'IP', name: 'Construction' },
  { id: 'MP', name: 'Fashion' },
  { id: 'RP', name: 'Energy' },
  { id: 'NP', name: 'Electronics' },
  { id: 'DP', name: 'Automotive' },
  { id: 'LP', name: 'Aerospace' },
  { id: 'FP', name: 'Raw Materials' },
  { id: 'jP', name: 'Research' }
] as const;
