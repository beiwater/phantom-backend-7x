import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { MigrationRunner } from '../server/db/migrations/runner.ts';

/**
 * Issue #177: versioned migrations are the single schema authority.
 *
 * Structural equivalence: a database built ONLY from migrations must contain
 * every table and index the old dual-path bootstrap (connection.ts DDL +
 * patch migrations) produced, with matching columns for the critical tables.
 */

const migrated = new DatabaseSync(':memory:');
new MigrationRunner(migrated).runMigrations();

// The old effective fresh-DB schema: bootstrap DDL ran first, migrations
// second (CREATE IF NOT EXISTS skipped bootstrap shapes, guarded ALTERs
// patched drift). Reproduce it for the critical tables and compare shapes.
const legacy = new DatabaseSync(':memory:');
legacy.exec(`
  CREATE TABLE players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    theme TEXT DEFAULT 'light',
    language TEXT DEFAULT 'zh-cn',
    created_at TEXT
  );
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER UNIQUE,
    player_id INTEGER,
    name TEXT,
    money REAL DEFAULT 100000,
    simboosts INTEGER DEFAULT 250,
    level INTEGER DEFAULT 0,
    rating TEXT DEFAULT 'BBB',
    experience INTEGER DEFAULT 0,
    realm_id INTEGER DEFAULT 0,
    logo TEXT DEFAULT '',
    personal_assistant TEXT DEFAULT 'old',
    note TEXT DEFAULT '',
    extra_building_slots INTEGER DEFAULT 0,
    extra_executive_slots INTEGER DEFAULT 0,
    display_case_slots INTEGER DEFAULT 1,
    max_tags INTEGER DEFAULT 1,
    show_online_indicator INTEGER DEFAULT 1,
    moderator_sign INTEGER DEFAULT 0,
    created_at TEXT
  );
  CREATE TABLE buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    position TEXT,
    kind TEXT,
    size INTEGER DEFAULT 1,
    name TEXT,
    cost REAL DEFAULT 0,
    category TEXT DEFAULT 'production',
    busy_until TEXT,
    created_at TEXT,
    abundance REAL DEFAULT 100,
    original_abundance REAL DEFAULT 100,
    upkeep_active INTEGER DEFAULT 0,
    robots_installed INTEGER DEFAULT 0,
    robots_quality INTEGER DEFAULT 0,
    locked_product INTEGER
  );
  CREATE TABLE sessions (
    session_token TEXT PRIMARY KEY,
    player_id INTEGER,
    active_company_id INTEGER,
    created_at TEXT,
    expires_at TEXT
  );
  CREATE TABLE production_queues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER,
    company_id INTEGER,
    kind INTEGER,
    quality INTEGER DEFAULT 0,
    cost REAL,
    amount REAL,
    duration_seconds REAL,
    started_at TEXT,
    finishes_at TEXT,
    resolved INTEGER DEFAULT 0
  );
  CREATE TABLE bonds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_company_id INTEGER,
    buyer_company_id INTEGER,
    interest_rate REAL DEFAULT 0.005,
    amount REAL DEFAULT 5000,
    status TEXT DEFAULT 'active',
    created_at TEXT,
    maturity_date TEXT,
    settled INTEGER DEFAULT 0
  );
  CREATE TABLE executives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    avatar TEXT,
    position TEXT DEFAULT 'unassigned',
    skill_management INTEGER DEFAULT 5,
    skill_accounting INTEGER DEFAULT 5,
    skill_science INTEGER DEFAULT 5,
    skill_communication INTEGER DEFAULT 5,
    salary REAL DEFAULT 250,
    status TEXT DEFAULT 'employed',
    training_finish_at TEXT,
    work_history_accelerated INTEGER DEFAULT 0,
    plans_to_retire INTEGER DEFAULT 0,
    strike_until TEXT,
    created_at TEXT
  );
`);

function columns(database: DatabaseSync, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name).sort();
}

const CRITICAL_TABLES = [
  'players', 'companies', 'buildings', 'sessions', 'production_queues',
  'bonds', 'executives', 'market_orders', 'warehouse', 'cash_ledger',
  'contracts', 'loans', 'retail_orders', 'research', 'display_case',
  'finance_daily_snapshots', 'company_notes', 'company_settings',
  'notification_preferences', 'player_devices', 'achievements', 'chat_messages',
  'executive_trainings', 'schema_migrations',
  // previously created ad-hoc in runtime modules, now migration-only (#177)
  'rocket_launches', 'aerospace_sales_orders', 'audits', 'certificates',
  'company_achievements', 'company_boost_settings', 'fpa_custom_reports',
  'government_bids', 'government_bid_contractors', 'government_bid_blocked_companies',
  'newspaper_articles', 'newspaper_reactions', 'referrals'
];

// 1. Every critical table exists in the migrated database.
const migratedTables = new Set(
  (migrated.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(t => t.name)
);
for (const table of CRITICAL_TABLES) {
  assert.ok(migratedTables.has(table), `Table ${table} must exist in migrated schema`);
}

// 2. Column shapes of tables that existed in the legacy bootstrap are identical.
for (const table of ['players', 'companies', 'buildings', 'sessions', 'production_queues', 'bonds', 'executives']) {
  assert.deepStrictEqual(columns(migrated, table), columns(legacy, table),
    `Columns of ${table} must match the legacy bootstrap shape`);
}

// 3. Performance indices exist.
const migratedIndexes = new Set(
  (migrated.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IS NOT NULL").all() as Array<{ name: string }>).map(i => i.name)
);
for (const index of [
  'idx_players_email', 'idx_companies_player_id', 'idx_buildings_company_id',
  'idx_buildings_company_position', 'idx_production_queues_company_id',
  'idx_production_queues_company_building_resolved', 'idx_cash_ledger_company_created',
  'idx_finance_snapshots_company', 'idx_warehouse_company_id',
  'idx_warehouse_company_kind_quality', 'idx_market_orders_active',
  'idx_market_orders_seller_id', 'idx_market_orders_active_kind_quality_price',
  'idx_contracts_sender_company_id', 'idx_contracts_recipient_company_id',
  'idx_contracts_recipient_status', 'idx_bonds_status_buyer_seller',
  'uq_company_notes_owner', 'idx_executive_trainings_executive'
]) {
  assert.ok(migratedIndexes.has(index), `Index ${index} must exist`);
}

// 4. Migrations are idempotent (rerun applies nothing).
const runner = new MigrationRunner(migrated);
const rerun = runner.runMigrations();
assert.strictEqual(rerun.appliedCount, 0, 'Rerunning migrations must apply nothing');

console.log('PASS: migrated-only schema matches legacy bootstrap shape (#177)');
