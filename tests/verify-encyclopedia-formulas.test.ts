/**
 * Focused verifier for the official encyclopedia production calculator.
 *
 * Inputs are loaded from the decompile's canonical resource/building/Ji data;
 * expected display values are transcribed from the saved official-frontend
 * Playwright screenshot. This deliberately does not use private-server route
 * defaults as authoritative formula inputs.
 *
 * Run: node --experimental-strip-types tests/verify-encyclopedia-formulas.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'server/data/decompile/resources.json'),
  'utf8'
)) as Array<Record<string, unknown>>;
const buildingsDocument = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'server/data/decompile/buildings.json'),
  'utf8'
)) as { buildings: Array<Record<string, unknown>> };
const lookups = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'server/data/decompile/resource_lookups.json'),
  'utf8'
)) as { Ji: { AVERAGE_SALARY: number; SALARY_MID: Record<string, number> } };

const screenshotPath = path.join(
  ROOT,
  'server/data/decompile/fixtures/encyclopedia-apples.png'
);
assert.ok(fs.existsSync(screenshotPath), `missing saved DOM evidence: ${screenshotPath}`);

const apples = resources.find(resource => resource.dbLetter === 3);
assert.ok(apples, 'canonical Apples resource (dbLetter 3) is required');
const farm = buildingsDocument.buildings.find(building => building.dbLetter === 'P');
assert.ok(farm, 'canonical farm building (dbLetter P) is required');

const rawProduction = Number(apples.producedPerHourRaw);
const producedAt = String(apples.producedAt);
const salaryModifier = Number(farm.salaryModifier);
const averageSalary = lookups.Ji.AVERAGE_SALARY;
const salaryMid = lookups.Ji.SALARY_MID;
assert.equal(rawProduction, 250);
assert.equal(producedAt, 'P');
assert.equal(salaryModifier, 0.3);
assert.equal(averageSalary, 345);
assert.deepEqual(salaryMid, { '0': 655, '1': 700, '2': 745 });

// Directly listed by _3(...) in the official bundle at offset 1,759,692.
const miningResourceKinds: Record<string, true> = {
  '10': true,
  '14': true,
  '15': true,
  '42': true,
  '44': true,
  '68': true,
  '74': true,
  '104': true,
  '105': true
};
const isMining = miningResourceKinds[String(apples.dbLetter)] === true;
assert.equal(isMining, false, 'Apples must use the non-mining branch');

function productionRate(options: {
  economyState: string;
  quality: number;
  size: number;
  productionModifier: number;
  recreationBonus: number;
  eventSpeedModifier: number;
  accumulatorBonus: number;
}): number {
  const salaryAdjustedRaw = rawProduction * Math.pow(
    averageSalary / Number(salaryMid[options.economyState]),
    salaryModifier
  );
  const qualityAdjusted = isMining ? salaryAdjustedRaw * options.quality / 100 : salaryAdjustedRaw;
  const eventAdjusted = qualityAdjusted * (1 + options.eventSpeedModifier / 100);
  const totalSalaryPercent = options.productionModifier + options.recreationBonus + options.accumulatorBonus;
  return options.size * eventAdjusted / (1 - totalSalaryPercent / 100);
}

function display2(value: number): string {
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function displayPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    maximumFractionDigits: 2
  }).format(value);
}

// Screenshot fields: level 1, no robots, 0% production speed increase,
// administration overhead 3.1%, 202.19 units/hour, $0.51 worker, $0.02 admin.
const screenshot = {
  level: 1,
  quality: 100,
  acceleration: 1,
  productionModifier: 0,
  recreationBonus: 0,
  eventSpeedModifier: 0,
  accumulatorBonus: 0,
  administrationOverheadPercent: 3.1,
  cooSkill: 0,
  unitsAnHour: '202.19',
  unitWorkerCost: '0.51',
  unitAdminCost: '0.02'
};

const common = {
  quality: screenshot.quality,
  size: screenshot.level,
  productionModifier: screenshot.productionModifier,
  recreationBonus: screenshot.recreationBonus,
  eventSpeedModifier: screenshot.eventSpeedModifier,
  accumulatorBonus: screenshot.accumulatorBonus
};
const candidates = Object.keys(salaryMid).map(economyState => ({
  economyState,
  rate: productionRate({ ...common, economyState })
}));
const matchingStates = candidates.filter(candidate => display2(candidate.rate) === screenshot.unitsAnHour);
assert.deepEqual(matchingStates.map(candidate => candidate.economyState), ['1'], 'screenshot rate identifies normal salary state');
const rate = matchingStates[0].rate;
assert.equal(display2(rate), screenshot.unitsAnHour);
assert.equal(displayPercent(100 * (1.031 - 1)), '3.1');

const effectiveOverhead = 1.031 - (1.031 - 1) * screenshot.cooSkill / 100;
const workerWagePerHour = averageSalary * salaryModifier;
const workerCost = workerWagePerHour / rate;
const adminCost = Math.max(0, effectiveOverhead - 1) * workerCost;
assert.equal(display2(workerCost), screenshot.unitWorkerCost);
assert.equal(display2(adminCost), screenshot.unitAdminCost);

// Boundary: the bundle's non-mining branch ignores quality for Apples.
assert.equal(
  productionRate({ ...common, economyState: '1', quality: 0 }),
  productionRate({ ...common, economyState: '1', quality: 100 })
);
// Units: the displayed rate is a per-hour rate; increasing size scales it.
assert.equal(
  productionRate({ ...common, economyState: '1', size: 2 }),
  rate * 2
);

console.log('PASS encyclopedia production formula matches saved official DOM values (Apples)');
console.log('SKIP retail/profit/reference-price numeric checks: no saved official retail-info/ticker Network fixture is paired with the DOM evidence.');
