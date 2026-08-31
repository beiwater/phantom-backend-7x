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
    extra_building_slots INTEGER DEFAULT 0,
    extra_executive_slots INTEGER DEFAULT 0,
    display_case_slots INTEGER DEFAULT 1,
    max_tags INTEGER DEFAULT 1,
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
    is_npc INTEGER DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS player_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    device_uuid TEXT,
    device_name TEXT,
    last_login TEXT
  );
`);

// Query paths for ownership, queues, inventory, and active listings are all
// company/resource scoped; keep those lookups indexed in fresh and migrated DBs.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_companies_player_id ON companies(player_id);
  CREATE INDEX IF NOT EXISTS idx_buildings_company_position ON buildings(company_id, position);
  CREATE INDEX IF NOT EXISTS idx_production_queues_company_building_resolved
    ON production_queues(company_id, building_id, resolved);
  CREATE INDEX IF NOT EXISTS idx_warehouse_company_kind_quality
    ON warehouse(company_id, kind, quality);
  CREATE INDEX IF NOT EXISTS idx_market_orders_active_kind_quality_price
    ON market_orders(active, kind, quality, price);
  CREATE INDEX IF NOT EXISTS idx_contracts_recipient_status
    ON contracts(recipient_company_id, status);
  CREATE INDEX IF NOT EXISTS idx_bonds_status_buyer_seller
    ON bonds(status, buyer_company_id, seller_company_id);
`);

// Legacy databases used `token` for the session primary key while the
// session service consistently reads and writes `session_token`.
const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
if (!sessionColumns.some(column => column.name === 'session_token') && sessionColumns.some(column => column.name === 'token')) {
  db.exec('ALTER TABLE sessions RENAME COLUMN token TO session_token');
}

// Migration: legacy committed databases predate the production_queues.quality
// column (#39). CREATE TABLE IF NOT EXISTS does not alter existing tables.
const pqColumns = db.prepare("PRAGMA table_info(production_queues)").all() as Array<{ name: string }>;
if (!pqColumns.some(c => c.name === 'quality')) {
  db.exec('ALTER TABLE production_queues ADD COLUMN quality INTEGER DEFAULT 0');
}

// Legacy DB migration: add bond maturity columns if missing (issue #42)
{
  const bondCols = (db.prepare('PRAGMA table_info(bonds)').all() as { name: string }[]).map((c) => c.name);
  if (!bondCols.includes('maturity_date')) db.exec('ALTER TABLE bonds ADD COLUMN maturity_date TEXT');
  if (!bondCols.includes('settled')) db.exec('ALTER TABLE bonds ADD COLUMN settled INTEGER DEFAULT 0');
}
// Migration: add extra slots columns to companies if missing
{
  const companyCols = (db.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map((c) => c.name);
  if (!companyCols.includes('extra_building_slots')) db.exec('ALTER TABLE companies ADD COLUMN extra_building_slots INTEGER DEFAULT 0');
  if (!companyCols.includes('extra_executive_slots')) db.exec('ALTER TABLE companies ADD COLUMN extra_executive_slots INTEGER DEFAULT 0');
  if (!companyCols.includes('display_case_slots')) db.exec('ALTER TABLE companies ADD COLUMN display_case_slots INTEGER DEFAULT 1');
  if (!companyCols.includes('max_tags')) db.exec('ALTER TABLE companies ADD COLUMN max_tags INTEGER DEFAULT 1');
}
{
  const retailCols = (db.prepare('PRAGMA table_info(retail_orders)').all() as { name: string }[]).map((c) => c.name);
  if (!retailCols.includes('quality')) db.exec('ALTER TABLE retail_orders ADD COLUMN quality INTEGER DEFAULT 0');
  if (!retailCols.includes('finished_at')) db.exec('ALTER TABLE retail_orders ADD COLUMN finished_at TEXT');
}

export function seedDefaultDisplayCase(companyId: number) {
  const existing = db.prepare('SELECT 1 FROM display_case WHERE company_id = ? LIMIT 1').get(companyId);
  if (existing) return;

  const defaults = [
    { slot: 1, kind: 3, quality: 12, title: 'Golden Apple' },
    { slot: 2, kind: 24, quality: 10, title: 'Flagship Smartphone' }
  ];
  const insert = db.prepare(`
    INSERT INTO display_case (company_id, slot, resource_kind, quality, title)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const item of defaults) {
    insert.run(companyId, item.slot, item.kind, item.quality, item.title);
  }
}

const companiesWithoutDisplayCase = db.prepare(`
  SELECT company_id FROM companies
  WHERE NOT EXISTS (
    SELECT 1 FROM display_case WHERE display_case.company_id = companies.company_id
  )
`).all() as Array<{ company_id: number }>;
for (const company of companiesWithoutDisplayCase) {
  seedDefaultDisplayCase(company.company_id);
}

const PASSWORD_HASH_PREFIX = 'scrypt$';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${PASSWORD_HASH_PREFIX}${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith(PASSWORD_HASH_PREFIX)) {
    const [, saltHex, digestHex] = storedHash.split('$');
    if (!saltHex || !digestHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(digestHex)) return false;
    const expected = Buffer.from(digestHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  // One-time compatibility for databases created before the scrypt migration.
  // Successful legacy logins are upgraded below; new rows never use SHA-256.
  const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
  return storedHash === legacyHash;
}

const plaintextPlayers = db.prepare(`
  SELECT id, password FROM players
  WHERE password IS NOT NULL AND password <> ''
`).all() as Array<{ id: number; password: string }>;
for (const player of plaintextPlayers) {
  db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
    .run(hashPassword(player.password), player.id);
}

function adminBootstrapPassword(): string {
  const configured = process.env.ADMIN_PASSWORD;
  if (configured !== undefined && configured.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  }
  return configured || crypto.randomBytes(32).toString('base64url');
}

const adminPlayer = db.prepare(`
  SELECT id, password_hash FROM players WHERE email = 'admin@simcompanies.local'
`).get() as { id: number; password_hash?: string } | undefined;
if (adminPlayer?.password_hash && verifyPassword('admin123', adminPlayer.password_hash)) {
  db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
    .run(hashPassword(adminBootstrapPassword()), adminPlayer.id);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('Rotated the insecure default admin password; set ADMIN_PASSWORD before the next fresh bootstrap.');
  }
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
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const existing = db.prepare('SELECT * FROM players WHERE email = ?').get(email);
  if (existing) throw new Error('Email already registered');

  let cName = companyName || email.split('@')[0] || `Co-${Math.floor(4000000 + Math.random() * 6000000)}`;
  let nameTaken = db.prepare('SELECT 1 FROM companies WHERE name = ?').get(cName);
  if (nameTaken) {
    if (companyName) {
      cName = `${companyName} ${Math.floor(100 + Math.random() * 900)}`;
    } else {
      cName = `${cName} ${Math.floor(100 + Math.random() * 900)}`;
    }
  }

  const now = new Date().toISOString();
  const insertPlayer = db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 0, ?)
  `);
  const insertCompany = db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 20, 0, '', 'old', 'Private Server Company', ?)
  `);
  const insertBuilding = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `);
  const insertSeedStock = db.prepare(`
    INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
    VALUES (?, ?, 0, ?, 0, 0, 0, 0, 1.0, ?)
  `);
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

  for (let attempt = 1; ; attempt++) {
    const playerId = Math.floor(2000000 + Math.random() * 8000000);
    const companyId = Math.floor(4000000 + Math.random() * 6000000);
    db.exec('BEGIN');
    try {
      insertPlayer.run(playerId, email, hashPassword(password), now);
      insertCompany.run(companyId, playerId, cName, CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, now);
      seedDefaultDisplayCase(companyId);
      insertBuilding.run(companyId, '0', 'P', 'Farm', 6900, 'production', now);
      insertBuilding.run(companyId, '1', 'G', 'Grocery store', 10350, 'sales', now);
      for (const s of seedStock) {
        insertSeedStock.run(companyId, s.kind, s.amount, now);
      }
      db.exec('COMMIT');
      return { playerId, companyId };
    } catch (err) {
      db.exec('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      // Retry only on id collisions; duplicate email is a user error, not retryable.
      const idCollision = msg.includes('UNIQUE constraint failed') && !msg.includes('players.email');
      if (!idCollision || attempt >= 5) throw err;
    }
  }
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

  const storedHash = typeof player.password_hash === 'string' ? player.password_hash : '';
  if (!storedHash || !verifyPassword(password, storedHash)) throw new Error('Invalid password');
  if (!storedHash.startsWith(PASSWORD_HASH_PREFIX)) {
    db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
      .run(hashPassword(password), player.id);
  }

  const company = db.prepare('SELECT * FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1').get(player.player_id) as { company_id?: number } | undefined;
  if (!company?.company_id) throw new Error('Company not found');
  return {
    playerId: player.player_id,
    companyId: company.company_id
  };
}

export function registerOrAuthenticatePlayer(email?: string, password?: string, companyName?: string) {
  if (!email || email.trim() === '') {
    const randomId = Math.floor(100000 + Math.random() * 900000);
    const guestEmail = `guest_${randomId}@simcompanies.local`;
    const guestPass = password || 'guest1234';
    const guestCompany = companyName || `Company ${randomId}`;
    return registerPlayer(guestEmail, guestPass, guestCompany);
  }

  const cleanEmail = email.trim();
  const existing = db.prepare('SELECT * FROM players WHERE email = ?').get(cleanEmail) as PlayerDbRow | undefined;
  if (existing) {
    if (!password) throw new Error('Password is required');
    return authenticatePlayer(cleanEmail, password);
  }

  return registerPlayer(cleanEmail, password || '', companyName);
}

// Seed default player and company if empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM players');
const row = countStmt.get() as { count: number };
if (row.count === 0) {
  console.log('Seeding initial private server game database...');
  const now = new Date().toISOString();
  const adminPassword = adminBootstrapPassword();
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('No ADMIN_PASSWORD was provided; generated a random admin password for this bootstrap.');
  }
  db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(2920233, 'admin@simcompanies.local', hashPassword(adminPassword), now);

  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 25, 0, '', 'old', 'Private Server Company', ?)
  `).run(4259175, 2920233, 'lifeline', CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, now);
  seedDefaultDisplayCase(4259175);

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
