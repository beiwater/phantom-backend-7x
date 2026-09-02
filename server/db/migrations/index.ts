import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { MigrationRunner } from './runner.ts';

export { MigrationRunner, MigrationError, type MigrationRecord, MIGRATIONS } from './runner.ts';

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

export function runMigrations(db: DatabaseSync): { appliedCount: number; currentVersion: number } {
  const runner = new MigrationRunner(db);
  return runner.runMigrations();
}
