/**
 * Auth repository (Issue #180): owns the persistence statements previously
 * inlined in server/routes/auth-routes.ts — player device registry, player
 * lookups, password-hash updates, per-company referral codes and realm
 * company listings. Routes keep HTTP parsing and response mapping only.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface PlayerDeviceRow {
  id: number;
  deviceUuid: string;
  deviceName: string;
  lastLogin: string;
}

export interface CompanyRealmRow {
  company_id: number;
  player_id: number;
  name: string;
  logo: string;
  level: number;
  rating: string;
  created_at: string;
  note: string;
  extra_building_slots?: number;
  realm_id: number;
}

export class AuthRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  // --- Player devices (P1-06 push-device registry) ---

  listPlayerDevices(playerId: number): PlayerDeviceRow[] {
    return this.database.prepare(
      'SELECT id, device_uuid AS deviceUuid, device_name AS deviceName, last_login AS lastLogin FROM player_devices WHERE player_id = ?'
    ).all(playerId) as PlayerDeviceRow[];
  }

  findPlayerDevice(playerId: number, deviceUuid: string): { id: number } | undefined {
    return this.database.prepare(
      'SELECT id FROM player_devices WHERE player_id = ? AND device_uuid = ?'
    ).get(playerId, deviceUuid) as { id: number } | undefined;
  }

  updatePlayerDevice(deviceId: number, deviceName: string, lastLogin: string): void {
    this.database.prepare(
      'UPDATE player_devices SET device_name = ?, last_login = ? WHERE id = ?'
    ).run(deviceName, lastLogin, deviceId);
  }

  insertPlayerDevice(playerId: number, deviceUuid: string, deviceName: string, lastLogin: string): void {
    this.database.prepare(
      'INSERT INTO player_devices (player_id, device_uuid, device_name, last_login) VALUES (?, ?, ?, ?)'
    ).run(playerId, deviceUuid, deviceName, lastLogin);
  }

  // --- Players ---

  findPlayerIdByEmail(email: string): { player_id: number } | undefined {
    return this.database.prepare(
      'SELECT player_id FROM players WHERE email = ?'
    ).get(email) as { player_id: number } | undefined;
  }

  updatePlayerPasswordHash(playerId: number, passwordHash: string): void {
    this.database.prepare(
      'UPDATE players SET password_hash = ? WHERE player_id = ?'
    ).run(passwordHash, playerId);
  }

  // --- Referral codes (company_settings) ---

  findReferralCode(companyId: number): { value: string } | undefined {
    return this.database.prepare(
      "SELECT value FROM company_settings WHERE company_id = ? AND key = 'referral_code'"
    ).get(companyId) as { value: string } | undefined;
  }

  upsertReferralCode(companyId: number, code: string): void {
    this.database.prepare(
      "INSERT INTO company_settings (company_id, key, value) VALUES (?, 'referral_code', ?) ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value"
    ).run(companyId, code);
  }

  findCompanyIdByReferralCode(code: string): { company_id: number } | undefined {
    return this.database.prepare(
      "SELECT company_id FROM company_settings WHERE key = 'referral_code' AND value = ?"
    ).get(code) as { company_id: number } | undefined;
  }

  // --- Companies ---

  listCompaniesByRealm(realmId: number): CompanyRealmRow[] {
    return this.database.prepare(`
      SELECT company_id, player_id, name, logo, level, rating, created_at, note,
             extra_building_slots, realm_id
      FROM companies
      WHERE realm_id = ?
      ORDER BY id ASC
    `).all(realmId) as CompanyRealmRow[];
  }

  updateCompanyNote(companyId: number, note: string): void {
    this.database.prepare(
      'UPDATE companies SET note = ? WHERE company_id = ?'
    ).run(note, companyId);
  }

  findCompanyNameClash(name: string, excludeCompanyId: number): { company_id: number } | undefined {
    return this.database.prepare(
      'SELECT company_id FROM companies WHERE name = ? AND company_id != ?'
    ).get(name, excludeCompanyId) as { company_id: number } | undefined;
  }

  updateCompanyName(companyId: number, name: string): void {
    this.database.prepare(
      'UPDATE companies SET name = ? WHERE company_id = ?'
    ).run(name, companyId);
  }
}

export const authRepository = new AuthRepository();
