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
  'G': { name: 'Grocery store', cost: 10350, category: 'sales' },
  'E': { name: 'Electronics factory', cost: 13800, category: 'production' },
  'W': { name: 'Water reservoir', cost: 6900, category: 'production' },
  'O': { name: 'Oil rig', cost: 6900, category: 'production' },
  'R': { name: 'Refinery', cost: 13800, category: 'production' },
  'S': { name: 'Gas station', cost: 10350, category: 'sales' },
  'C': { name: 'Car dealership', cost: 10350, category: 'sales' },
  'A': { name: 'Aerospace factory', cost: 17250, category: 'production' },
  'F': { name: 'Fashion store', cost: 10350, category: 'sales' },
  'M': { name: 'Mine', cost: 6900, category: 'production' },
  'Y': { name: 'Factory', cost: 13800, category: 'production' },
  'L': { name: 'Electronics store', cost: 10350, category: 'sales' },
  'T': { name: 'Power plant', cost: 6900, category: 'production' },
  'H': { name: 'Hardware store', cost: 10350, category: 'sales' },
  'Q': { name: 'Quarry', cost: 6900, category: 'production' },
  '1': { name: 'Automotive factory', cost: 17250, category: 'production' },
  '6': { name: 'Brewery', cost: 10350, category: 'production' },
  'j': { name: 'Bakery', cost: 10350, category: 'production' },
  'k': { name: 'Food processing plant', cost: 10350, category: 'production' },
  'm': { name: 'Restaurant', cost: 17250, category: 'sales' },
  'z': { name: 'Beach market', cost: 0, category: 'seasonal' }
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
