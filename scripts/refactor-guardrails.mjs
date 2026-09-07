import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { parse } = require('@babel/parser');

const BASELINE_DIR = path.join(process.cwd(), '.guardrails');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getTsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getTsFiles(fullPath));
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// 1. Export Surface Extractor
export function extractExportSurface() {
  const files = getTsFiles(path.join(process.cwd(), 'server'));
  const surface = {};

  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    const code = fs.readFileSync(f, 'utf-8');
    let ast;
    try {
      ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy'],
        errorRecovery: true,
      });
    } catch {
      continue;
    }

    const exported = [];
    for (const node of ast.program.body) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          const d = node.declaration;
          if (d.id?.name) exported.push(d.id.name);
          else if (d.declarations) {
            for (const dec of d.declarations) {
              if (dec.id?.name) exported.push(dec.id.name);
            }
          }
        }
        if (node.specifiers) {
          for (const s of node.specifiers) {
            if (s.exported?.name) exported.push(s.exported.name);
          }
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        exported.push('default');
      }
    }
    exported.sort();
    surface[rel] = exported;
  }
  return surface;
}

// 2. Route Inventory Extractor
export async function extractRouteInventory() {
  const { globalRouteRegistry } = await import('../server/http/route-registry.ts');
  const { methodManifest } = await import('../server/router.ts');

  const declarative = globalRouteRegistry.routes.map(r => ({
    method: r.method,
    pattern: r.pattern,
    owner: r.owner || 'unknown'
  })).sort((a, b) => `${a.method} ${a.pattern}`.localeCompare(`${b.method} ${b.pattern}`));

  const legacy = methodManifest.map(m => ({
    methods: [...m.methods].sort(),
    pattern: m.pattern.source,
    owner: m.owner
  })).sort((a, b) => a.pattern.localeCompare(b.pattern));

  return {
    declarativeCount: declarative.length,
    legacyCount: legacy.length,
    declarative,
    legacy
  };
}

// 3. Database Schema Dump Extractor
export async function extractDatabaseSchema() {
  const db = new DatabaseSync(':memory:');
  const { MigrationRunner } = await import('../server/db/migrations/runner.ts');
  const runner = new MigrationRunner(db);
  runner.runMigrations();

  const rows = db.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_%'
      AND name != 'schema_migrations'
    ORDER BY type, name
  `).all();

  return rows.map(r => ({
    type: r.type,
    name: r.name,
    sql: r.sql ? r.sql.replace(/\s+/g, ' ').trim() : ''
  }));
}

const command = process.argv[2] || 'verify';

if (command === 'record') {
  ensureDir(BASELINE_DIR);
  console.log('[Guardrails] Recording current baseline...');

  const exportsSurface = extractExportSurface();
  fs.writeFileSync(
    path.join(BASELINE_DIR, 'exports-baseline.json'),
    JSON.stringify(exportsSurface, null, 2)
  );
  console.log(`  -> Recorded export surface across ${Object.keys(exportsSurface).length} files.`);

  extractRouteInventory().then(routes => {
    fs.writeFileSync(
      path.join(BASELINE_DIR, 'routes-baseline.json'),
      JSON.stringify(routes, null, 2)
    );
    console.log(`  -> Recorded route inventory: ${routes.declarativeCount} declarative, ${routes.legacyCount} legacy.`);

    return extractDatabaseSchema();
  }).then(schema => {
    fs.writeFileSync(
      path.join(BASELINE_DIR, 'schema-baseline.json'),
      JSON.stringify(schema, null, 2)
    );
    console.log(`  -> Recorded DB schema: ${schema.length} objects.`);
    console.log('[Guardrails] Baseline recorded successfully in .guardrails/');
  }).catch(err => {
    console.error('[Guardrails] Error recording baseline:', err);
    process.exit(1);
  });

} else if (command === 'verify') {
  console.log('[Guardrails] Verifying against baseline in .guardrails/ ...');
  if (!fs.existsSync(path.join(BASELINE_DIR, 'routes-baseline.json'))) {
    console.error('[Guardrails] Error: Baseline not found. Run "node scripts/refactor-guardrails.mjs record" first.');
    process.exit(1);
  }

  let failed = false;

  // Verify Routes
  const baseRoutes = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'routes-baseline.json'), 'utf-8'));
  extractRouteInventory().then(currentRoutes => {
    if (currentRoutes.declarativeCount < baseRoutes.declarativeCount) {
      console.error(`[Guardrails FAIL] Declarative route count dropped! Baseline: ${baseRoutes.declarativeCount}, Current: ${currentRoutes.declarativeCount}`);
      failed = true;
    } else {
      console.log(`[Guardrails PASS] Declarative routes intact (${currentRoutes.declarativeCount} >= ${baseRoutes.declarativeCount})`);
    }

    // Check that every baseline declarative route still exists
    const currMap = new Set(currentRoutes.declarative.map(r => `${r.method} ${r.pattern}`));
    const missingRoutes = baseRoutes.declarative.filter(r => !currMap.has(`${r.method} ${r.pattern}`));
    if (missingRoutes.length > 0) {
      console.error('[Guardrails FAIL] Missing routes detected:', missingRoutes);
      failed = true;
    } else {
      console.log('[Guardrails PASS] All baseline routes exist in current inventory.');
    }

    // Verify DB Schema
    return extractDatabaseSchema().then(currSchema => {
      const baseSchema = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'schema-baseline.json'), 'utf-8'));
      const baseMap = new Map(baseSchema.map(s => [s.name, s.sql]));
      const currMapSchema = new Map(currSchema.map(s => [s.name, s.sql]));

      let schemaDiff = 0;
      for (const [name, sql] of baseMap.entries()) {
        if (!currMapSchema.has(name)) {
          console.error(`[Guardrails FAIL] DB object dropped: ${name}`);
          schemaDiff++;
          failed = true;
        } else if (currMapSchema.get(name) !== sql) {
          console.error(`[Guardrails FAIL] DB object definition changed for ${name}:`);
          console.error(`  Baseline: ${sql}`);
          console.error(`  Current:  ${currMapSchema.get(name)}`);
          schemaDiff++;
          failed = true;
        }
      }
      if (schemaDiff === 0) {
        console.log(`[Guardrails PASS] Database schema identical (${currSchema.length} objects).`);
      }

      // Verify Export Surface
      const baseExports = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'exports-baseline.json'), 'utf-8'));
      const currExports = extractExportSurface();

      let missingExportsCount = 0;
      for (const [file, exportsList] of Object.entries(baseExports)) {
        const currList = new Set(currExports[file] || []);
        for (const exp of exportsList) {
          if (!currList.has(exp)) {
            // Check if export was moved to another file
            let foundElsewhere = false;
            for (const otherExports of Object.values(currExports)) {
              if (otherExports.includes(exp)) {
                foundElsewhere = true;
                break;
              }
            }
            if (!foundElsewhere) {
              console.error(`[Guardrails FAIL] Exported symbol "${exp}" from ${file} was removed and not found anywhere!`);
              missingExportsCount++;
              failed = true;
            }
          }
        }
      }

      if (missingExportsCount === 0) {
        console.log('[Guardrails PASS] Public export surface intact (no deleted symbols).');
      }

      if (failed) {
        console.error('\n[Guardrails] VERIFICATION FAILED: Refactoring violated external behavioral/contract invariants!');
        process.exit(1);
      } else {
        console.log('\n[Guardrails] ALL REFLECTION & BEHAVIORAL GATES PASSED! Zero contract loss.');
      }
    });
  }).catch(err => {
    console.error('[Guardrails] Error during verification:', err);
    process.exit(1);
  });
}
