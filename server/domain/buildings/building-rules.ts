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
  return String(position ?? '').trim();
}

/**
 * P0-07: the original client addresses star-unlocked lots as "B0", "B1", ...
 * These are distinct landscape slots and MUST be stored verbatim. The previous
 * normalization stripped the "B", so a build at "B0" collapsed onto base
 * position "0" (already occupied) and every unlocked slot was unusable.
 */
export function extraSlotIndex(position: string): number | null {
  const match = /^B(\d+)$/i.exec(String(position ?? '').trim());
  return match ? Number(match[1]) : null;
}

export function validateConstructionPosition(
  position: string,
  existingPositions: string[],
  replaceExisting: boolean = false
): void {
  const normalized = normalizePosition(position);
  const extraIndex = extraSlotIndex(normalized);
  if (extraIndex === null) {
    const posNum = Number(normalized);
    if (!Number.isInteger(posNum) || posNum < 0) {
      throw new ValidationError(`Invalid building position: ${position}`);
    }
  }

  const normalizedExisting = existingPositions.map(normalizePosition);
  if (!replaceExisting && (existingPositions.includes(position) || normalizedExisting.includes(normalized))) {
    throw new ConflictError(`Building position ${position} is already occupied`);
  }
}

/**
 * Issue #47: a building whose busy_until is still in the future is locked for
 * structural work (construction/upgrade) and cannot accept contradictory
 * operations. The busy marker is authoritative regardless of whether any
 * production queue row exists, so a freshly constructed/upgraded building is
 * protected even with an empty queue. Active recreation upkeep (category 'u',
 * P1-09) legitimately occupies busy_until and is exempted by its callers.
 */
export function assertNotBusyForConstructionWork(busyUntil: string | null | undefined): void {
  if (busyUntil && new Date(busyUntil).getTime() > Date.now()) {
    throw new ConflictError('Building is busy with construction or upgrade; wait for completion or rush it');
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
  const isFreeOrRecreation = meta.cost === 0 || meta.category === 'recreation' || meta.category === 'seasonal';
  const cost = meta.cost * sizeUnits;
  const materials = isFreeOrRecreation ? [] : getConstructionMaterials(sizeUnits);

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
