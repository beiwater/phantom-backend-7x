import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from '../config.ts';

fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
const dbPath = path.join(CONFIG.DATA_DIR, 'simcompanies.sqlite');
export const db = new DatabaseSync(dbPath);

export function initializeDatabaseSchema(database: DatabaseSync = db): void {
  // Initialize all core tables
  database.exec(`
    CREATE TABLE IF NOT EXISTS players (
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

    CREATE TABLE IF NOT EXISTS sessions (
      session_token TEXT PRIMARY KEY,
      player_id INTEGER,
      active_company_id INTEGER,
      created_at TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS companies (
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

    CREATE TABLE IF NOT EXISTS buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      position TEXT,
      kind TEXT,
      size INTEGER DEFAULT 1,
      name TEXT,
      cost REAL DEFAULT 0,
      category TEXT DEFAULT 'production',
      busy_until TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS production_queues (
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

    CREATE TABLE IF NOT EXISTS retail_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_id INTEGER,
      company_id INTEGER,
      resource_kind INTEGER,
      quality INTEGER DEFAULT 0,
      units REAL,
      unit_price REAL,
      cost REAL,
      finished_at TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS warehouse (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      kind INTEGER,
      quality INTEGER DEFAULT 0,
      amount REAL DEFAULT 0,
      cost_workers REAL DEFAULT 0,
      cost_admin REAL DEFAULT 0,
      cost_material1 REAL DEFAULT 0,
      cost_material2 REAL DEFAULT 0,
      cost_market REAL DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS market_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER,
      kind INTEGER,
      quality INTEGER DEFAULT 0,
      quantity REAL,
      price REAL,
      fees REAL DEFAULT 0,
      posted_at TEXT,
      active INTEGER DEFAULT 1,
      is_npc INTEGER DEFAULT 0,
      cost_workers REAL DEFAULT 0,
      cost_admin REAL DEFAULT 0,
      cost_material1 REAL DEFAULT 0,
      cost_material2 REAL DEFAULT 0,
      cost_market REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_company_id INTEGER,
      recipient_company_id INTEGER,
      kind INTEGER,
      quality INTEGER DEFAULT 0,
      amount REAL,
      price REAL,
      status TEXT DEFAULT 'pending',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS bonds (
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

    CREATE TABLE IF NOT EXISTS executives (
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
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      discipline INTEGER,
      points INTEGER DEFAULT 0,
      patents INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS display_case (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      slot INTEGER,
      resource_kind INTEGER,
      quality INTEGER DEFAULT 0,
      title TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      achievement_id INTEGER,
      level INTEGER DEFAULT 1,
      progress REAL DEFAULT 100,
      unlocked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT,
      sender_id INTEGER,
      sender_company TEXT,
      text TEXT,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      principal REAL,
      interest_rate REAL DEFAULT 0.1,
      remaining REAL,
      status TEXT DEFAULT 'active',
      created_at TEXT,
      due_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cash_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      description_key TEXT,
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_daily_snapshots (
      company_id INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      total REAL DEFAULT 0,
      current_assets REAL DEFAULT 0,
      non_current_assets REAL DEFAULT 0,
      liabilities REAL DEFAULT 0,
      economic_value_added REAL DEFAULT 0,
      eva_profit REAL DEFAULT 0,
      eva_rank INTEGER DEFAULT 0,
      rank INTEGER DEFAULT 0,
      cash_and_receivables REAL DEFAULT 0,
      inventory REAL DEFAULT 0,
      buildings REAL DEFAULT 0,
      patents REAL DEFAULT 0,
      investment_in_bonds REAL DEFAULT 0,
      deposits REAL DEFAULT 0,
      created_at TEXT,
      PRIMARY KEY (company_id, snapshot_date)
    );
    CREATE TABLE IF NOT EXISTS player_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER,
      device_uuid TEXT,
      device_name TEXT,
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      company_id INTEGER PRIMARY KEY,
      email_json TEXT DEFAULT '{}',
      popup_json TEXT DEFAULT '{}',
      push_json TEXT DEFAULT '{}',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS company_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      about_company_id INTEGER NOT NULL,
      note TEXT DEFAULT '',
      priority INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (company_id, about_company_id)
    );
    CREATE INDEX IF NOT EXISTS idx_company_notes_owner
      ON company_notes(company_id, about_company_id);

    CREATE TABLE IF NOT EXISTS company_settings (
      company_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (company_id, key)
    );
  `);

  // C-11: unique ownership constraint so note upserts (ON CONFLICT) work on
  // databases created before the constraint existed.
  const noteIndexes = (database.prepare('PRAGMA index_list(company_notes)').all() as Array<{ name: string; unique: number }>)
    .filter(index => index.unique);
  if (!noteIndexes.some(index => index.name === 'uq_company_notes_owner')) {
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_company_notes_owner ON company_notes(company_id, about_company_id)');
  }

  // Create standard indices for performance and ownership checks
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
    CREATE INDEX IF NOT EXISTS idx_companies_player_id ON companies(player_id);
    CREATE INDEX IF NOT EXISTS idx_buildings_company_id ON buildings(company_id);
    CREATE INDEX IF NOT EXISTS idx_buildings_company_position ON buildings(company_id, position);
    CREATE INDEX IF NOT EXISTS idx_production_queues_company_id ON production_queues(company_id);
    CREATE INDEX IF NOT EXISTS idx_production_queues_company_building_resolved
      ON production_queues(company_id, building_id, resolved);
    CREATE INDEX IF NOT EXISTS idx_cash_ledger_company_created
      ON cash_ledger(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_finance_snapshots_company
      ON finance_daily_snapshots(company_id, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_warehouse_company_id ON warehouse(company_id);
    CREATE INDEX IF NOT EXISTS idx_warehouse_company_kind_quality
      ON warehouse(company_id, kind, quality);
    CREATE INDEX IF NOT EXISTS idx_market_orders_active ON market_orders(active);
    CREATE INDEX IF NOT EXISTS idx_market_orders_seller_id ON market_orders(seller_id);
    CREATE INDEX IF NOT EXISTS idx_market_orders_active_kind_quality_price
      ON market_orders(active, kind, quality, price);
    CREATE INDEX IF NOT EXISTS idx_contracts_sender_company_id ON contracts(sender_company_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_recipient_company_id ON contracts(recipient_company_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_recipient_status
      ON contracts(recipient_company_id, status);
    CREATE INDEX IF NOT EXISTS idx_bonds_status_buyer_seller
      ON bonds(status, buyer_company_id, seller_company_id);
  `);
  // Enable foreign key enforcement at connection level
  database.exec('PRAGMA foreign_keys = ON');
}
