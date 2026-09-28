import { db } from '../db/connection.ts';
import type { SQLOutputValue } from 'node:sqlite';
import { companyRepository, mapCompanyRow, type CompanyDbRow } from './company-repository.ts';

export interface CertificateKindDefinition {
  kind: number;
  name: string;
  description: string;
  defaultRarity: number;
  awardRule: string;
  period: string;
  resourceKind: number | null;
}

export interface CertificateDbRow extends Record<string, SQLOutputValue> {
  id: number;
  realm_id: number;
  kind: number;
  place: number | null;
  name: string | null;
  company_id: number;
  company_name: string | null;
  value: number | null;
  rarity: number | null;
  year_started: number | null;
  resource_kind: number | null;
  datetime: string | null;
  quantity: number | null;
  cycle_key: string | null;
  cycle_start_at: string | null;
  cycle_end_at: string | null;
  rank: number | null;
  issued_at: string | null;
}

export function getCertificateCatalog(): CertificateKindDefinition[] {
  const rows = db.prepare(`
    SELECT kind, name, description, default_rarity, award_rule, period, resource_kind
    FROM certificate_kinds ORDER BY kind ASC
  `).all() as Array<{
    kind: number;
    name: string;
    description: string;
    default_rarity: number;
    award_rule: string;
    period: string;
    resource_kind: number | null;
  }>;
  return rows.map(row => ({
    kind: Number(row.kind),
    name: row.name,
    description: row.description,
    defaultRarity: Number(row.default_rarity),
    awardRule: row.award_rule,
    period: row.period,
    resourceKind: row.resource_kind === null ? null : Number(row.resource_kind)
  }));
}

export function getCertificateKind(kind: number): CertificateKindDefinition | undefined {
  const row = db.prepare(`
    SELECT kind, name, description, default_rarity, award_rule, period, resource_kind
    FROM certificate_kinds WHERE kind = ?
  `).get(kind) as {
    kind: number;
    name: string;
    description: string;
    default_rarity: number;
    award_rule: string;
    period: string;
    resource_kind: number | null;
  } | undefined;
  return row ? {
    kind: Number(row.kind),
    name: row.name,
    description: row.description,
    defaultRarity: Number(row.default_rarity),
    awardRule: row.award_rule,
    period: row.period,
    resourceKind: row.resource_kind === null ? null : Number(row.resource_kind)
  } : undefined;
}

export function certificateRows(realmId: number, where = '', params: Array<string | number> = []): CertificateDbRow[] {
  return db.prepare(`
    SELECT * FROM certificates
    WHERE realm_id = ? ${where}
    ORDER BY COALESCE(issued_at, datetime) DESC, id DESC
  `).all(realmId, ...params) as CertificateDbRow[];
}

export function certificateDetailRow(
  realmId: number,
  kind: number,
  certificateId: string | number,
  resourceKind: string | number
): CertificateDbRow | undefined {
  const definition = getCertificateKind(kind);
  if (!definition) return undefined;
  const idToken = String(certificateId);
  const resourceToken = String(resourceKind);
  if (/^\d+$/.test(idToken) && Number(idToken) > 0) {
    return db.prepare('SELECT * FROM certificates WHERE id = ? AND realm_id = ? AND kind = ?')
      .get(Number(idToken), realmId, kind) as CertificateDbRow | undefined;
  }
  if ((definition.awardRule === 'retail' || definition.awardRule === 'production') && /^\d+$/.test(resourceToken)) {
    return db.prepare(`
      SELECT * FROM certificates
      WHERE realm_id = ? AND kind = ? AND resource_kind = ?
      ORDER BY COALESCE(issued_at, datetime) DESC, id DESC LIMIT 1
    `).get(realmId, kind, Number(resourceToken)) as CertificateDbRow | undefined;
  }
  return db.prepare(`
    SELECT * FROM certificates WHERE realm_id = ? AND kind = ?
    ORDER BY COALESCE(issued_at, datetime) DESC, id DESC LIMIT 1
  `).get(realmId, kind) as CertificateDbRow | undefined;
}

export function findCertificateCompany(idOrCompanyId: number) {
  const canonical = companyRepository.findById(idOrCompanyId);
  if (canonical) return canonical;
  const row = db.prepare('SELECT * FROM companies WHERE company_id = ? OR id = ? LIMIT 1')
    .get(idOrCompanyId, idOrCompanyId) as CompanyDbRow | undefined;
  return row ? mapCompanyRow(row) : null;
}

export function companyCertificateRows(companyId: number): CertificateDbRow[] {
  return db.prepare('SELECT * FROM certificates WHERE company_id = ? ORDER BY COALESCE(issued_at, datetime) DESC, id DESC')
    .all(companyId) as CertificateDbRow[];
}

export interface CertificateInsert {
  realmId: number; kind: number; companyId: number; companyName: string;
  name: string; rarity: number; quantity: number; rank: number;
  resourceKind?: number | null; cycleKey: string; cycleStartAt: string;
  cycleEndAt: string; issuedAt: string;
}

export function insertCertificate(input: CertificateInsert): CertificateDbRow {
  const existing = db.prepare(`
    SELECT * FROM certificates
    WHERE realm_id = ? AND kind = ? AND company_id = ? AND cycle_key = ?
      AND COALESCE(resource_kind, -1) = COALESCE(?, -1) AND rank = ?
    ORDER BY id LIMIT 1
  `).get(
    input.realmId,
    input.kind,
    input.companyId,
    input.cycleKey,
    input.resourceKind ?? null,
    input.rank
  ) as CertificateDbRow | undefined;
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO certificates (
      realm_id, kind, place, name, company_id, company_name, value, rarity,
      year_started, resource_kind, datetime, quantity, cycle_key,
      cycle_start_at, cycle_end_at, rank, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.realmId,
    input.kind,
    input.rank,
    input.name,
    input.companyId,
    input.companyName,
    input.quantity,
    input.rarity,
    new Date(input.cycleEndAt).getUTCFullYear(),
    input.resourceKind ?? null,
    input.issuedAt,
    input.quantity,
    input.cycleKey,
    input.cycleStartAt,
    input.cycleEndAt,
    input.rank,
    input.issuedAt
  ) as CertificateDbRow;
  return result;
}

export function realmCompanies(realmId: number): Array<{ company_id: number }> {
  return db.prepare('SELECT company_id FROM companies WHERE realm_id = ? ORDER BY company_id')
    .all(realmId) as Array<{ company_id: number }>;
}

export function cycleActivity(start: string, end: string): Array<{ company_id: number; activity: number }> {
  return db.prepare(`
    SELECT company_id, SUM(activity) AS activity FROM (
      SELECT company_id, COALESCE(SUM(amount), 0) AS activity FROM production_queues
      WHERE started_at >= ? AND started_at < ? GROUP BY company_id
      UNION ALL
      SELECT company_id, COALESCE(SUM(units), 0) AS activity FROM retail_orders
      WHERE created_at >= ? AND created_at < ? GROUP BY company_id
    ) GROUP BY company_id ORDER BY activity DESC, company_id ASC
  `).all(start, end, start, end) as Array<{ company_id: number; activity: number }>;
}

export function cycleProduction(realmId: number, start: string, end: string): Array<{ company_id: number; kind: number; quantity: number }> {
  return db.prepare(`
    SELECT q.company_id, q.kind, SUM(q.amount) AS quantity FROM production_queues q
    INNER JOIN companies c ON c.company_id = q.company_id
    WHERE c.realm_id = ? AND q.started_at >= ? AND q.started_at < ?
    GROUP BY q.company_id, q.kind ORDER BY quantity DESC, q.company_id ASC
  `).all(realmId, start, end) as Array<{ company_id: number; kind: number; quantity: number }>;
}

export function cycleRetail(realmId: number, start: string, end: string): Array<{ company_id: number; resource_kind: number; quantity: number }> {
  return db.prepare(`
    SELECT o.company_id, o.resource_kind, SUM(o.units) AS quantity FROM retail_orders o
    INNER JOIN companies c ON c.company_id = o.company_id
    WHERE c.realm_id = ? AND o.created_at >= ? AND o.created_at < ?
    GROUP BY o.company_id, o.resource_kind ORDER BY quantity DESC, o.company_id ASC
  `).all(realmId, start, end) as Array<{ company_id: number; resource_kind: number; quantity: number }>;
}
