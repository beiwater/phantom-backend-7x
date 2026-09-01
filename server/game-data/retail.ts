
export const RETAIL_PRODUCTS: Record<string, number[]> = {
  // Canonical retail buildings:
  // G: Grocery store
  G: [3, 4, 5, 7, 8, 9, 119, 122, 123, 124, 125, 126, 127, 140, 153, 154, 155],
  // A: Gas station
  A: [11, 12],
  // C: Electronics store
  C: [24, 25, 26, 27, 28],
  // 2: Car dealership
  '2': [53, 54, 55, 56, 57],
  // H: Fashion store
  H: [60, 61, 62, 63, 64, 65, 70, 71],
  // d: Hardware store
  d: [102, 103, 108, 109, 110],
  // B: Sales office (Aerospace)
  B: [91, 94, 95, 96, 97, 98, 99],
  // r: Restaurant
  r: [117, 121, 134, 122, 119, 123, 129, 130, 131, 142, 143, 132, 124, 125, 126, 149],
  // Seasonal markets:
  t: [146, 147, 148], // Autumn / Halloween market
  u: [67, 144, 150],   // Xmas market
  z: [153, 154],        // Beach market
  I: [151, 152, 155]   // Spring market
};

export {
  getRetailProductsForBuilding,
  isRetailProductForBuilding,
  getAuthoritativeRetailPrice,
  calculateRetailDuration,
  calculateOptimalRetailPrice,
  calculateRetailRevenue,
  calculateRetailUnitsPerHour,
  type RetailDurationOptions,
  type RetailPriceResult,
  type RetailRevenueResult
} from '../game/retail.ts';
