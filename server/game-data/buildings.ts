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
}

const buildingsPath = path.join(CONFIG.CONSTANTS_DIR, 'buildings.json');
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

export const CONSTRUCTION_MATERIALS: Array<{ kind: number; perUnit: number }> = [
  { kind: 101, perUnit: 10 },  // Planks
  { kind: 102, perUnit: 15 },  // Bricks
  { kind: 108, perUnit: 8 },   // Reinforced concrete
  { kind: 111, perUnit: 2 }    // Construction units
];

export const DEMOLITION_REFUND_RATE = 0.5;

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

export function getConstructionMaterials(sizeUnits: number): Array<{ kind: number; amount: number }> {
  return CONSTRUCTION_MATERIALS.map(m => ({ kind: m.kind, amount: m.perUnit * sizeUnits }));
}

export function calculateProductionTime(resourceKind: number, amount: number, buildingSize: number): number {
  const res = getResourceDef(resourceKind);
  if (!res || !res.producedPerHourRaw || res.producedPerHourRaw <= 0) {
    return 60;
  }
  const basePerHour = res.producedPerHourRaw * buildingSize;
  const hoursNeeded = amount / basePerHour;
  const baseSeconds = Math.max(5, Math.ceil(hoursNeeded * 3600));
  return Math.max(3, Math.round(baseSeconds / (CONFIG.PRODUCTION_SPEED_MULTIPLIER || 1)));
}
