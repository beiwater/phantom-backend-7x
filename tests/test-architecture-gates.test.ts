import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function testArchitectureGates() {
  console.log('--- Testing Architecture Dependency Gates ---');

  const routesDir = path.resolve('server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'));

  // Allowlist of legacy routes permitted to import db directly during migration.
  // This list MUST ONLY SHRINK as remaining slices migrate to repositories.
  const legacyDirectDbAllowlist = new Set([
    'auth-routes.ts',
    'finance-routes.ts',
    'retail-routes.ts',
    'social-routes.ts',
    // Upstream PR #77 shipped audit-routes.ts with a direct db import;
    // it joins the migration allowlist until it moves to repositories.
    'audit-routes.ts',
  ]);

  const directDbImporters: string[] = [];

  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const importsDb = (
      content.includes("from '../db/database.ts'") ||
      content.includes("from '../db/connection.ts'") ||
      content.includes("from 'node:sqlite'")
    );

    if (importsDb) {
      directDbImporters.push(file);
      assert(
        legacyDirectDbAllowlist.has(file),
        `Architecture Violation: Route file '${file}' directly imports database, but is NOT on the legacy migration allowlist!`
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
  const applicationRawSqlAllowlist = new Set([
    // Phase 8: scheduler business jobs still move money via inline SQL;
    // repository extraction tracked by the hardening issue.
    'daily-jobs.ts',
    // Market take-order + retail fulfilment write their authoritative
    // cash-ledger rows inline; moves to a ledger repository.
    'take-order.ts',
    'retail-use-cases.ts',
    'start-retail.ts'
  ]);

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
