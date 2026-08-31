import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const PASSWORD_HASH_PREFIX = 'scrypt$';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${PASSWORD_HASH_PREFIX}${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith(PASSWORD_HASH_PREFIX)) {
    const [, saltHex, digestHex] = storedHash.split('$');
    if (!saltHex || !digestHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(digestHex)) return false;
    const expected = Buffer.from(digestHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  // One-time compatibility for databases created before the scrypt migration.
  const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
  return storedHash === legacyHash;
}

export function runMigrations(db: DatabaseSync): void {
  // 1. Session token migration
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!sessionColumns.some(column => column.name === 'session_token') && sessionColumns.some(column => column.name === 'token')) {
    db.exec('ALTER TABLE sessions RENAME COLUMN token TO session_token');
  }

  // 2. Production queue quality column (#39)
  const pqColumns = db.prepare('PRAGMA table_info(production_queues)').all() as Array<{ name: string }>;
  if (!pqColumns.some(c => c.name === 'quality')) {
    db.exec('ALTER TABLE production_queues ADD COLUMN quality INTEGER DEFAULT 0');
  }

  // 3. Bond maturity and settled columns (#42)
  const bondCols = (db.prepare('PRAGMA table_info(bonds)').all() as { name: string }[]).map(c => c.name);
  if (!bondCols.includes('maturity_date')) db.exec('ALTER TABLE bonds ADD COLUMN maturity_date TEXT');
  if (!bondCols.includes('settled')) db.exec('ALTER TABLE bonds ADD COLUMN settled INTEGER DEFAULT 0');

  // 4. Company slots columns
  const companyCols = (db.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map(c => c.name);
  if (!companyCols.includes('extra_building_slots')) db.exec('ALTER TABLE companies ADD COLUMN extra_building_slots INTEGER DEFAULT 0');
  if (!companyCols.includes('extra_executive_slots')) db.exec('ALTER TABLE companies ADD COLUMN extra_executive_slots INTEGER DEFAULT 0');
  if (!companyCols.includes('display_case_slots')) db.exec('ALTER TABLE companies ADD COLUMN display_case_slots INTEGER DEFAULT 1');
  if (!companyCols.includes('max_tags')) db.exec('ALTER TABLE companies ADD COLUMN max_tags INTEGER DEFAULT 1');

  // 5. Retail orders quality and finished_at columns
  const retailCols = (db.prepare('PRAGMA table_info(retail_orders)').all() as { name: string }[]).map(c => c.name);
  if (!retailCols.includes('quality')) db.exec('ALTER TABLE retail_orders ADD COLUMN quality INTEGER DEFAULT 0');
  if (!retailCols.includes('finished_at')) db.exec('ALTER TABLE retail_orders ADD COLUMN finished_at TEXT');

  // 6. Plaintext password migration to scrypt
  const plaintextPlayers = db.prepare(`
    SELECT id, password FROM players
    WHERE password IS NOT NULL AND password <> ''
  `).all() as Array<{ id: number; password: string }>;
  for (const player of plaintextPlayers) {
    db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
      .run(hashPassword(player.password), player.id);
  }

  // 7. Admin password security check
  const adminPlayer = db.prepare(`
    SELECT id, password_hash FROM players WHERE email = 'admin@simcompanies.local'
  `).get() as { id: number; password_hash?: string } | undefined;
  if (adminPlayer?.password_hash && verifyPassword('admin123', adminPlayer.password_hash)) {
    const adminPass = process.env.ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64url');
    db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
      .run(hashPassword(adminPass), adminPlayer.id);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('Rotated the insecure default admin password; set ADMIN_PASSWORD before the next fresh bootstrap.');
    }
  }
}
