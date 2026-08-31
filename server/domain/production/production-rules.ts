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
  amount: number
): {
  durationSeconds: number;
  ingredients: ProductionRequirement[];
} {
  if (amount <= 0 || !Number.isFinite(amount)) {
    throw new ValidationError(`Production amount must be a positive number: ${amount}`);
  }

  const def = getResourceDef(resourceKind);
  if (!def) {
    throw new ValidationError(`Unknown resource kind: ${resourceKind}`);
  }

  if (def.producedAt && def.producedAt !== buildingKind) {
    throw new ValidationError(
      `Resource ${resourceKind} cannot be produced in building type '${buildingKind}', requires '${def.producedAt}'`
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
