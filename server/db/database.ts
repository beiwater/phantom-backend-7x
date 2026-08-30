import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CONFIG } from '../config.ts';

fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
const dbPath = path.join(CONFIG.DATA_DIR, 'simcompanies.sqlite');
export const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
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

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function registerPlayer(email: string, password: string, companyName?: string) {
  const existing = db.prepare('SELECT * FROM players WHERE email = ?').get(email);
  if (existing) {
    throw new Error('Email already registered');
  }

  const playerId = Math.floor(2000000 + Math.random() * 8000000);
  const companyId = Math.floor(4000000 + Math.random() * 6000000);
  const now = new Date().toISOString();
  const cName = companyName || email.split('@')[0] || `Co-${companyId}`;

  // Insert player
  db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(playerId, email, hashPassword(password), now);

  // Insert default company
  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 20, 0, '', 'old', 'Private Server Company', ?)
  `).run(companyId, playerId, cName, CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, now);

  // Seed default Farm and Grocery Store
  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
  `).run(companyId, now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '1', 'G', 1, 'Grocery store', 10350, 'sales', ?)
  `).run(companyId, now);

  // Seed warehouse goods
  const seedStock = [
    { kind: 1, amount: 10000 },
    { kind: 2, amount: 10000 },
    { kind: 66, amount: 5000 },
    { kind: 13, amount: 10000 },
    { kind: 3, amount: 2000 },
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
  if (!player) {
    throw new Error('User not found');
  }

  const hashed = hashPassword(password);
  if (player.password_hash !== hashed && player.password !== password) {
    throw new Error('Invalid password');
  }

  // Find player's primary or active company
  const company = db.prepare('SELECT * FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1').get(player.player_id) as { company_id: number } | undefined;
  const companyId = company ? company.company_id : 4259175;

  return {
    playerId: player.player_id,
    companyId
  };
}

// Seed default player and company if empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM players');
const row = countStmt.get() as { count: number };
if (row.count === 0) {
  console.log('Seeding initial private server game database...');
  const now = new Date().toISOString();
  
  // Default Admin Player
  db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(2920233, 'admin@simcompanies.local', hashPassword('admin123'), now);

  const initialMoney = CONFIG.INITIAL_MONEY || 100000;
  const initialSimboosts = CONFIG.INITIAL_SIMBOOSTS || 250;
  const initialLevel = CONFIG.INITIAL_LEVEL || 5;

  // Default Company
  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(4259175, 2920233, 'lifeline', initialMoney, initialSimboosts, initialLevel, 'BBB', 25, 0, '', 'old', 'Private Server Company', now);

  // Default Buildings
  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(4259175, '0', 'P', 1, 'Farm', 6900, 'production', now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(4259175, '1', 'G', 1, 'Grocery store', 10350, 'sales', now);

  // Default Warehouse stock
  const seedStock = [
    { kind: 1, amount: 10000, quality: 0 },
    { kind: 2, amount: 10000, quality: 0 },
    { kind: 66, amount: 5000, quality: 0 },
    { kind: 13, amount: 10000, quality: 0 },
    { kind: 3, amount: 2000, quality: 0 },
  ];

  for (const s of seedStock) {
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(4259175, s.kind, s.quality, s.amount, 0, 0, 0, 0, 0.25 * s.amount, now);
  }

  // Seed sample market orders
  const seedOrders = [
    { seller_id: 999901, kind: 1, quality: 0, quantity: 50000, price: 0.245, fees: 50 },
    { seller_id: 999902, kind: 2, quality: 0, quantity: 20000, price: 0.320, fees: 30 },
    { seller_id: 999903, kind: 3, quality: 0, quantity: 5000, price: 2.15, fees: 100 },
    { seller_id: 999904, kind: 66, quality: 0, quantity: 15000, price: 0.450, fees: 40 },
    { seller_id: 999905, kind: 13, quality: 0, quantity: 20000, price: 0.350, fees: 50 },
  ];

  for (const o of seedOrders) {
    db.prepare(`
      INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(o.seller_id, o.kind, o.quality, o.quantity, o.price, o.fees, now);
  }

  console.log('Database seeded successfully.');
}
