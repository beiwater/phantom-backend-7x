import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CONFIG } from '../config.ts';
import { CONSTANTS_RESOURCES } from '../game/constants.ts';

fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
const dbPath = path.join(CONFIG.DATA_DIR, 'simcompanies.sqlite');
export const db = new DatabaseSync(dbPath);

// Initialize all database schemas
db.exec(`
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
    token TEXT PRIMARY KEY,
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
    level INTEGER DEFAULT 5,
    rating TEXT DEFAULT 'BBB',
    experience INTEGER DEFAULT 20,
    realm_id INTEGER DEFAULT 0,
    logo TEXT DEFAULT '',
    personal_assistant TEXT DEFAULT 'old',
    note TEXT DEFAULT '',
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
    units REAL,
    unit_price REAL,
    cost REAL,
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
    active INTEGER DEFAULT 1
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

  CREATE TABLE IF NOT EXISTS player_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    device_uuid TEXT,
    device_name TEXT,
    last_login TEXT
  );
`);

// Legacy DB migration: add bond maturity columns if missing (issue #42)
{
  const bondCols = (db.prepare('PRAGMA table_info(bonds)').all() as { name: string }[]).map((c) => c.name);
  if (!bondCols.includes('maturity_date')) db.exec('ALTER TABLE bonds ADD COLUMN maturity_date TEXT');
  if (!bondCols.includes('settled')) db.exec('ALTER TABLE bonds ADD COLUMN settled INTEGER DEFAULT 0');
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function seedMarketOrders() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM market_orders WHERE active = 1').get() as { count: number };
  if (countRow.count > 100) return;

  console.log('Seeding market with Q0-Q12 orders for all resources...');
  const insertStmt = db.prepare(`
    INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
    VALUES (999900, ?, ?, 100000, ?, 0, ?, 1)
  `);
  const now = new Date().toISOString();

  for (const [kindStr, def] of Object.entries(CONSTANTS_RESOURCES)) {
    const kind = Number(kindStr);
    if (def.isExchangeTradable === false) continue;
    for (let q = 0; q <= 12; q++) {
      const price = 1.0 + q;
      insertStmt.run(kind, q, price, now);
    }
  }
}

export function registerPlayer(email: string, password: string, companyName?: string) {
  const existing = db.prepare('SELECT * FROM players WHERE email = ?').get(email);
  if (existing) throw new Error('Email already registered');

  const playerId = Math.floor(2000000 + Math.random() * 8000000);
  const companyId = Math.floor(4000000 + Math.random() * 6000000);
  const now = new Date().toISOString();
  const cName = companyName || email.split('@')[0] || `Co-${companyId}`;

  db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(playerId, email, hashPassword(password), now);

  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 20, 0, '', 'old', 'Private Server Company', ?)
  `).run(companyId, playerId, cName, CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
  `).run(companyId, now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '1', 'G', 1, 'Grocery store', 10350, 'sales', ?)
  `).run(companyId, now);

  const seedStock = [
    { kind: 1, amount: 20000 },
    { kind: 2, amount: 20000 },
    { kind: 66, amount: 10000 },
    { kind: 13, amount: 20000 },
    { kind: 3, amount: 5000 },
    { kind: 4, amount: 5000 },
    { kind: 119, amount: 5000 },
    { kind: 101, amount: 5000 },
    { kind: 102, amount: 5000 },
    { kind: 108, amount: 5000 },
    { kind: 111, amount: 5000 }
  ];
  for (const s of seedStock) {
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, 0, ?, 0, 0, 0, 0, 1.0, ?)
    `).run(companyId, s.kind, s.amount, now);
  }

  return { playerId, companyId };
}

export interface PlayerDbRow {
  id: number;
  player_id: number;
  email: string;
  password_hash?: string;
  password?: string;
  is_admin: number;
}

export function authenticatePlayer(email: string, password: string) {
  const player = db.prepare('SELECT * FROM players WHERE email = ?').get(email) as PlayerDbRow | undefined;
  if (!player) throw new Error('User not found');

  const hashed = hashPassword(password);
  if (player.password_hash !== hashed && player.password !== password) throw new Error('Invalid password');

  const company = db.prepare('SELECT * FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1').get(player.player_id) as { company_id: number } | undefined;
  return {
    playerId: player.player_id,
    companyId: company ? company.company_id : 4259175
  };
}

// Seed default player and company if empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM players');
const row = countStmt.get() as { count: number };
if (row.count === 0) {
  console.log('Seeding initial private server game database...');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(2920233, 'admin@simcompanies.local', hashPassword('admin123'), now);

  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 25, 0, '', 'old', 'Private Server Company', ?)
  `).run(4259175, 2920233, 'lifeline', CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
  `).run(4259175, now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '1', 'G', 1, 'Grocery store', 10350, 'sales', ?)
  `).run(4259175, now);

  const seedStock = [
    { kind: 1, amount: 20000, quality: 0 },
    { kind: 2, amount: 20000, quality: 0 },
    { kind: 66, amount: 10000, quality: 0 },
    { kind: 13, amount: 20000, quality: 0 },
    { kind: 3, amount: 5000, quality: 0 },
    { kind: 101, amount: 5000, quality: 0 },
    { kind: 102, amount: 5000, quality: 0 },
    { kind: 108, amount: 5000, quality: 0 },
    { kind: 111, amount: 5000, quality: 0 }
  ];
  for (const s of seedStock) {
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1.0, ?)
    `).run(4259175, s.kind, s.quality, s.amount, now);
  }

  seedMarketOrders();
  console.log('Database seeded successfully.');
}
