import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

function filesIn(directory: string): string[] {
  return fs.readdirSync(directory, { recursive: true })
    .map(String).filter(file => file.endsWith('.ts'));
}

function imports(source: string) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  return ast.program.body.flatMap(statement => {
    if (statement.type !== 'ImportDeclaration' && statement.type !== 'ExportNamedDeclaration'
      && statement.type !== 'ExportAllDeclaration') return [];
    if (!statement.source) return [];
    const typeOnly = statement.type === 'ImportDeclaration'
      ? statement.importKind === 'type' : statement.exportKind === 'type';
    if (typeOnly) return [];
    const names = statement.type === 'ExportAllDeclaration' ? ['*'] : statement.specifiers.flatMap(specifier => {
      if (specifier.type === 'ImportSpecifier') {
        if (specifier.importKind === 'type') return [];
        return [specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value];
      }
      if (specifier.type === 'ExportSpecifier') {
        if (specifier.exportKind === 'type') return [];
        return [specifier.local.name];
      }
      return ['*'];
    });
    return names.length ? [{ from: statement.source.value.replaceAll('\\', '/'), names }] : [];
  });
}

function assertNoSql(source: string, file: string): void {
  assert(!/\b(?:db|database|connection)\s*\.\s*(?:prepare|exec)\s*\(/.test(source),
    `${file} executes SQL outside a repository`);
  for (const dependency of imports(source)) {
    assert(!/\/(?:db\/(?:database|connection)|db\/)\.ts$/.test(dependency.from)
      && dependency.from !== 'node:sqlite', `${file} imports a SQL connection`);
  }
}

// Temporary debt is listed by exact symbols, never as a whole game module.
// Migrated finance/executives/scheduler engines have NO exception (#179).
const remainingMutationDebt: Record<string, readonly string[]> = {
  'restaurant/restaurant-use-cases.ts:restaurant': [
    'getRestaurantProperties', 'updateRestaurantProperties', 'getRestaurantRuns',
    'executeRestaurantRun', 'getRestaurantBusy', 'getLegacyRestaurantProperties',
    'resolveDueRestaurantRuns', 'getRestaurantMenuGuide', 'getRestaurantRatings',
    'getLegacyRestaurantRun', 'RESTAURANT_DISHES', 'validateRestaurantMenuPrice'
  ]
};
const pureLegacyHelpers: Record<string, readonly string[]> = {
  constants: ['getResourceDef', 'CONSTANTS_RESOURCES'],
  robotics: ['assertNotRoboticsLocked', 'ROBOT_RESOURCE_KIND', 'ROBOTICS_WAGE_MULTIPLIER',
    'requiredRobotCount', 'requiredRobotQuality', 'hasRobotsInstalled', 'assertSpecializableProduct',
    'uninstallRobotReturnCount', 'assertAllowedProduct'],
  aerospace: ['rocketKindForLaunchAmount', 'rocketKindForLaunchRequest'],
  buildings: ['initialAbundanceForKind', 'isAbundanceExtractorKind', 'scaleExtractorOutput']
};
// Each retained query was checked for hidden writes; restaurant getters settle
// or initialize data and are deliberately classified as mutation debt above.
const readonlyLegacyQueries: Record<string, readonly string[]> = {
  buildings: ['getBuildingAbundance'],
  encyclopedia: ['getCompanyRankings'],
  'simboost-settings': ['getCompanyBoostSettings'],
  research: ['getProductionQualityCap']
};

for (const directory of ['server/routes', 'server/application', 'server/compatibility']) {
  for (const file of filesIn(directory)) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    assertNoSql(source, `${directory}/${file}`);
    if (directory !== 'server/application') continue;
    for (const dependency of imports(source)) {
      const match = dependency.from.match(/\/game\/([^/]+)\.ts$/);
      if (!match) continue;
      const module = match[1];
      const debt = remainingMutationDebt[`${file.replaceAll('\\', '/') }:${module}`] ?? [];
      const helpers = pureLegacyHelpers[module] ?? [];
      const queries = readonlyLegacyQueries[module] ?? [];
      for (const name of dependency.names) {
        assert(helpers.includes('*') || helpers.includes(name) || queries.includes(name) || debt.includes(name),
          `application/${file} imports legacy game mutation ${module}.${name}; migrate it before importing`);
      }
    }
  }
}
for (const file of filesIn('server/domain')) {
  const source = fs.readFileSync(path.join('server/domain', file), 'utf8');
  for (const dependency of imports(source)) {
    assert(!/(?:db\/|repositories\/|application\/|routes\/|core\/virtual-clock|^node:)/.test(dependency.from),
      `domain/${file} imports IO: ${dependency.from}`);
  }
}
const timetable = fs.readFileSync('server/scheduler/timetable.ts', 'utf8');
assert(timetable.split('\n').length <= 150, 'scheduler lifecycle must stay within 150 lines (#104)');
assertNoSql(timetable, 'scheduler/timetable.ts');
console.log('PASS recursive route/application SQL gates, domain purity, exact legacy import debt, and scheduler boundary');
