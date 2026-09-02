import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { MigrationRunner, MigrationError, MIGRATIONS } from '../server/db/migrations/runner.ts';

console.log('=== Verifying Database Migration Runner & Schema Versioning (Issue #145) ===');

// [1/4] Fresh database bootstrap migration
console.log('[1/4] Testing migration of fresh database from scratch...');
const testDb = new DatabaseSync(':memory:');
const runner = new MigrationRunner(testDb);

assert.strictEqual(runner.getLatestSchemaVersion(), 0, 'Fresh DB must be at schema version 0');

const result = runner.runMigrations();
console.log(`  -> Applied ${result.appliedCount} migrations, latest version: v${result.currentVersion}`);
assert.strictEqual(result.appliedCount, MIGRATIONS.length, `Should apply all ${MIGRATIONS.length} migrations`);
assert.strictEqual(result.currentVersion, MIGRATIONS.length, `Latest schema version should be ${MIGRATIONS.length}`);
assert.strictEqual(runner.verifyIntegrity(), true, 'Database integrity check must pass');

const applied = runner.getAppliedMigrations();
assert.strictEqual(applied.length, MIGRATIONS.length, 'Applied migrations list length matches');
for (let i = 0; i < MIGRATIONS.length; i++) {
  assert.strictEqual(applied[i].version, i + 1);
  assert.strictEqual(applied[i].name, MIGRATIONS[i].name);
  assert.ok(applied[i].checksum, 'Checksum must be recorded');
}

// [2/4] Idempotency: re-running migrations should do nothing and remain safe
console.log('[2/4] Testing idempotency of migration runner...');
const rerunResult = runner.runMigrations();
assert.strictEqual(rerunResult.appliedCount, 0, 'No new migrations should be applied on repeat');
assert.strictEqual(rerunResult.currentVersion, MIGRATIONS.length, 'Version should remain unchanged');

// [3/4] Startup Protection & Rollback on failing migration
console.log('[3/4] Testing startup protection & rollback on migration failure...');
const failingDb = new DatabaseSync(':memory:');
const failingRunner = new MigrationRunner(failingDb);

// Inject an invalid failing migration definition
const originalMigrations = [...MIGRATIONS];
try {
  (MIGRATIONS as any).push({
    version: 999,
    name: '999_failing_migration',
    up: (db: DatabaseSync) => {
      db.exec('CREATE TABLE valid_test_tab (id INT);');
      db.exec('INVALID SQL SYNTAX THAT MUST THROW ERROR;');
    }
  });

  let errorThrown = false;
  try {
    failingRunner.runMigrations();
  } catch (err) {
    errorThrown = true;
    assert.ok(err instanceof MigrationError, 'Must throw MigrationError on failure');
    assert.strictEqual((err as MigrationError).version, 999);
    console.log(`  -> Caught expected startup protection error: ${(err as Error).message}`);
  }
  assert.strictEqual(errorThrown, true, 'Migration runner MUST abort on failure');

  // Verify that the failing migration was rolled back and NOT recorded in schema_migrations
  const appliedFailing = failingRunner.getAppliedMigrations();
  assert.strictEqual(appliedFailing.some(m => m.version === 999), false, 'Failing migration must not be recorded');
} finally {
  // Restore original migrations array
  MIGRATIONS.length = 0;
  MIGRATIONS.push(...originalMigrations);
}

// [4/4] Verify core tables exist and are functional
console.log('[4/4] Verifying core tables from migrated database...');
const tables = (testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(t => t.name);
const expectedTables = [
  'schema_migrations', 'players', 'companies', 'buildings', 'warehouse',
  'production_queues', 'market_orders', 'bonds', 'executives', 'restaurant_properties',
  'scheduler_state', 'retail_saturation'
];
for (const table of expectedTables) {
  assert.ok(tables.includes(table), `Table ${table} must exist in migrated database`);
}

console.log('================================================================');
console.log(' [OK] ISSUE #145 DATABASE MIGRATION CHECKS PASSED ALL TESTS');
console.log('================================================================');
