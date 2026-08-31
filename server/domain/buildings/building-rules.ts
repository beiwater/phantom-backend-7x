import {
  getBuildingMeta,
  getConstructionMaterials,
  DEMOLITION_REFUND_RATE,
  BUILDING_NAMES,
  CANONICAL_BUILDINGS
} from '../../game-data/buildings.ts';
import { ValidationError, ConflictError } from '../../errors/domain-error.ts';

export interface ConstructionCostEstimate {
  cost: number;
  materials: Array<{ kind: number; amount: number }>;
}

export function normalizePosition(position: string | number): string {
  const str = String(position ?? '').trim();
  if (str.toUpperCase().startsWith('B')) {
    const rawNum = str.slice(1);
    if (/^\d+$/.test(rawNum)) {
      return rawNum;
    }
  }
  return str;
}

export function validateConstructionPosition(
  position: string,
  existingPositions: string[],
  replaceExisting: boolean = false
): void {
  const normalized = normalizePosition(position);
  const posNum = Number(normalized);
  if (!Number.isInteger(posNum) || posNum < 0) {
    throw new ValidationError(`Invalid building position: ${position}`);
  }

  const normalizedExisting = existingPositions.map(normalizePosition);
  if (!replaceExisting && (existingPositions.includes(position) || normalizedExisting.includes(normalized))) {
    throw new ConflictError(`Building position ${position} is already occupied`);
  }
}

export function estimateConstructionCost(kind: string, sizeUnits: number = 1): ConstructionCostEstimate {
  if (sizeUnits <= 0) {
    throw new ValidationError(`Construction size must be positive: ${sizeUnits}`);
  }
  if (!BUILDING_NAMES[kind] && !CANONICAL_BUILDINGS[kind]) {
    throw new ValidationError(`Unknown building kind: ${kind}`);
  }
  const meta = getBuildingMeta(kind);
  const cost = meta.cost * sizeUnits;
  const materials = getConstructionMaterials(sizeUnits);

  return { cost, materials };
}

export function estimateUpgradeCost(kind: string, sizeDelta: number): ConstructionCostEstimate {
  if (sizeDelta <= 0) {
    throw new ValidationError(`Upgrade size delta must be positive: ${sizeDelta}`);
  }
  const meta = getBuildingMeta(kind);
  const cost = meta.cost * sizeDelta;
  const materials = getConstructionMaterials(sizeDelta);

  return { cost, materials };
}

export function estimateDemolitionRefund(buildingCost: number, buildingSize: number): {
  moneyRefund: number;
  materialRefund: Array<{ kind: number; amount: number }>;
} {
  const moneyRefund = Math.floor(buildingCost * buildingSize * DEMOLITION_REFUND_RATE);
  const fullMaterials = getConstructionMaterials(buildingSize);
  const materialRefund = fullMaterials.map(m => ({
    kind: m.kind,
    amount: Math.floor(m.amount * DEMOLITION_REFUND_RATE)
  }));

  return { moneyRefund, materialRefund };
}
