import {
  getBuildingMeta,
  getConstructionMaterials,
  getBuildingCostUnits,
  DEMOLITION_REFUND_RATE,
  BUILDING_NAMES,
  CANONICAL_BUILDINGS
} from '../../game-data/buildings.ts';
import { ValidationError, ConflictError, BondCollateralViolationError } from '../../errors/domain-error.ts';

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
  // Issue #94: canonical material scaling — qp[resourceId] * costUnits * 1
  // per new build, scaled by sizeUnits for multi-unit estimates.
  const materials = isFreeOrRecreation
    ? []
    : getConstructionMaterials(getBuildingCostUnits(kind) * sizeUnits);

  return { cost, materials };
}

/**
 * Issue #94: upgrade materials scale with the building's CURRENT size, per
 * the decompiled formula resourcesForUpgrade = qp[resourceId] * costUnits *
 * currentSize — NOT with the size delta. Money cost still scales with the
 * delta (referenceUpgradeCost = costUnits * 3450 * (newSize - currentSize)).
 */
export function estimateUpgradeCost(kind: string, sizeDelta: number, currentSize: number = 1): ConstructionCostEstimate {
  if (sizeDelta <= 0) {
    throw new ValidationError(`Upgrade size delta must be positive: ${sizeDelta}`);
  }
  if (!Number.isSafeInteger(currentSize) || currentSize < 1) {
    throw new ValidationError(`Upgrade current size must be a positive integer: ${currentSize}`);
  }
  const meta = getBuildingMeta(kind);
  const cost = meta.cost * sizeDelta;
  const materials = getConstructionMaterials(getBuildingCostUnits(kind) * currentSize);

  return { cost, materials };
}

/**
 * Issue #94: scrapping returns 50% of the construction materials that went
 * into the building (qp * costUnits * buildingSize) at quality 0 — the refund
 * is materials, not cash. `scrapValue` is the reference value of the scrapped
 * building portion (baseCost * size * 0.5) for reporting/events.
 */
export function estimateDemolitionRefund(
  kind: string,
  buildingCost: number,
  buildingSize: number
): {
  scrapValue: number;
  materialRefund: Array<{ kind: number; amount: number }>;
} {
  if (buildingSize <= 0) {
    throw new ValidationError(`Demolition size must be positive: ${buildingSize}`);
  }
  const scrapValue = Math.floor(buildingCost * buildingSize * DEMOLITION_REFUND_RATE);
  const fullMaterials = getConstructionMaterials(getBuildingCostUnits(kind) * buildingSize);
  const materialRefund = fullMaterials.map(m => ({
    kind: m.kind,
    amount: Math.floor(m.amount * DEMOLITION_REFUND_RATE)
  }));

  return { scrapValue, materialRefund };
}

/**
 * Issue #94: bond collateral floor. Buildings collateralize issued bonds
 * (formulas_bonds.md: maxBonds = floor(totalBuildingValue / 5000) -
 * alreadySoldBonds). Demolition must not push the remaining building
 * valuation below 80% of the outstanding bond liability ($5,000 face value
 * per sold bond unit). Equality with the floor is allowed.
 */
export const BOND_COLLATERAL_FLOOR = 0.8;

export function assertBondCollateralFloor(
  remainingBuildingValue: number,
  outstandingBondLiability: number
): void {
  if (outstandingBondLiability <= 0) {
    return;
  }
  const floorValue = outstandingBondLiability * BOND_COLLATERAL_FLOOR;
  if (remainingBuildingValue < floorValue) {
    throw new BondCollateralViolationError(
      `Demolition rejected: remaining building value $${remainingBuildingValue.toFixed(2)}` +
      ` is below the ${(BOND_COLLATERAL_FLOOR * 100).toFixed(0)}% collateral floor` +
      ` ($${floorValue.toFixed(2)}) of the outstanding bond liability ($${outstandingBondLiability.toFixed(2)})`,
      { remainingBuildingValue, outstandingBondLiability, floorValue }
    );
  }
}

