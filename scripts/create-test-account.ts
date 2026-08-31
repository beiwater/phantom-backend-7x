/**
 * Creates a local regression-test account:
 *   email: qa60@test.local / password: Test12345!
 *   level 60, $100,000,000 cash, generous simboosts and unlocked slots.
 * Usage: node --experimental-strip-types scripts/create-test-account.ts
 * Local test-only seeding (not production); run once per fresh DB.
 */
import { db } from '../server/db/database.ts';
import { hashPassword } from '../server/db/migrations/index.ts';

const EMAIL = 'qa60@test.local';
const PASSWORD = 'Test12345!';

const existing = db.prepare('SELECT id FROM players WHERE email = ?').get(EMAIL) as { id: number } | undefined;
if (existing) {
  const comp = db.prepare("SELECT c.company_id FROM companies c JOIN players p ON c.player_id = p.player_id WHERE p.email = ?").get(EMAIL) as { company_id: number } | undefined;
  console.log(`[exists] player id=${existing.id} company=${comp?.company_id ?? 'none'} — updating balances instead`);
  if (comp) {
    db.prepare('UPDATE companies SET money = 100000000, simboosts = 100000, level = 60, extra_building_slots = 40 WHERE company_id = ?')
      .run(comp.company_id);
  }
  process.exit(0);
}

const now = new Date().toISOString();
const playerRow = db.prepare(
  'INSERT INTO players (player_id, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)'
);
const companyRow = db.prepare(`
  INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, extra_building_slots, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'AAA', 0, 1, '', 'old', 'QA regression account', 40, ?)
`);

const maxPlayer = db.prepare('SELECT COALESCE(MAX(player_id), 100000) AS m FROM players').get() as { m: number };
const maxCompany = db.prepare('SELECT COALESCE(MAX(company_id), 400000) AS m FROM companies').get() as { m: number };

db.exec('BEGIN');
const newPlayerId = maxPlayer.m + 1;
playerRow.run(newPlayerId, EMAIL, hashPassword(PASSWORD), now);
companyRow.run(maxCompany.m + 1, newPlayerId, 'QA Level60 Corp', 100000000, 100000, 60, now);
db.exec('COMMIT');

const comp = db.prepare("SELECT c.company_id FROM companies c JOIN players p ON c.player_id = p.player_id WHERE p.email = ?").get(EMAIL) as { company_id: number };
console.log(`[ok] QA account ready: ${EMAIL} / ${PASSWORD} (company ${comp.company_id}, level 60, $100M)`);
