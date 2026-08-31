import { getResourceDef } from '../../game-data/resources.ts';
import { calculateProductionTime } from '../../game-data/buildings.ts';
import { ValidationError } from '../../errors/domain-error.ts';
import { getProductionQualityCap } from '../../game/research.ts';

export interface ProductionRequirement {
  kind: number;
  amount: number;
}

export function validateProductionRequest(
  buildingKind: string,
  resourceKind: number,
  amount: number,
  quality?: number | null
): {
  durationSeconds: number;
  ingredients: ProductionRequirement[];
} {
  // C-19: fractional amounts would persist fractional inventory rows.
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ValidationError(`Production amount must be a positive integer: ${amount}`);
  }

  // C-14: requested quality must be an integer within the official 0..12 band;
  // resolveAchievableQuality only clamps downward against the research cap, so
  // negative or out-of-range requests must be rejected here.
  if (quality !== undefined && quality !== null) {
    if (!Number.isInteger(quality) || quality < 0 || quality > 12) {
      throw new ValidationError(`Production quality must be an integer between 0 and 12: ${quality}`);
    }
  }

  const def = getResourceDef(resourceKind);
  if (!def) {
    throw new ValidationError(`Unknown resource kind: ${resourceKind}`);
  }

  if (!def.producedAt || def.producedAt !== buildingKind) {
    throw new ValidationError(
      `Resource ${resourceKind} cannot be produced in building type '${buildingKind}', requires '${def.producedAt || 'unproducible'}'`
    );
  }

  const ingredients: ProductionRequirement[] = [];
  if (def.producedFrom) {
    for (const [ingKindStr, ingRatio] of Object.entries(def.producedFrom)) {
      ingredients.push({
        kind: Number(ingKindStr),
        amount: ingRatio * amount
      });
    }
  }

  return {
    durationSeconds: calculateProductionTime(resourceKind, amount, 1),
    ingredients
  };
}

export function resolveAchievableQuality(
  companyId: number,
  resourceKind: number,
  requestedQuality?: number | null
): number {
  const researchCap = getProductionQualityCap(companyId, resourceKind);
  if (requestedQuality !== undefined && requestedQuality !== null) {
    return Math.min(requestedQuality, researchCap);
  }
  return researchCap;
}
