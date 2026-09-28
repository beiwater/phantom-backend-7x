import { db } from '../db/connection.ts';

/** Recorded outcomes only; launch validation and transactions belong to use cases. */
export const aerospaceRepository = {
  recordLaunch(companyId: number, realmId: number, buildingId: number,
    rocketKind: number, quality: number, success: boolean, launchedAt: string): void {
    db.prepare(`
      INSERT INTO rocket_launches (company_id, realm_id, building_id, rocket_kind, quality, success, launched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(companyId, realmId, buildingId, rocketKind, quality, success ? 1 : 0, launchedAt);
  }
};
