import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';
const RESOURCE_NAMES: Record<string, string> = {
  '1': 'Power',
  '2': 'Water',
  '3': 'Apples',
  '4': 'Oranges',
  '8': 'Sausages',
  '11': 'Petrol',
  '12': 'Diesel',
  '13': 'Transport',
  '18': 'Aluminium',
  '22': 'Batteries',
  '48': 'Electric motor',
  '66': 'Seeds',
  '75': 'Carbon fibers',
  '78': 'Fuselage',
  '80': 'Flight computer',
  '85': 'Solid fuel booster',
  '90': 'Sub-orbital 2nd stage',
  '91': 'Sub-orbital rocket',
  '92': 'Orbital booster',
  '93': 'Starship',
  '94': 'BFR',
  '95': 'Jumbo jet',
  '96': 'Luxury jet',
  '97': 'Single-engine plane',
  '98': 'Quadcopter',
  '100': 'Aerospace research',
  '101': 'Reinforced concrete'
};

export interface ResourceDef {
  dbLetter: number;
  producedAt?: string;
  producedFrom?: Record<string, number>;
  producedPerHourRaw?: number;
  image: string;
  transportation: number;
  isExchangeTradable: boolean;
  unitsSoldAnHour?: number;
  isResearch?: boolean;
  decay?: number;
}

const resourcesPath = path.join(CONFIG.CONSTANTS_DIR, 'resources.json');
export const CANONICAL_RESOURCES: Record<string, ResourceDef> = JSON.parse(
  fs.readFileSync(resourcesPath, 'utf-8')
);

export function getResourceDef(kind: number | string): ResourceDef | undefined {
  return CANONICAL_RESOURCES[String(kind)];
}

export function getResourceName(kind: number | string): string {
  const key = String(kind);
  return RESOURCE_NAMES[key] || `Resource #${key}`;
}

export function isResourceExchangeTradable(kind: number | string): boolean {
  const def = getResourceDef(kind);
  return def ? def.isExchangeTradable !== false : false;
}

export function getAllResourceDefs(): Record<string, ResourceDef> {
  return CANONICAL_RESOURCES;
}
