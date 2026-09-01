import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';

export interface EconomyModelState {
  buildingLevelsNeededPerUnitPerHour?: number;
  modeledProductionCostPerUnit?: number;
  modeledStoreWages?: number;
  modeledUnitsSoldAnHour?: number;
}

export interface EconomyModelResource {
  state_0?: EconomyModelState;
  state_1?: EconomyModelState;
  state_2?: EconomyModelState;
}

export interface RetailDurationOptions {
  quality?: number;
  saturation?: number;
  price?: number;
  salesModifier?: number;
  buildingKind?: string;
}

export interface RetailPriceResult {
  unitPrice: number;
  defaultPrice: number;
  maxPrice: number;
  minPrice: number;
}

export interface RetailRevenueResult {
  unitPrice: number;
  revenue: number;
  maxPrice: number;
  defaultPrice: number;
  minPrice: number;
}

export const RETAIL_PRODUCTS: Record<string, number[]> = {
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
  r: [128, 129, 130, 131, 132, 142, 143, 149],
  // Seasonal markets:
  t: [146, 147, 148], // Autumn / Halloween market
  u: [67, 144, 150],   // Xmas market
  z: [153, 154],        // Beach market
  I: [151, 152, 155]   // Spring market
};

let economyModels: Record<string, EconomyModelResource> = {};
try {
  const modelPath = path.join(CONFIG.CONSTANTS_DIR, '..', 'decompile', 'economy_model.json');
  if (fs.existsSync(modelPath)) {
    const raw = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
    economyModels = raw.models || {};
  }
} catch {
  // fallback to runtime defaults
}

export function getRetailProductsForBuilding(buildingKind: string): number[] {
  return RETAIL_PRODUCTS[buildingKind] || [];
}

export function isRetailProductForBuilding(buildingKind: string, resourceKind: number): boolean {
  const products = getRetailProductsForBuilding(buildingKind);
  return products.includes(resourceKind);
}

/**
 * Calculates authoritative retail price limits (default, max, min) and validates/clamps requested price.
 * Quality and market saturation influence the allowable price range and default price.
 */
export function getAuthoritativeRetailPrice(
  resourceKind: number,
  quality = 0,
  requestedPrice?: number,
  saturation = 0.5
): RetailPriceResult {
  const model = economyModels[String(resourceKind)]?.state_1 || economyModels[String(resourceKind)]?.state_0;
  const prodCost = model?.modeledProductionCostPerUnit || 2.0;
  const storeWages = model?.modeledStoreWages || 150.0;
  const unitsPerHour = model?.modeledUnitsSoldAnHour || 100;

  const qualityMultiplier = 1 + Math.max(0, quality) * 0.08;
  const baseCost = prodCost + (storeWages / unitsPerHour);

  const defaultPrice = Math.round(baseCost * 1.25 * qualityMultiplier * 100) / 100;
  const maxPrice = Math.round(baseCost * 3.0 * qualityMultiplier * 100) / 100;
  const minPrice = Math.max(0.1, Math.round(baseCost * 0.5 * 100) / 100);

  if (requestedPrice === undefined || !Number.isFinite(requestedPrice) || requestedPrice <= 0) {
    return { unitPrice: defaultPrice, defaultPrice, maxPrice, minPrice };
  }

  if (requestedPrice > maxPrice) {
    throw new Error(
      `Requested retail price ($${requestedPrice}) exceeds server-authoritative maximum ($${maxPrice}) for resource #${resourceKind} Q${quality}`
    );
  }
  if (requestedPrice < minPrice) {
    throw new Error(
      `Requested retail price ($${requestedPrice}) is below server-authoritative minimum ($${minPrice}) for resource #${resourceKind}`
    );
  }

  return {
    unitPrice: Math.round(requestedPrice * 100) / 100,
    defaultPrice,
    maxPrice,
    minPrice
  };
}

/**
 * Calculates the theoretical optimal retail price based on the decompiled economy formulas.
 */
export function calculateOptimalRetailPrice(
  resourceKind: number,
  quality = 0,
  saturation = 0.5,
  buildingKind?: string
): number {
  const model = economyModels[String(resourceKind)]?.state_1 || economyModels[String(resourceKind)]?.state_0;
  const prodCost = model?.modeledProductionCostPerUnit || 2.0;
  const storeWages = model?.modeledStoreWages || 150.0;
  const unitsPerHour = model?.modeledUnitsSoldAnHour || 50;
  const levelsNeeded = model?.buildingLevelsNeededPerUnitPerHour || 0;

  const d = Math.max(0, Math.min(2, 2 - saturation));
  const demand = Math.max(0.9, d / 2 + 0.5);
  const qf = Math.max(0, Math.min(12, quality)) / 12;
  const isrFactor = buildingKind === 'B' ? 2.28 : 1.0;
  const zor = 370;
  const g = zor * (levelsNeeded * unitsPerHour + 1) * isrFactor * (d / 2 * (1 + qf * 0.3));
  const adjDemand = unitsPerHour * demand;

  const optimalPrice = prodCost + (g + storeWages) / Math.max(0.0001, adjDemand);
  return Math.round(optimalPrice * 100) / 100;
}

/**
 * Calculates retail sales duration in seconds, taking into account:
 * - Resource economic model (base sales speed per hour)
 * - Market demand and saturation (lower saturation = higher demand = faster sales)
 * - Product quality (higher quality = faster sales)
 * - Price deviation from optimal (higher price = slower sales via quadratic elasticity)
 * - Building size (linear speed scaling)
 * - Company sales modifiers (recreation, CMO executive skills)
 */
export function calculateRetailDuration(
  resourceKind: number,
  units: number,
  buildingSize = 1,
  options?: RetailDurationOptions | number
): number {
  const opts: RetailDurationOptions = typeof options === 'number'
    ? { quality: options }
    : (options || {});

  const quality = opts.quality ?? 0;
  const saturation = opts.saturation ?? 0.5;
  const price = opts.price;
  const salesModifier = opts.salesModifier ?? 0;
  const buildingKind = opts.buildingKind;

  const model = economyModels[String(resourceKind)]?.state_1 || economyModels[String(resourceKind)]?.state_0;
  if (!model) {
    const baseSpeed = 100 * Math.max(1, buildingSize);
    return Math.max(5, Math.ceil((units / baseSpeed) * 3600));
  }

  const modeledUnitsSoldAnHour = model.modeledUnitsSoldAnHour || 50;
  const modeledProductionCostPerUnit = model.modeledProductionCostPerUnit || 2.0;
  const modeledStoreWages = model.modeledStoreWages || 150.0;
  const buildingLevelsNeededPerUnitPerHour = model.buildingLevelsNeededPerUnitPerHour || 0;

  // 1. Demand multiplier from market saturation
  const d = Math.max(0, Math.min(2, 2 - saturation));
  const demand = Math.max(0.9, d / 2 + 0.5);

  // 2. Quality factor
  const qf = Math.max(0, Math.min(12, quality)) / 12;
  const qualityWeight = 0.3; // RETAIL_MODELING_QUALITY_WEIGHT

  // 3. Economy model scaling
  const isrFactor = buildingKind === 'B' ? 2.28 : 1.0;
  const zor = 370;
  const g = zor * (buildingLevelsNeededPerUnitPerHour * modeledUnitsSoldAnHour + 1) * isrFactor * (d / 2 * (1 + qf * qualityWeight));

  // 4. Adjusted demand
  const adjDemand = modeledUnitsSoldAnHour * demand;

  // 5. Optimal price and price elasticity
  const optimalPrice = modeledProductionCostPerUnit + (g + modeledStoreWages) / Math.max(0.0001, adjDemand);

  if (price !== undefined && Number.isFinite(price) && price > 0) {
    const priceDiff = optimalPrice - modeledProductionCostPerUnit;
    if (priceDiff > 0.001) {
      const alpha = (modeledStoreWages + g) / (priceDiff * priceDiff);
      const adjRevenue = g - Math.pow(price - optimalPrice, 2) * alpha;
      const numerator = units * (price - modeledProductionCostPerUnit) * 3600 - modeledStoreWages;
      const denominator = adjRevenue + modeledStoreWages;
      if (denominator > 0 && numerator > 0) {
        const timeToSellSeconds = numerator / denominator;
        if (Number.isFinite(timeToSellSeconds) && timeToSellSeconds > 0) {
          const adjustedTime = (timeToSellSeconds / Math.max(1, buildingSize)) * (1 - salesModifier / 100);
          return Math.max(5, Math.min(86400 * 7, Math.ceil(adjustedTime)));
        }
      }
    }
  }

  // Fallback speed based on adjDemand, building size, and salesModifier
  const speed = adjDemand * Math.max(1, buildingSize) * (1 + salesModifier / 100);
  const duration = Math.max(5, Math.ceil((units / Math.max(0.01, speed)) * 3600));
  return Math.min(duration, 86400 * 7); // Max 7 days
}

/**
 * Calculates retail revenue based on unit price and quantity.
 */
export function calculateRetailRevenue(
  resourceKind: number,
  units: number,
  requestedPrice?: number,
  quality = 0,
  saturation = 0.5
): RetailRevenueResult {
  const pricing = getAuthoritativeRetailPrice(resourceKind, quality, requestedPrice, saturation);
  const revenue = Math.round(units * pricing.unitPrice * 100) / 100;
  return {
    unitPrice: pricing.unitPrice,
    revenue,
    maxPrice: pricing.maxPrice,
    defaultPrice: pricing.defaultPrice,
    minPrice: pricing.minPrice
  };
}

/**
 * Returns effective units sold per hour.
 */
export function calculateRetailUnitsPerHour(
  resourceKind: number,
  options?: RetailDurationOptions
): number {
  const durationFor100 = calculateRetailDuration(resourceKind, 100, 1, options);
  if (durationFor100 <= 0) return 0;
  return Math.round((100 / durationFor100) * 3600 * 100) / 100;
}
