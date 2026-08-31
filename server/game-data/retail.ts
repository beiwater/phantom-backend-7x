export const RETAIL_PRODUCTS: Record<string, number[]> = {
  G: [3, 4, 119, 7, 8, 9, 62],  // Grocery store
  S: [11, 12, 60, 61],          // Gas station
  E: [24, 25, 40, 80],          // Electronics store
  T: [19, 20, 21, 22],          // Hardware / Tools
  C: [50, 51, 52, 53],          // Car dealership
  H: [102, 103, 104],           // Hardware store
  F: [17, 18, 115, 116, 117, 118], // Fashion store
};

export function getRetailProductsForBuilding(buildingKind: string): number[] {
  return RETAIL_PRODUCTS[buildingKind] || [];
}

export function isRetailProductForBuilding(buildingKind: string, resourceKind: number): boolean {
  const products = getRetailProductsForBuilding(buildingKind);
  return products.includes(resourceKind);
}
