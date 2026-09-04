import { getResourceDef } from './resources.ts';

/**
 * Canonical accumulator parameters are part of the resource definition. The
 * Forest Nursery currently produces Tree (150), but keeping the lookup keyed
 * by resource lets future accumulator resources reuse the same mechanics.
 */
export interface AccumulatorParameters {
  baseValue: number;
  max: number;
  amountPerLevel: number;
  bonusPerQuality: number;
}

export interface AccumulatorResourceState {
  kind: number;
  value: number;
  quality: number | null;
  cost: {
    total: number;
  };
}

export function getAccumulatorParameters(resourceKind: number): AccumulatorParameters | null {
  const mechanic = getResourceDef(resourceKind)?.productionMechanic;
  if (mechanic?.type !== 'accumulator') return null;
  const params = mechanic.accumulatorParameters;
  if (!params) return null;
  const baseValue = Number(params.baseValue);
  const max = Number(params.max);
  const amountPerLevel = Number(params.amountPerLevel);
  const bonusPerQuality = Number(params.bonusPerQuality);
  if (!(baseValue > 0) || !(max >= baseValue) || !(amountPerLevel > 0)
    || !Number.isFinite(bonusPerQuality)) {
    return null;
  }
  return { baseValue, max, amountPerLevel, bonusPerQuality };
}

/** Return the highest quality whose threshold has been reached, or null. */
export function accumulatorQualityForValue(value: number, resourceKind: number): number | null {
  const params = getAccumulatorParameters(resourceKind);
  const numericValue = Number(value);
  if (!params || !Number.isFinite(numericValue) || numericValue < params.baseValue) return null;
  const maxQuality = Math.floor(Math.log2(params.max / params.baseValue));
  const quality = Math.floor(Math.log2(numericValue / params.baseValue));
  return Math.max(0, Math.min(maxQuality, quality));
}

export function accumulatorThresholdForQuality(resourceKind: number, quality: number): number {
  const params = getAccumulatorParameters(resourceKind);
  if (!params || !Number.isInteger(quality) || quality < 0) return 0;
  return Math.min(params.max, params.baseValue * (2 ** quality));
}

export function accumulatorBonusForResearch(resourceKind: number, researchedQuality: number): number {
  const params = getAccumulatorParameters(resourceKind);
  if (!params) return 0;
  return params.bonusPerQuality * Math.max(0, Math.floor(Number(researchedQuality) || 0));
}

export function accumulatorStateDTO(
  resourceKind: number,
  value: number,
  costTotal: number
): AccumulatorResourceState {
  return {
    kind: resourceKind,
    value: Math.max(0, Number(value) || 0),
    quality: accumulatorQualityForValue(value, resourceKind),
    cost: { total: Math.max(0, Number(costTotal) || 0) }
  };
}
