import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';

export const RETAIL_PRODUCTS: Record<string, number[]> = {
  G: [3, 4, 119, 7, 8, 9, 62],  // Grocery store
  S: [11, 12, 60, 61],          // Gas station
  E: [24, 25, 40, 80],          // Electronics store
  T: [19, 20, 21, 22],          // Hardware / Tools
  C: [50, 51, 52, 53],          // Car dealership
  H: [102, 103, 104],           // Hardware store
  F: [17, 18, 115, 116, 117, 118], // Fashion store
};

interface EconomyModelState {
  buildingLevelsNeededPerUnitPerHour?: number;
  modeledProductionCostPerUnit?: number;
  modeledStoreWages?: number;
  modeledUnitsSoldAnHour?: number;
}

interface EconomyModelResource {
  state_0?: EconomyModelState;
  state_1?: EconomyModelState;
  state_2?: EconomyModelState;
}

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

export function getAuthoritativeRetailPrice(
  resourceKind: number,
  quality = 0,
  requestedPrice?: number
): { unitPrice: number; defaultPrice: number; maxPrice: number } {
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
    return { unitPrice: defaultPrice, defaultPrice, maxPrice };
  }

  if (requestedPrice > maxPrice) {
    throw new Error(`Requested retail price ($${requestedPrice}) exceeds server-authoritative maximum ($${maxPrice}) for resource #${resourceKind} Q${quality}`);
  }
  if (requestedPrice < minPrice) {
    throw new Error(`Requested retail price ($${requestedPrice}) is below server-authoritative minimum ($${minPrice}) for resource #${resourceKind}`);
  }

  return {
    unitPrice: Math.round(requestedPrice * 100) / 100,
    defaultPrice,
    maxPrice
  };
}

export function calculateRetailDuration(
  resourceKind: number,
  units: number,
  buildingSize = 1
): number {
  const model = economyModels[String(resourceKind)]?.state_1 || economyModels[String(resourceKind)]?.state_0;
  const unitsPerHour = Math.max(1, model?.modeledUnitsSoldAnHour || 50);
  const effectiveSpeed = unitsPerHour * Math.max(1, buildingSize);
  const durationSeconds = Math.max(5, Math.ceil((units / effectiveSpeed) * 3600));
  return Math.min(durationSeconds, 86400 * 2); // Max 48 hours
}
