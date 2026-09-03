import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function testArchitectureGates() {
  console.log('--- Testing Architecture Dependency Gates ---');

  const routesDir = path.resolve('server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'));

  // Issue #180: the migration allowlist is now EMPTY — no route file may
  // import db directly, import node:sqlite, or execute raw statements.
  // Persistence belongs to repositories; routes do HTTP + use cases only.
  const legacyDirectDbAllowlist = new Set<string>([]);

  // Patterns that constitute direct persistence access from a route (#180):
  // explicit db/connection imports, node:sqlite, raw statement execution and
  // indirect imports through the db compatibility barrel.
  const ROUTE_DB_PATTERNS: Array<[RegExp, string]> = [
    [/from\s+['"]\.\.\/db\/database\.ts['"]/, 'imports db/database.ts'],
    [/from\s+['"]\.\.\/db\/connection\.ts['"]/, 'imports db/connection.ts'],
    [/from\s+['"]\.\.\/db\/['"]/, 'imports db barrel'],
    [/from\s+['"]node:sqlite['"]/, 'imports node:sqlite'],
    [/\bdb\.prepare\s*\(/, 'executes db.prepare'],
    [/\bdb\.exec\s*\(/, 'executes db.exec']
  ];

  const directDbImporters: string[] = [];

  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const violations = ROUTE_DB_PATTERNS
      .filter(([pattern]) => pattern.test(content))
      .map(([, label]) => label);

    if (violations.length > 0) {
      directDbImporters.push(file);
      assert(
        legacyDirectDbAllowlist.has(file),
        `Architecture Violation: Route file '${file}' directly accesses persistence (${violations.join(', ')}), but is NOT on the legacy migration allowlist!`
      );
    }
  }

  // Explicit check: building-routes.ts MUST NOT import db directly!
  assert(
    !directDbImporters.includes('building-routes.ts'),
    'Architecture Violation: Migrated building-routes.ts must NOT import db directly!'
  );

  // Application use cases orchestrate repositories/use cases; raw SQL belongs
  // in repositories. Legacy violators are enumerated so the list can only
  // shrink (same policy as the route allowlist above).
  const appDir = path.resolve('server/application');
  const applicationRawSqlAllowlist = new Set<string>([]);

  const applicationViolations: string[] = [];
  for (const entry of fs.readdirSync(appDir, { recursive: true })) {
    const rel = String(entry);
    if (!rel.endsWith('.ts')) continue;
    const content = fs.readFileSync(path.join(appDir, rel), 'utf-8');
    if (content.includes('db.prepare(') || content.includes('db.exec(')) {
      applicationViolations.push(rel);
      const base = path.basename(rel);
      assert(
        applicationRawSqlAllowlist.has(base),
        `Architecture Violation: application/${rel} executes raw SQL (db.prepare/db.exec) — move it to a repository`
      );
    }
  }

  // --- Domain purity: zero IO imports --------------------------------------
  const domainDir = path.resolve('server/domain');
  for (const entry of fs.readdirSync(domainDir, { recursive: true })) {
    const rel = String(entry);
    if (!rel.endsWith('.ts')) continue;
    const content = fs.readFileSync(path.join(domainDir, rel), 'utf-8');
    assert(
      !/from\s+['"].*(db\/|repositories\/|routes\/|node:http)/.test(content),
      `Architecture Violation: domain/${rel} imports IO (db/repositories/routes/http) — domain must stay pure`
    );
  }

  console.log(`Verified ${routeFiles.length} route files:`);
  console.log(`- Migrated routes without direct DB imports: ${routeFiles.length - directDbImporters.length}`);
  console.log(`- Remaining legacy routes on migration allowlist: ${directDbImporters.length} (${directDbImporters.join(', ')})`);
  console.log(`- Application files with raw SQL (allowlisted): ${applicationViolations.length} (${applicationViolations.join(', ')})`);
  console.log('✅ Architecture Gates passed successfully!');
}

try {
  testArchitectureGates();
} catch (err) {
  console.error('❌ Architecture Gates failed:', err);
  process.exit(1);
}
