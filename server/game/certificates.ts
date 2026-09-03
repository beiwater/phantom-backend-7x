import { db } from '../db/database.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { getCompanyById, type CompanyRow } from './company.ts';
import { getResourceDef } from '../game-data/resources.ts';

export interface CertificateKindDefinition {
  kind: number;
  name: string;
  description: string;
  defaultRarity: number;
  awardRule: string;
  period: string;
  resourceKind: number | null;
}

export interface CertificateDbRow {
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

export interface CertificateAward {
  id: number;
  realm: number;
  kind: number;
  name: string;
  description: string;
  place: number;
  rank: number;
  company: {
    id: number;
    company: string;
    logo: string;
    realmId: number;
  };
  yearStarted: number | null;
  resourceKind: number | null;
  quantity: number;
  value: number;
  rarity: number;
  cycleKey: string | null;
  cycleStartAt: string | null;
  cycleEndAt: string | null;
  datetime: string;
  issuedAt: string;
}

function findCompany(idOrCompanyId: number): CompanyRow | null {
  const byCompany = getCompanyById(idOrCompanyId);
  if (byCompany) return byCompany;
  const row = db.prepare('SELECT * FROM companies WHERE company_id = ? OR id = ? LIMIT 1')
    .get(idOrCompanyId, idOrCompanyId) as CompanyRow | undefined;
  return row || null;
}

function ensureDevelopmentSeed(): void {
  if (process.env.NODE_ENV === 'production') return;
  const count = db.prepare('SELECT COUNT(*) AS count FROM certificates').get() as { count: number };
  if (Number(count.count) !== 0) return;
  const firstCompany = db.prepare('SELECT company_id, name, realm_id FROM companies ORDER BY company_id LIMIT 1').get() as {
    company_id: number;
    name: string;
    realm_id: number;
  } | undefined;
  if (!firstCompany) return;
  const now = virtualClock.nowIso();
  const seeds = [
    { kind: 29, place: 1, resourceKind: 69, quantity: 10000000, rarity: 0.005 },
    { kind: 36, place: 1, resourceKind: null, quantity: 5000000, rarity: 0.012 },
    { kind: 39, place: 1, resourceKind: 3, quantity: 2500000, rarity: 0.025 },
    { kind: 41, place: 1, resourceKind: 1, quantity: 8000000, rarity: 0.018 }
  ];
  const insert = db.prepare(`
    INSERT INTO certificates (
      realm_id, kind, place, name, company_id, company_name, value, rarity,
      year_started, resource_kind, datetime, quantity, cycle_key,
      cycle_start_at, cycle_end_at, rank, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const seed of seeds) {
    const definition = getCertificateKind(seed.kind);
    insert.run(
      firstCompany.realm_id,
      seed.kind,
      seed.place,
      definition?.name || `Certificate #${seed.kind}`,
      firstCompany.company_id,
      firstCompany.name,
      seed.quantity,
      seed.rarity,
      virtualClock.now().getUTCFullYear(),
      seed.resourceKind,
      now,
      seed.quantity,
      `development:${now.slice(0, 10)}`,
      now,
      now,
      seed.place,
      now
    );
  }
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

function getCertificateKind(kind: number): CertificateKindDefinition | undefined {
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

function mapCertificate(row: CertificateDbRow): CertificateAward {
  const definition = getCertificateKind(Number(row.kind));
  const company = findCompany(Number(row.company_id));
  const issuedAt = row.issued_at || row.datetime || virtualClock.nowIso();
  const quantity = Number(row.quantity ?? row.value ?? 0);
  const rank = Number(row.rank ?? row.place ?? 1);
  return {
    id: Number(row.id),
    realm: Number(row.realm_id),
    kind: Number(row.kind),
    name: row.name || definition?.name || `Certificate #${row.kind}`,
    description: definition?.description || '',
    place: Number(row.place ?? rank),
    rank,
    company: {
      id: company?.company_id ?? Number(row.company_id),
      company: company?.name || row.company_name || `Company #${row.company_id}`,
      logo: company?.logo || '',
      realmId: company?.realmId ?? Number(row.realm_id)
    },
    yearStarted: row.year_started === null ? null : Number(row.year_started),
    resourceKind: row.resource_kind === null ? null : Number(row.resource_kind),
    quantity,
    value: Number(row.value ?? quantity),
    rarity: Number(row.rarity ?? definition?.defaultRarity ?? 0.05),
    cycleKey: row.cycle_key,
    cycleStartAt: row.cycle_start_at,
    cycleEndAt: row.cycle_end_at,
    datetime: row.datetime || issuedAt,
    issuedAt
  };
}

function certificateRows(realmId: number, where = '', params: Array<string | number> = []): CertificateDbRow[] {
  return db.prepare(`
    SELECT * FROM certificates
    WHERE realm_id = ? ${where}
    ORDER BY COALESCE(issued_at, datetime) DESC, id DESC
  `).all(realmId, ...params) as CertificateDbRow[];
}

export function getLatestCertificates(realmId: number = 0): CertificateAward[] {
  ensureDevelopmentSeed();
  return certificateRows(realmId).slice(0, 20).map(mapCertificate);
}

export function getRarestCertificates(realmId: number = 0): CertificateAward[] {
  ensureDevelopmentSeed();
  return certificateRows(realmId)
    .sort((a, b) => Number(a.rarity ?? 0.05) - Number(b.rarity ?? 0.05) || Number(b.value ?? 0) - Number(a.value ?? 0))
    .slice(0, 20)
    .map(mapCertificate);
}

function certificateDetailRow(
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

export function getCertificateDetail(
  realmId: number,
  kind: number,
  certificateId: string | number = '-',
  resourceKind: string | number = '-'
): Record<string, unknown> | null {
  const definition = getCertificateKind(kind);
  if (!definition) return null;
  const row = certificateDetailRow(realmId, kind, certificateId, resourceKind);
  if (/^\d+$/.test(String(certificateId)) && Number(certificateId) > 0 && !row) return null;
  if ((definition.awardRule === 'retail' || definition.awardRule === 'production')
    && /^\d+$/.test(String(resourceKind)) && !row) return null;
  const holderRows = db.prepare(`
    SELECT * FROM certificates
    WHERE realm_id = ? AND kind = ? ${row?.resource_kind === null || row?.resource_kind === undefined ? '' : 'AND resource_kind = ?'}
    ORDER BY COALESCE(issued_at, datetime) DESC, id DESC
  `).all(
    realmId,
    kind,
    ...(row?.resource_kind === null || row?.resource_kind === undefined ? [] : [row.resource_kind])
  ) as CertificateDbRow[];
  const holders = holderRows.map(mapCertificate);
  const detail = row ? mapCertificate(row) : null;
  return {
    certificate: {
      id: detail?.id ?? null,
      kind,
      name: definition.name,
      description: definition.description,
      place: detail?.place ?? null,
      rank: detail?.rank ?? null,
      resourceKind: detail?.resourceKind ?? definition.resourceKind,
      quantity: detail?.quantity ?? 0,
      yearStarted: detail?.yearStarted ?? null,
      cycleKey: detail?.cycleKey ?? null,
      cycleStartAt: detail?.cycleStartAt ?? null,
      cycleEndAt: detail?.cycleEndAt ?? null
    },
    holders,
    certificateRarity: {
      score: detail ? Math.round((1 / Math.max(detail.rarity, 0.000001)) * 100) / 100 : 0,
      rarity: detail?.rarity ?? definition.defaultRarity
    },
    companiesCount: holders.length,
    owner: detail?.company || null,
    topHunters: holders.map(holder => ({ company: holder.company, value: holder.value })),
    latestOwners: holders.map(holder => ({ company: holder.company, value: holder.quantity }))
  };
}

export function getCompanyCertificates(companyId: number): CertificateAward[] {
  ensureDevelopmentSeed();
  const rows = db.prepare(`
    SELECT * FROM certificates
    WHERE company_id = ? ORDER BY COALESCE(issued_at, datetime) DESC, id DESC
  `).all(companyId) as CertificateDbRow[];
  return rows.map(mapCertificate);
}

export function getCertificates(realmId: number = 0): CertificateAward[] {
  return getLatestCertificates(realmId);
}

function issueCertificate(input: {
  realmId: number;
  kind: number;
  companyId: number;
  quantity: number;
  rank: number;
  resourceKind?: number | null;
  cycleKey: string;
  cycleStartAt: string;
  cycleEndAt: string;
  issuedAt: string;
}): CertificateAward {
  const definition = getCertificateKind(input.kind);
  if (!definition) throw new Error(`Unknown certificate kind ${input.kind}`);
  const company = findCompany(input.companyId);
  if (!company) throw new Error(`Company ${input.companyId} not found`);
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
  if (existing) return mapCertificate(existing);
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
    definition.name,
    company.company_id,
    company.name,
    input.quantity,
    definition.defaultRarity,
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
  return mapCertificate(result);
}

export function grantCycleCertificates(
  realmId: number,
  cycleStart: Date,
  cycleEnd: Date
): { cycleKey: string; issued: CertificateAward[] } {
  const cycleStartIso = cycleStart.toISOString();
  const cycleEndIso = cycleEnd.toISOString();
  const cycleKey = `${realmId}:${cycleStartIso}:${cycleEndIso}`;
  const companies = db.prepare(
    'SELECT company_id FROM companies WHERE realm_id = ? ORDER BY company_id'
  ).all(realmId) as Array<{ company_id: number }>;
  const issued: CertificateAward[] = [];
  if (companies.length === 0) return { cycleKey, issued };

  const activityRows = db.prepare(`
    SELECT company_id, SUM(activity) AS activity
    FROM (
      SELECT company_id, COALESCE(SUM(amount), 0) AS activity
      FROM production_queues
      WHERE started_at >= ? AND started_at < ? GROUP BY company_id
      UNION ALL
      SELECT company_id, COALESCE(SUM(units), 0) AS activity
      FROM retail_orders
      WHERE created_at >= ? AND created_at < ? GROUP BY company_id
    ) GROUP BY company_id ORDER BY activity DESC, company_id ASC
  `).all(cycleStartIso, cycleEndIso, cycleStartIso, cycleEndIso) as Array<{ company_id: number; activity: number }>;
  const overall = new Map<number, number>();
  for (const row of activityRows) overall.set(Number(row.company_id), Number(row.activity));
  const rankedOverall = companies
    .map(company => ({ companyId: Number(company.company_id), activity: overall.get(Number(company.company_id)) || 0 }))
    .sort((a, b) => b.activity - a.activity || a.companyId - b.companyId);
  for (let index = 0; index < Math.min(3, rankedOverall.length); index++) {
    const winner = rankedOverall[index];
    if (winner.activity <= 0) continue;
    issued.push(issueCertificate({
      realmId,
      kind: 1,
      companyId: winner.companyId,
      quantity: winner.activity,
      rank: index + 1,
      cycleKey,
      cycleStartAt: cycleStartIso,
      cycleEndAt: cycleEndIso,
      issuedAt: cycleEndIso
    }));
  }

  const productionRows = db.prepare(`
    SELECT q.company_id, q.kind, SUM(q.amount) AS quantity
    FROM production_queues q
    INNER JOIN companies c ON c.company_id = q.company_id
    WHERE c.realm_id = ? AND q.started_at >= ? AND q.started_at < ?
    GROUP BY q.company_id, q.kind ORDER BY quantity DESC, q.company_id ASC
  `).all(realmId, cycleStartIso, cycleEndIso) as Array<{ company_id: number; kind: number; quantity: number }>;
  const productionRank = new Map<number, number>();
  for (const row of productionRows) {
    const resource = getResourceDef(Number(row.kind));
    if (resource?.isResearch) continue;
    const resourceKey = Number(row.kind);
    const rank = (productionRank.get(resourceKey) || 0) + 1;
    productionRank.set(resourceKey, rank);
    issued.push(issueCertificate({
      realmId,
      kind: 41,
      companyId: Number(row.company_id),
      quantity: Number(row.quantity),
      rank,
      resourceKind: resourceKey,
      cycleKey,
      cycleStartAt: cycleStartIso,
      cycleEndAt: cycleEndIso,
      issuedAt: cycleEndIso
    }));
  }

  const retailRows = db.prepare(`
    SELECT o.company_id, o.resource_kind AS resource_kind, SUM(o.units) AS quantity
    FROM retail_orders o
    INNER JOIN companies c ON c.company_id = o.company_id
    WHERE c.realm_id = ? AND o.created_at >= ? AND o.created_at < ?
    GROUP BY o.company_id, o.resource_kind ORDER BY quantity DESC, o.company_id ASC
  `).all(realmId, cycleStartIso, cycleEndIso) as Array<{ company_id: number; resource_kind: number; quantity: number }>;
  const retailRank = new Map<number, number>();
  for (const row of retailRows) {
    const resourceKey = Number(row.resource_kind);
    const rank = (retailRank.get(resourceKey) || 0) + 1;
    retailRank.set(resourceKey, rank);
    issued.push(issueCertificate({
      realmId,
      kind: 39,
      companyId: Number(row.company_id),
      quantity: Number(row.quantity),
      rank,
      resourceKind: resourceKey,
      cycleKey,
      cycleStartAt: cycleStartIso,
      cycleEndAt: cycleEndIso,
      issuedAt: cycleEndIso
    }));
  }
  return { cycleKey, issued };
}
