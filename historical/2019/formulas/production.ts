/**
 * Historical 2019 SimCompanies Production Formulas
 * Source: artifacts/archeology/golden-versions/2019-angular-django/reactjs.2ebf9ff0e2ef.early-react.js
 */

/**
 * Calculates hourly production capacity scaled by building size, production bonus modifier, and resource abundance.
 */
export function unitsAnHour(
  size: number,
  productionModifier: number,
  abundance: number,
  producedAnHour: number,
  dbLetter: string,
  abundanceDbLetters: string[] = ['m', 'o', 'c']
): number {
  const isAbundanceDependent = abundanceDbLetters.includes(dbLetter);
  const effectiveRate = isAbundanceDependent ? (producedAnHour * abundance) / 100 : producedAnHour;
  return (size * effectiveRate) / (1 - productionModifier / 100);
}

/**
 * Administrative overhead unit cost on worker wages.
 */
export function adminUnitCost(administrationOverhead: number, workerUnitCost: number): number {
  return Math.max(0, administrationOverhead - 1) * workerUnitCost;
}
