import { buildingRepository } from '../../repositories/building-repository.ts';
import { abundanceFromRandom, decayAbundance, isAbundanceExtractorKind, type AbundanceValues } from '../../domain/buildings/building-rules.ts';

export function rollAbundancePercent(): number {
  let u1 = Math.random();
  while (u1 <= Number.EPSILON) u1 = Math.random();
  return abundanceFromRandom(u1, Math.random());
}

export function initialAbundanceForKind(kind: string): AbundanceValues {
  const abundance = isAbundanceExtractorKind(kind) ? rollAbundancePercent() : 100;
  return { abundance, originalAbundance: abundance };
}

export function getBuildingAbundance(buildingId: number): AbundanceValues | null {
  const row = buildingRepository.findAbundance(buildingId);
  return row ? { abundance: row.abundance, originalAbundance: row.originalAbundance } : null;
}

/** Called inside the owned production lifecycle's transaction. */
export function applyAbundanceCycleDecay(buildingId: number): number | null {
  const row = buildingRepository.findAbundance(buildingId);
  if (!row || !isAbundanceExtractorKind(row.kind)) return null;
  const abundance = decayAbundance(row.abundance);
  buildingRepository.updateAbundance(buildingId, abundance);
  return abundance;
}
