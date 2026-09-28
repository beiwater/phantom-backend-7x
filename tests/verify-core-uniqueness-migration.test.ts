import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MigrationRunner } from '../server/db/migrations/runner.ts';

const database = new DatabaseSync(':memory:');
try {
  const runner = new MigrationRunner(database);
  runner.runMigrations();
  const addBuilding = database.prepare("INSERT INTO buildings (company_id, position, kind) VALUES (1, ?, 'P')");
  addBuilding.run('0');
  assert.throws(() => addBuilding.run('0'), /UNIQUE constraint failed/);
  addBuilding.run('l');
  addBuilding.run('l');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM buildings WHERE position = 'l'").get()?.count, 2);
  for (const [table, columns, values] of [
    ['warehouse', 'company_id, kind, quality', '1, 3, 0'],
    ['research', 'company_id, discipline', '1, 29'],
    ['display_case', 'company_id, slot', '1, 0']
  ]) {
    const insert = database.prepare(`INSERT INTO ${table} (${columns}) VALUES (${values})`);
    insert.run();
    assert.throws(() => insert.run(), /UNIQUE constraint failed/);
  }
  assert.equal(runner.runMigrations().appliedCount, 0, 'restarting must not reapply a migration');

  // Reproduce an existing version-37 database with ambiguous inventory.
  // The upgrade must abort atomically and preserve both rows for recovery.
  database.exec(`
    DROP INDEX uq_warehouse_company_kind_quality;
    DELETE FROM schema_migrations WHERE version >= 38;
    INSERT INTO warehouse (company_id, kind, quality, amount, cost_market) VALUES (1, 3, 0, 7, 50);
  `);
  assert.throws(() => runner.runMigrations(), /Duplicate warehouse.*reconcile/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM warehouse WHERE company_id = 1 AND kind = 3').get()?.count, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 38').get()?.count, 0);
  console.log('PASS core uniqueness, lifted slots, restart and non-destructive legacy migration');
} finally {
  database.close();
}
