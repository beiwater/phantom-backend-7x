export { computeFallbackUnitCost } from '../../application/production/get-production-queue.ts';

/**
 * P0-02: every numeric field consumed by the original frontend must be a
 * finite number — `undefined`/`null` flow into `unitCost * amount` and render
 * as "$NaN". Missing persisted values fall back to on-the-fly computation
 * from current warehouse/recipe data rather than returning null.
 */
export function finiteOr(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
