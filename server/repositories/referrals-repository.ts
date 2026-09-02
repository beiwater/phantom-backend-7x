/**
 * Referrals repository (Issue #109 build-out).
 * Implements the decompiled referral program (data/referral.json):
 * - referrer earns SimBoosts when a referred company reaches level 5/10/15
 * - referred company gets a one-time $2,000 cash bonus at registration use
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_company_id INTEGER NOT NULL,
    referred_company_id INTEGER UNIQUE NOT NULL,
    code TEXT NOT NULL,
    claimed_bonus INTEGER DEFAULT 0,
    rewards_paid_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_company_id);
`);

export const REFERRAL_LEVEL_TIERS: Array<{ level: number; reward: number }> = [
  { level: 5, reward: 10 },
  { level: 10, reward: 20 },
  { level: 15, reward: 30 }
];

export const REFERRAL_JOIN_BONUS = 2000;

export class ReferralsRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  /** Record that `referredCompanyId` signed up via `referrerCompanyId`'s code. */
  bindReferred(referrerCompanyId: number, referredCompanyId: number, code: string): boolean {
    const res = this.database
      .prepare(
        'INSERT OR IGNORE INTO referrals (referrer_company_id, referred_company_id, code, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(referrerCompanyId, referredCompanyId, code, new Date().toISOString());
    return Number(res.changes) > 0;
  }

  findReferredBy(referrerCompanyId: number): Array<{
    referredCompanyId: number;
    code: string;
    createdAt: string;
    rewardsPaid: Record<string, number>;
  }> {
    const rows = this.database
      .prepare('SELECT * FROM referrals WHERE referrer_company_id = ? ORDER BY id DESC')
      .all(referrerCompanyId) as Array<{
        referred_company_id: number;
        code: string;
        created_at: string;
        rewards_paid_json: string;
      }>;
    return rows.map(r => {
      let rewards: Record<string, number> = {};
      try {
        rewards = JSON.parse(r.rewards_paid_json || '{}');
      } catch {
        rewards = {};
      }
      return {
        referredCompanyId: Number(r.referred_company_id),
        code: r.code,
        createdAt: r.created_at,
        rewardsPaid: rewards
      };
    });
  }

  hasClaimedJoinBonus(referredCompanyId: number): boolean {
    const row = this.database
      .prepare('SELECT claimed_bonus FROM referrals WHERE referred_company_id = ?')
      .get(referredCompanyId) as { claimed_bonus: number } | undefined;
    return Boolean(row?.claimed_bonus);
  }

  markJoinBonusClaimed(referredCompanyId: number): void {
    this.database
      .prepare('UPDATE referrals SET claimed_bonus = 1 WHERE referred_company_id = ?')
      .run(referredCompanyId);
  }

  markTierPaid(referredCompanyId: number, level: number): void {
    const row = this.database
      .prepare('SELECT rewards_paid_json FROM referrals WHERE referred_company_id = ?')
      .get(referredCompanyId) as { rewards_paid_json: string } | undefined;
    let rewards: Record<string, number> = {};
    try {
      rewards = JSON.parse(row?.rewards_paid_json || '{}');
    } catch {
      rewards = {};
    }
    rewards[String(level)] = 1;
    this.database
      .prepare('UPDATE referrals SET rewards_paid_json = ? WHERE referred_company_id = ?')
      .run(JSON.stringify(rewards), referredCompanyId);
  }

  /** Idempotent tier payout: true only the first time this level is rewarded. */
  markTierPaidAndReward(referredCompanyId: number, level: number, reward: number): boolean {
    const row = this.database
      .prepare('SELECT rewards_paid_json FROM referrals WHERE referred_company_id = ?')
      .get(referredCompanyId) as { rewards_paid_json: string } | undefined;
    if (!row) return false;
    let rewards: Record<string, number> = {};
    try {
      rewards = JSON.parse(row.rewards_paid_json || '{}');
    } catch {
      rewards = {};
    }
    if (rewards[String(level)]) return false;
    rewards[String(level)] = reward;
    this.database
      .prepare('UPDATE referrals SET rewards_paid_json = ? WHERE referred_company_id = ?')
      .run(JSON.stringify(rewards), referredCompanyId);
    return true;
  }

  findReferrerOf(referredCompanyId: number): number | null {
    const row = this.database
      .prepare('SELECT referrer_company_id FROM referrals WHERE referred_company_id = ?')
      .get(referredCompanyId) as { referrer_company_id: number } | undefined;
    return row ? Number(row.referrer_company_id) : null;
  }
}

export const referralsRepository = new ReferralsRepository();
