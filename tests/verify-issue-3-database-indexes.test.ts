import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { MigrationRunner } from '../server/db/migrations/runner.ts';

const memDb = new DatabaseSync(':memory:');
const runner = new MigrationRunner(memDb);
runner.runMigrations();

console.log('--- Testing Issue #3: Database Indexes Optimization ---');

// Check index existence
const indexes = memDb.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string; tbl_name: string }>;
const indexNames = new Set(indexes.map(i => i.name));

const requiredIndexes = [
  'idx_warehouse_company_id',
  'idx_buildings_company_id',
  'idx_market_orders_active',
  'idx_production_queues_company_id',
  'idx_contracts_sender_company_id',
  'idx_contracts_recipient_company_id',
  'idx_players_email'
];

for (const req of requiredIndexes) {
  assert.ok(indexNames.has(req), `Index ${req} must exist`);
}

// Test EXPLAIN QUERY PLAN uses indexes
function checkPlanUsesIndex(query: string, expectedIndexName?: string) {
  const plan = memDb.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{ detail: string }>;
  const planDetail = plan.map(p => p.detail).join('; ');
  console.log(`Query: ${query} -> Plan: ${planDetail}`);
  assert.ok(planDetail.includes('USING INDEX'), `Query plan must use index: ${query}`);
  if (expectedIndexName) {
    assert.ok(planDetail.includes(expectedIndexName), `Query plan must use specific index ${expectedIndexName}`);
  }
}
checkPlanUsesIndex('SELECT * FROM warehouse WHERE company_id = 1', 'idx_warehouse_company_id');
checkPlanUsesIndex('SELECT * FROM buildings WHERE company_id = 1', 'idx_buildings_company');
checkPlanUsesIndex('SELECT * FROM market_orders WHERE active = 1', 'idx_market_orders_active');
checkPlanUsesIndex('SELECT * FROM production_queues WHERE company_id = 1', 'idx_production_queues_');
checkPlanUsesIndex('SELECT * FROM contracts WHERE sender_company_id = 1', 'idx_contracts_sender_company_id');
checkPlanUsesIndex('SELECT * FROM contracts WHERE recipient_company_id = 1', 'idx_contracts_recipient_company_id');
checkPlanUsesIndex("SELECT * FROM players WHERE email = 'test@example.com'", 'players');

console.log('PASS: Issue #3 database indexes verified with EXPLAIN QUERY PLAN');
