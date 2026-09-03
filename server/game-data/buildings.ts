import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';
import { getResourceDef } from './resources.ts';

export interface BuildingDef {
  dbLetter: string;
  name?: string;
  category: string;
  costUnits?: number;
  image?: string;
  levelImages?: Array<{ level: number; image: string }>;
  wages?: number;
  buildDuration?: number;
  /** Issue #96: wage exponent of the building kind (drives robot unit requirements). */
  salaryModifier?: number;
}

const buildingsPath = path.join(CONFIG.CONSTANTS_DIR, 'buildings.json');
const corePath = path.join(CONFIG.CONSTANTS_DIR, 'core.json');
const coreConstants = JSON.parse(fs.readFileSync(corePath, 'utf-8')) as {
  AVERAGE_SALARY?: number;
  SALARY_MID?: Record<string, number>;
};

export const CANONICAL_BUILDINGS: Record<string, BuildingDef> = JSON.parse(
  fs.readFileSync(buildingsPath, 'utf-8')
);

export const BUILDING_NAMES: Record<string, { name: string; cost: number; category: string }> = {
  'P': { name: 'Farm', cost: 6900, category: 'production' },
  'W': { name: 'Water reservoir', cost: 20700, category: 'production' },
  'E': { name: 'Power plant', cost: 51750, category: 'production' },
  'O': { name: 'Oil rig', cost: 69000, category: 'production' },
  'R': { name: 'Refinery', cost: 69000, category: 'production' },
  'S': { name: 'Shipping depot', cost: 34500, category: 'production' },
  'G': { name: 'Grocery store', cost: 10350, category: 'sales' },
  'C': { name: 'Electronics store', cost: 10350, category: 'sales' },
  'A': { name: 'Gas station', cost: 10350, category: 'sales' },
  'F': { name: 'Ranch', cost: 6900, category: 'production' },
  'M': { name: 'Mine', cost: 6900, category: 'production' },
  'Y': { name: 'Factory', cost: 13800, category: 'production' },
  'L': { name: 'Electronics factory', cost: 13800, category: 'production' },
  'T': { name: 'Clothes factory', cost: 10350, category: 'production' },
  'H': { name: 'Fashion store', cost: 10350, category: 'sales' },
  'p': { name: 'Plant research', cost: 17250, category: 'research' },
  'h': { name: 'Physics laboratory', cost: 17250, category: 'research' },
  'b': { name: 'Breeding research', cost: 17250, category: 'research' },
  'c': { name: 'Chemistry laboratory', cost: 17250, category: 'research' },
  's': { name: 'Software research', cost: 17250, category: 'research' },
  'a': { name: 'Race track', cost: 17250, category: 'research' },
  'f': { name: 'Fashion research', cost: 17250, category: 'research' },
  'l': { name: 'Launchpad', cost: 51750, category: 'research' },
  'q': { name: 'Kitchen', cost: 17250, category: 'research' },
  'D': { name: 'Propulsion factory', cost: 69000, category: 'production' },
  'B': { name: 'Sales office', cost: 69000, category: 'sales' },
  'Q': { name: 'Quarry', cost: 6900, category: 'production' },
  'o': { name: 'Concrete plant', cost: 13800, category: 'production' },
  'x': { name: 'Construction factory', cost: 13800, category: 'production' },
  'g': { name: 'General contractor', cost: 17250, category: 'production' },
  'd': { name: 'Hardware store', cost: 10350, category: 'sales' },
  'n': { name: 'Bank', cost: 69000, category: 'other' },
  'e': { name: 'Slaughterhouse', cost: 10350, category: 'production' },
  'i': { name: 'Mill', cost: 6900, category: 'production' },
  'j': { name: 'Bakery', cost: 10350, category: 'production' },
  'k': { name: 'Food processing plant', cost: 10350, category: 'production' },
  'm': { name: 'Catering', cost: 17250, category: 'production' },
  'r': { name: 'Restaurant', cost: 17250, category: 'sales' },
  't': { name: 'Autumn market', cost: 0, category: 'seasonal' },
  'u': { name: 'Xmas market', cost: 0, category: 'seasonal' },
  'v': { name: 'Forest nursery', cost: 6900, category: 'production' },
  'y': { name: 'Academy', cost: 69000, category: 'other' },
  'z': { name: 'Beach market', cost: 0, category: 'seasonal' },
  'I': { name: 'Spring market', cost: 0, category: 'seasonal' },
  '0': { name: 'Hangar', cost: 100050, category: 'production' },
  '1': { name: 'Automotive factory', cost: 17250, category: 'production' },
  '2': { name: 'Car dealership', cost: 10350, category: 'sales' },
  '3': { name: 'Castle', cost: 0, category: 'recreation' },
  '4': { name: 'Park', cost: 0, category: 'recreation' },
  '5': { name: 'Lake', cost: 0, category: 'recreation' },
  '6': { name: 'Beverage factory', cost: 10350, category: 'production' },
  '7': { name: 'Aerospace factory', cost: 17250, category: 'production' },
  '8': { name: 'Aerospace electronics', cost: 17250, category: 'production' },
  '9': { name: 'Vertical integration facility', cost: 17250, category: 'production' }
};

/**
 * Issue #94: canonical construction material scaling, from the decompiled
 * client (buildings.json `_meta.upgradeFormula`):
 *   qp = { 101: 4, 102: 55, 108: 16, 111: 1 }  (units per building cost unit)
 *   resourcesForNewBuild = qp[resourceId] * costUnits * 1
 *   resourcesForUpgrade  = qp[resourceId] * costUnits * currentSize
 * `perUnit` below IS qp[resourceId]; the building's costUnits multiplier is
 * applied by getConstructionMaterials via getBuildingCostUnits(kind).
 */
export const CONSTRUCTION_MATERIALS: Array<{ kind: number; perUnit: number }> = [
  { kind: 101, perUnit: 4 },   // Planks (qp[101] = 4)
  { kind: 102, perUnit: 55 },  // Bricks (qp[102] = 55)
  { kind: 108, perUnit: 16 },  // Reinforced concrete (qp[108] = 16)
  { kind: 111, perUnit: 1 }    // Construction units (qp[111] = 1)
];

export const DEMOLITION_REFUND_RATE = 0.5;

/**
 * Issue #94: the building's canonical `costUnits` from the decompiled game
 * data. Construction/upgrade/scrap material requirements scale with this
 * value: amount = qp[resourceId] * costUnits * sizeMultiplier.
 */
export function getBuildingCostUnits(kind: string): number {
  const def = CANONICAL_BUILDINGS[kind];
  const costUnits = Number(def?.costUnits);
  if (Number.isFinite(costUnits) && costUnits > 0) return costUnits;
  const meta = BUILDING_NAMES[kind];
  if (meta?.cost) return Math.max(1, Math.round(meta.cost / 3450));
  return 1;
}

export function getBuildingMeta(kind: string) {
  const meta = BUILDING_NAMES[kind];
  const def = CANONICAL_BUILDINGS[kind];
  return {
    name: meta?.name || 'Building',
    cost: meta?.cost || (def?.costUnits ? def.costUnits * 3450 : 6900),
    category: meta?.category || def?.category || 'production',
    image: def?.levelImages?.[0]?.image || 'images/buildings/production/farm_tier01.png'
  };
}

/**
 * Materials required for `sizeUnits` cost-unit-units of construction work:
 * amount = qp[resourceId] * sizeUnits. Callers pass sizeUnits as
 * `costUnits * sizeMultiplier` (new build: costUnits * 1; upgrade:
 * costUnits * currentSize; scrap refund basis: costUnits * buildingSize).
 */
export function getConstructionMaterials(sizeUnits: number): Array<{ kind: number; amount: number }> {
  return CONSTRUCTION_MATERIALS.map(m => ({ kind: m.kind, amount: m.perUnit * sizeUnits }));
}

export interface ProductionCalculationOptions {
  /** Economic salary state: 0 = recession, 1 = normal, 2 = boom. */
  economyState?: number;
  /** Product quality; the official calculator applies this only to mining. */
  quality?: number;
  /** Active event speed modifier, expressed as a percentage. */
  eventSpeedModifier?: number;
  /** Recreation and accumulator bonuses, expressed as percentage points. */
  recreationBonus?: number;
  accumulatorBonus?: number;
}

const AVERAGE_SALARY = Number(coreConstants.AVERAGE_SALARY) || 345;
const SALARY_MID: Record<number, number> = {
  0: Number(coreConstants.SALARY_MID?.['0']) || 655,
  1: Number(coreConstants.SALARY_MID?.['1']) || 700,
  2: Number(coreConstants.SALARY_MID?.['2']) || 745
};
const MINING_RESOURCE_KINDS: Record<number, true> = {
  10: true,
  14: true,
  15: true,
  42: true,
  44: true,
  68: true,
  74: true,
  104: true,
  105: true
};

function normalizedEconomyState(value: number | undefined): number {
  const state = Number.isInteger(value) ? Number(value) : 1;
  return state >= 0 && state <= 2 ? state : 1;
}

/**
 * Calculate the official encyclopedia's per-hour production rate.
 *
 * `productionModifier` is the server's fractional modifier (0.1 = +10%).
 * The remaining bonus options use the encyclopedia's percentage-point units.
 */
export function calculateProductionRate(
  resourceKind: number,
  buildingSize: number,
  productionModifier = 0,
  options: ProductionCalculationOptions = {}
): number {
  const res = getResourceDef(resourceKind);
  if (!res || !res.producedPerHourRaw || res.producedPerHourRaw <= 0) return 0;

  const salaryModifier = Number(
    res.producedAt ? CANONICAL_BUILDINGS[res.producedAt]?.salaryModifier : 0
  ) || 0;
  const salaryMid = SALARY_MID[normalizedEconomyState(options.economyState)];
  let rate = res.producedPerHourRaw * Math.pow(AVERAGE_SALARY / salaryMid, salaryModifier);

  if (MINING_RESOURCE_KINDS[resourceKind]) {
    rate *= Math.max(0, Number(options.quality ?? 100)) / 100;
  }
  rate *= 1 + (Number(options.eventSpeedModifier ?? 0) / 100);

  const modifier = Math.max(-0.75, Math.min(3, Number(productionModifier) || 0));
  const bonusPercent = modifier * 100
    + Number(options.recreationBonus ?? 0)
    + Number(options.accumulatorBonus ?? 0);
  const bonusFactor = 1 / Math.max(0.25, 1 - bonusPercent / 100);
  return buildingSize * rate * bonusFactor;
}

export function calculateProductionTime(
  resourceKind: number,
  amount: number,
  buildingSize: number,
  productionModifier = 0,
  options: ProductionCalculationOptions = {}
): number {
  const ratePerHour = calculateProductionRate(
    resourceKind,
    buildingSize,
    productionModifier,
    options
  );
  if (!(ratePerHour > 0)) return 60;

  const hoursNeeded = amount / ratePerHour;
  const baseSeconds = Math.max(5, Math.ceil(hoursNeeded * 3600));
  return Math.max(3, Math.round(baseSeconds / (CONFIG.PRODUCTION_SPEED_MULTIPLIER || 1)));
}
