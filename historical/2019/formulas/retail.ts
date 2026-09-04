/**
 * Historical 2019 SimCompanies Retail Economic Formulas
 * Source: artifacts/archeology/golden-versions/2019-angular-django/reactjs.2ebf9ff0e2ef.early-react.js
 * Extracted verbatim from original unflattened React bundle.
 */

/**
 * Dynamic retail evaluation modeled on server/client.
 * Evaluates polynomial or custom formula defined in resource.retailModeling.
 */
export function timeModeling(retailModeling: string, saturation: number, amount: number, price: number): number {
  // Original 2019 implementation used eval(retailModeling) with scope variables: saturation, amount, price
  const fn = new Function('saturation', 'amount', 'price', `return ${retailModeling};`);
  return fn(saturation, amount, price);
}

/**
 * Hourly units sold taking into account market saturation, quality dampening, and sales modifier.
 * Anti-saturation constant is 0.24 per quality tier, lower bounded by 0.1.
 */
export function unitsSoldAnHour(
  salesModifier: number,
  price: number,
  quality: number,
  marketSaturation: number,
  retailModeling: string
): number {
  const effectiveSaturation = Math.max(marketSaturation - 0.24 * quality, 0.1);
  const baseDuration = timeModeling(retailModeling, effectiveSaturation, 100, price);
  return 360000 / (baseDuration - (baseDuration * salesModifier) / 100);
}

/**
 * Net profit per unit after deducting base wage per store size scaled by administrative overhead.
 */
export function profitPerUnit(
  salesModifier: number,
  price: number,
  quality: number,
  marketSaturation: number,
  retailModeling: string,
  administrationOverhead: number,
  storeBaseSalary: number
): number {
  const hourly = unitsSoldAnHour(salesModifier, price, quality, marketSaturation, retailModeling);
  return price - (storeBaseSalary * administrationOverhead) / hourly;
}
