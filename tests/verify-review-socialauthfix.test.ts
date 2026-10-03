import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { registerPlayer, authenticatePlayer } from '../server/db/seed/index.ts';
import { requestPasswordReset, completePasswordReset } from '../server/auth/password-reset.ts';
import { createSession, getSession, switchSessionCompany } from '../server/auth/session.ts';
import { createOwnedRealmCompanyUseCase } from '../server/application/account/company-account-use-cases.ts';
import { resetCompany } from '../server/game/company.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { runInTransaction } from '../server/db/transaction.ts';
import { opCommand } from '../server/game/commands/handlers/admin-commands.ts';
import { socialRepository } from '../server/repositories/social-repository.ts';

try {
  const email = `review-auth-${Date.now()}@test.local`;
  const owner = runInTransaction(() => registerPlayer(email, 'password123', 'Review Auth Owner'));
  assert.throws(() => completePasswordReset(email, '', 'attacker123'));
  assert.equal(authenticatePlayer(email, 'password123').playerId, owner.playerId);
  const session = createSession(owner.playerId, owner.companyId);
  const token = requestPasswordReset(email)!;
  const persisted = db.prepare('SELECT token_hash FROM password_reset_tokens WHERE player_id = ?').get(owner.playerId) as { token_hash: string };
  assert.notEqual(persisted.token_hash, token);
  assert.throws(() => completePasswordReset(email, '0'.repeat(64), 'attacker123'));
  completePasswordReset(email, token, 'replacement123');
  assert.equal(authenticatePlayer(email, 'replacement123').playerId, owner.playerId);
  assert.equal(getSession(session), null);
  assert.throws(() => completePasswordReset(email, token, 'attacker123'));
  const expired = requestPasswordReset(email)!;
  db.prepare("UPDATE password_reset_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE player_id = ?").run(owner.playerId);
  assert.throws(() => completePasswordReset(email, expired, 'attacker123'));
  console.log('PASS password reset ownership, expiry, single use, hashed persistence');

  const oldKey = process.env.ADMIN_OP_KEY;
  delete process.env.ADMIN_OP_KEY;
  const ctx = { executorCompanyId: owner.companyId, isOp: false, source: 'pa' as const };
  assert.equal((await opCommand.handler(['phantom-admin'], ctx)).success, false);
  assert.notEqual(socialRepository.getCompanySetting(owner.companyId, 'is_admin_op'), '1');
  process.env.ADMIN_OP_KEY = 'review-private-secret';
  assert.equal((await opCommand.handler(['review-private-secret'], ctx)).success, true);
  if (oldKey === undefined) delete process.env.ADMIN_OP_KEY; else process.env.ADMIN_OP_KEY = oldKey;
  console.log('PASS operator key disabled by default and configured key works');

  assert.throws(() => createOwnedRealmCompanyUseCase(owner.playerId, 0));
  const second = createOwnedRealmCompanyUseCase(owner.playerId, 1);
  assert.throws(() => createOwnedRealmCompanyUseCase(owner.playerId, 1));
  assert.throws(() => companyRepository.createCompany(owner.playerId, 'Over Limit', 0, 2));
  const countRows = (sql: string, id: number): number => {
    const row = db.prepare(sql).get(id);
    assert.ok(row && typeof row.n === 'number');
    return row.n;
  };
  assert.equal(countRows('SELECT COUNT(*) AS n FROM companies WHERE player_id = ?', owner.playerId), 2);
  const active = createSession(owner.playerId, owner.companyId);
  socialRepository.upsertCompanySetting(second.companyId, 'banned', '1');
  assert.throws(() => switchSessionCompany(active, second.companyId));
  assert.equal(getSession(active)?.companyId, owner.companyId);
  db.prepare('UPDATE sessions SET active_company_id = ? WHERE session_token = ?').run(second.companyId, active);
  assert.equal(getSession(active), null);
  console.log('PASS realm company creation limits and suspended session isolation');

  const now = new Date().toISOString();
  for (const isBuy of [0, 1]) db.prepare('INSERT INTO market_orders (seller_id, kind, quantity, price, is_buy, posted_at) VALUES (?, 1, 100, 1, ?, ?)').run(owner.companyId, isBuy, now);
  const buildings = db.prepare('SELECT id FROM buildings WHERE company_id = ? ORDER BY id').all(owner.companyId) as { id: number }[];
  db.prepare('INSERT INTO building_followers (building_id, follower_building_id, created_at) VALUES (?, ?, ?)').run(buildings[0].id, buildings[1].id, now);
  db.prepare(`INSERT INTO launchpad_flights (building_id, company_id, rocket_kind, launch_started_at, launch_completed_at, created_at)
    VALUES (?, ?, 91, ?, ?, ?)`).run(buildings[0].id, owner.companyId, now, now, now);
  runInTransaction(() => resetCompany(owner.companyId));
  assert.equal(countRows('SELECT COUNT(*) AS n FROM market_orders WHERE seller_id = ?', owner.companyId), 0);
  assert.equal(countRows('SELECT COUNT(*) AS n FROM launchpad_flights WHERE company_id = ?', owner.companyId), 0);
  assert.equal(countRows('SELECT COUNT(*) AS n FROM buildings WHERE company_id = ?', owner.companyId), 1);
  assert.equal(countRows('SELECT COUNT(*) AS n FROM warehouse WHERE company_id = ?', owner.companyId), 0);
  db.prepare('INSERT INTO contracts (sender_company_id, recipient_company_id, kind, amount, price, status, created_at) VALUES (?, ?, 1, 10, 1, ?, ?)').run(owner.companyId, second.companyId, 'pending', now);
  assert.throws(() => resetCompany(owner.companyId));
  console.log('PASS reset forfeits market escrow, clears building dependencies, blocks obligations');
  console.log('PASS verify-review-socialauthfix');
  process.exit(0);
} catch (error) { console.error(error); process.exit(1); }
