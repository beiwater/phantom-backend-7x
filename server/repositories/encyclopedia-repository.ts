import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/connection.ts';

export interface ResourceProductionModifier {
  id: number;
  realm: number;
  kind: number;
  speedModifier: number;
  since: string;
  until: string;
}

interface ResourceProductionModifierDbRow {
  id: number;
  realm_id: number;
  kind: number;
  speed_modifier: number;
  since: string;
  until: string;
}

function mapModifierRow(row: ResourceProductionModifierDbRow): ResourceProductionModifier {
  return {
    id: Number(row.id),
    realm: Number(row.realm_id),
    kind: Number(row.kind),
    speedModifier: Number(row.speed_modifier),
    since: row.since,
    until: row.until
  };
}

export class EncyclopediaRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  listActiveResourceProductionModifiers(realmId: number, nowIso: string): ResourceProductionModifier[] {
    const rows = this.database.prepare(`
      SELECT id, realm_id, kind, speed_modifier, since, until
      FROM encyclopedia_resource_events
      WHERE realm_id = ?
        AND julianday(since) <= julianday(?)
        AND julianday(until) > julianday(?)
      ORDER BY since DESC, id DESC
    `).all(realmId, nowIso, nowIso) as ResourceProductionModifierDbRow[];
    return rows.map(mapModifierRow);
  }

  listEvents(realmId: number): ResourceProductionModifier[] {
    const rows = this.database.prepare(`
      SELECT id, realm_id, kind, speed_modifier, since, until
      FROM encyclopedia_resource_events
      WHERE realm_id = ?
      ORDER BY since DESC, id DESC
    `).all(realmId) as ResourceProductionModifierDbRow[];
    return rows.map(mapModifierRow);
  }
}

export const encyclopediaRepository = new EncyclopediaRepository();
