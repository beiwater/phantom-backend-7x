import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';

export interface ResourceDef {
  dbLetter: number;
  producedAt?: string;
  producedFrom?: Record<string, number>;
  producedPerHourRaw?: number;
  image: string;
  transportation: number;
  isExchangeTradable: boolean;
  unitsSoldAnHour?: number;
  decay?: number;
}

const resourcesPath = path.join(CONFIG.CONSTANTS_DIR, 'resources.json');
export const CANONICAL_RESOURCES: Record<string, ResourceDef> = JSON.parse(
  fs.readFileSync(resourcesPath, 'utf-8')
);

export function getResourceDef(kind: number | string): ResourceDef | undefined {
  return CANONICAL_RESOURCES[String(kind)];
}

export function isResourceExchangeTradable(kind: number | string): boolean {
  const def = getResourceDef(kind);
  return def ? def.isExchangeTradable !== false : false;
}

export function getAllResourceDefs(): Record<string, ResourceDef> {
  return CANONICAL_RESOURCES;
}
