import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { db } from '../connection.ts';
import { CONFIG } from '../../config.ts';
import { CONSTANTS_RESOURCES } from '../../game/constants.ts';
import { hashPassword, verifyPassword } from '../migrations/index.ts';
import { seedDefaultExecutives } from '../../game/executives.ts';

export function seedDefaultDisplayCase(companyId: number, database: DatabaseSync = db): void {
  const existing = database.prepare('SELECT 1 FROM display_case WHERE company_id = ? LIMIT 1').get(companyId);
  if (existing) return;

  const defaults = [
    { slot: 1, kind: 3, quality: 12, title: 'Golden Apple' },
    { slot: 2, kind: 24, quality: 10, title: 'Flagship Smartphone' }
  ];
  const insert = database.prepare(`
    INSERT INTO display_case (company_id, slot, resource_kind, quality, title)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const item of defaults) {
    insert.run(companyId, item.slot, item.kind, item.quality, item.title);
  }
}

export function seedMarketOrders(database: DatabaseSync = db): void {
  const countRow = database.prepare('SELECT COUNT(*) as count FROM market_orders WHERE active = 1').get() as { count: number };
  if (countRow.count > 100) return;

  console.log('Seeding market with Q0-Q12 orders for all resources...');
  const insertStmt = database.prepare(`
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

export function registerPlayer(
  email: string,
  password: string,
  companyName?: string,
  database: DatabaseSync = db
): { playerId: number; companyId: number } {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const existing = database.prepare('SELECT * FROM players WHERE email = ?').get(email);
  if (existing) throw new Error('Email already registered');

  let cName = companyName || email.split('@')[0] || `Co-${Math.floor(4000000 + Math.random() * 6000000)}`;
  let nameTaken = database.prepare('SELECT 1 FROM companies WHERE name = ?').get(cName);
  if (nameTaken) {
    cName = `${cName} ${Math.floor(100 + Math.random() * 900)}`;
  }

  const now = new Date().toISOString();
  const insertPlayer = database.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 0, ?)
  `);
  const insertCompany = database.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 0, 0, '', 'old', 'Private Server Company', ?)
  `);
  const insertBuilding = database.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `);
  const insertSeedStock = database.prepare(`
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
    database.exec('BEGIN');
    try {
      insertPlayer.run(playerId, email, hashPassword(password), now);
      insertCompany.run(companyId, playerId, cName, CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, now);
      seedDefaultDisplayCase(companyId, database);
      seedDefaultExecutives(companyId, database);
      insertBuilding.run(companyId, '0', 'P', 'Farm', 6900, 'production', now);
      insertBuilding.run(companyId, '1', 'G', 'Grocery store', 10350, 'sales', now);
      for (const s of seedStock) {
        insertSeedStock.run(companyId, s.kind, s.amount, now);
      }
      database.exec('COMMIT');
      return { playerId, companyId };
    } catch (err) {
      database.exec('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
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

export function authenticatePlayer(
  email: string,
  password: string,
  database: DatabaseSync = db
): { playerId: number; companyId: number } {
  const player = database.prepare('SELECT * FROM players WHERE email = ?').get(email) as PlayerDbRow | undefined;
  if (!player) throw new Error('Invalid email or password');

  const storedHash = typeof player.password_hash === 'string' ? player.password_hash : '';
  if (!storedHash || !verifyPassword(password, storedHash)) throw new Error('Invalid email or password');
  if (!storedHash.startsWith('scrypt$')) {
    database.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
      .run(hashPassword(password), player.id);
  }

  const company = database.prepare('SELECT * FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1').get(player.player_id) as { company_id?: number } | undefined;
  if (!company?.company_id) throw new Error('Company not found');
  return {
    playerId: player.player_id,
    companyId: company.company_id
  };
}

export function registerOrAuthenticatePlayer(
  email?: string,
  password?: string,
  companyName?: string,
  database: DatabaseSync = db
): { playerId: number; companyId: number } {
  if (!email || email.trim() === '') {
    const randomId = Math.floor(100000 + Math.random() * 900000);
    const guestEmail = `guest_${randomId}@simcompanies.local`;
    const guestPass = password || 'guest1234';
    const guestCompany = companyName || `Company ${randomId}`;
    return registerPlayer(guestEmail, guestPass, guestCompany, database);
  }

  const cleanEmail = email.trim();
  const existing = database.prepare('SELECT * FROM players WHERE email = ?').get(cleanEmail) as PlayerDbRow | undefined;
  if (existing) {
    if (!password) throw new Error('Password is required');
    return authenticatePlayer(cleanEmail, password, database);
  }

  return registerPlayer(cleanEmail, password || '', companyName, database);
}

export function seedInitialDatabase(database: DatabaseSync = db): void {
  const countStmt = database.prepare('SELECT COUNT(*) as count FROM players');
  const row = countStmt.get() as { count: number };
  if (row.count === 0) {
    console.log('Seeding initial private server game database...');
    const now = new Date().toISOString();
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64url');
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('No ADMIN_PASSWORD was provided; generated a random admin password for this bootstrap.');
    }
    database.prepare(`
      INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(2920233, 'admin@simcompanies.local', hashPassword(adminPassword), now);

    database.prepare(`
      INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'BBB', 0, 0, '', 'old', 'Private Server Company', ?)
    `).run(4259175, 2920233, 'lifeline', CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, now);
    seedDefaultDisplayCase(4259175, database);
    seedDefaultExecutives(4259175, database);

    database.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
    `).run(4259175, now);

    database.prepare(`
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
      database.prepare(`
        INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1.0, ?)
      `).run(4259175, s.kind, s.quality, s.amount, now);
    }

    seedMarketOrders(database);
    console.log('Database seeded successfully.');
  }

  // Ensure any companies created before display case default seed are backfilled
  const companiesWithoutDisplayCase = database.prepare(`
    SELECT company_id FROM companies
    WHERE NOT EXISTS (
      SELECT 1 FROM display_case WHERE display_case.company_id = companies.company_id
    )
  `).all() as Array<{ company_id: number }>;
  for (const company of companiesWithoutDisplayCase) {
    seedDefaultDisplayCase(company.company_id, database);
  }
}
