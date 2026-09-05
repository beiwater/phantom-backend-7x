import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { db } from '../connection.ts';
import { CONFIG, getInitialCompanySettings } from '../../config.ts';
import { CONSTANTS_RESOURCES } from '../../game/constants.ts';
import { hashPassword, verifyPassword } from '../migrations/index.ts';
import { executiveRepository } from '../../repositories/executive-repository.ts';

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
  database.exec('BEGIN');
  try {
    for (const [kindStr, def] of Object.entries(CONSTANTS_RESOURCES)) {
      const kind = Number(kindStr);
      if (def.isExchangeTradable === false) continue;
      for (let q = 0; q <= 12; q++) {
        const price = 1.0 + q;
        insertStmt.run(kind, q, price, now);
      }
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export function registerPlayer(
  email: string,
  password: string,
  companyName?: string,
  database: DatabaseSync = db
): { playerId: number; companyId: number; created: boolean } {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // P1-04: new companies must not be auto-named from email/device data.
  // An explicitly provided non-empty name is honored (and must be unique);
  // otherwise the company starts unnamed and the frontend naming flow
  // (/create/) assigns the name. Guest/device signups never derive a
  // business name from user-agent strings.
  const cName = typeof companyName === 'string' ? companyName.trim() : '';
  if (cName) {
    const nameTaken = database.prepare('SELECT 1 FROM companies WHERE name = ?').get(cName);
    if (nameTaken) {
      throw new Error('Company name already taken');
    }
  }

  const now = new Date().toISOString();
  const insertPlayer = database.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 0, ?)
  `);
  const init = getInitialCompanySettings();
  const insertCompany = database.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, extra_building_slots, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', ?, ?, 0, '', 'old', 'Private Server Company', ?)
  `);
  const insertBuilding = database.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `);
  const insertSeedStock = database.prepare(`
    INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1.0, ?)
  `);
  const seedStock = init.warehouseStock;

  for (let attempt = 1; ; attempt++) {
    const playerId = Math.floor(2000000 + Math.random() * 8000000);
    const companyId = Math.floor(4000000 + Math.random() * 6000000);
    database.exec('BEGIN');
    try {
      insertPlayer.run(playerId, email, hashPassword(password), now);
      insertCompany.run(companyId, playerId, cName, init.money, init.simboosts, init.level, init.experience, init.extraBuildingSlots, now);
      seedDefaultDisplayCase(companyId, database);
      executiveRepository.seedDefaults(companyId, database);
      insertBuilding.run(companyId, '0', 'P', 'Farm', 6900, 'production', now);
      insertBuilding.run(companyId, '1', 'G', 'Grocery store', 10350, 'sales', now);
      for (const s of seedStock) {
        insertSeedStock.run(companyId, s.kind, s.quality || 0, s.amount, now);
      }
      database.exec('COMMIT');
      return { playerId, companyId, created: true };
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
): { playerId: number; companyId: number; created: boolean } {
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
  const banned = database
    .prepare("SELECT value FROM company_settings WHERE company_id = ? AND key = 'banned'")
    .get(company.company_id);
  if (banned) throw new Error('This company has been suspended');
  return {
    playerId: player.player_id,
    companyId: company.company_id,
    created: false
  };
}

export function registerOrAuthenticatePlayer(
  email?: string,
  password?: string,
  companyName?: string,
  database: DatabaseSync = db
): { playerId: number; companyId: number; created: boolean } {
  // P1-04: guest/device signups must not fabricate a company name from
  // device or user-agent data. New companies start unnamed so the frontend
  // naming flow (/create/) runs first.
  const desiredName = typeof companyName === 'string' && companyName.trim() !== ''
    ? companyName.trim()
    : undefined;

  if (!email || email.trim() === '') {
    const randomId = Math.floor(100000 + Math.random() * 900000);
    const guestEmail = `guest_${randomId}@simcompanies.local`;
    const guestPass = password || 'guest1234';
    return registerPlayer(guestEmail, guestPass, desiredName, database);
  }

  const cleanEmail = email.trim();
  const existing = database.prepare('SELECT * FROM players WHERE email = ?').get(cleanEmail) as PlayerDbRow | undefined;
  if (existing) {
    if (!password) throw new Error('Password is required');
    return authenticatePlayer(cleanEmail, password, database);
  }

  return registerPlayer(cleanEmail, password || '', desiredName, database);
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

    const seedInit = getInitialCompanySettings();
    database.prepare(`
      INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, extra_building_slots, realm_id, logo, personal_assistant, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'BBB', ?, ?, 0, '', 'old', 'Private Server Company', ?)
    `).run(4259175, 2920233, 'lifeline', seedInit.money, seedInit.simboosts, seedInit.level, seedInit.experience, seedInit.extraBuildingSlots, now);
    seedDefaultDisplayCase(4259175, database);
    executiveRepository.seedDefaults(4259175, database);

    database.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
    `).run(4259175, now);

    database.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, '1', 'G', 1, 'Grocery store', 10350, 'sales', ?)
    `).run(4259175, now);

    for (const s of seedInit.warehouseStock) {
      database.prepare(`
        INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1.0, ?)
      `).run(4259175, s.kind, s.quality || 0, s.amount, now);
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
