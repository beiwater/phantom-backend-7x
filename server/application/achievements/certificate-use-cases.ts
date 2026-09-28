import { virtualClock } from '../../core/virtual-clock.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import {
  getCertificateCatalog, getCertificateKind, certificateRows, certificateDetailRow,
  findCertificateCompany as findCompany, companyCertificateRows, insertCertificate,
  realmCompanies, cycleActivity, cycleProduction, cycleRetail
} from '../../repositories/certificate-repository.ts';
import type { CertificateDbRow } from '../../repositories/certificate-repository.ts';
export { getCertificateCatalog } from '../../repositories/certificate-repository.ts';
export type { CertificateKindDefinition } from '../../repositories/certificate-repository.ts';

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
      id: company?.companyId ?? Number(row.company_id),
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

export function getLatestCertificates(realmId: number = 0): CertificateAward[] {
  return certificateRows(realmId).slice(0, 20).map(mapCertificate);
}

export function getRarestCertificates(realmId: number = 0): CertificateAward[] {
  return certificateRows(realmId)
    .sort((a, b) => Number(a.rarity ?? 0.05) - Number(b.rarity ?? 0.05) || Number(b.value ?? 0) - Number(a.value ?? 0))
    .slice(0, 20)
    .map(mapCertificate);
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
  const holderRows = certificateRows(realmId, 'AND kind = ?' + (row?.resource_kind == null ? '' : ' AND resource_kind = ?'),
    [kind, ...(row?.resource_kind == null ? [] : [row.resource_kind])]);
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
  const comp = findCompany(companyId);
  const targetId = comp ? comp.companyId : companyId;
  const rows = companyCertificateRows(targetId);
  return rows.map(mapCertificate);
}

export function getCertificates(realmId: number = 0): CertificateAward[] {
  return getLatestCertificates(realmId);
}

export function issueCertificate(input: {
  realmId?: number;
  kind: number;
  companyId: number;
  quantity?: number;
  rank?: number;
  resourceKind?: number | null;
  cycleKey?: string;
  cycleStartAt?: string;
  cycleEndAt?: string;
  issuedAt?: string;
}): CertificateAward {
  const definition = getCertificateKind(input.kind);
  if (!definition) throw new Error(`Unknown certificate kind ${input.kind}`);
  const company = findCompany(input.companyId);
  if (!company) throw new Error(`Company ${input.companyId} not found`);

  const now = virtualClock.nowIso();
  const realmId = input.realmId ?? 0;
  const quantity = input.quantity ?? 1;
  const rank = input.rank ?? 1;
  const cycleKey = input.cycleKey ?? `manual_award_${Date.now()}`;
  const cycleStartAt = input.cycleStartAt ?? now;
  const cycleEndAt = input.cycleEndAt ?? now;
  const issuedAt = input.issuedAt ?? now;

  const result = insertCertificate({
    ...input, realmId, companyId: company.companyId, companyName: company.name,
    name: definition.name, rarity: definition.defaultRarity,
    quantity, rank, cycleKey, cycleStartAt, cycleEndAt, issuedAt
  });
  return mapCertificate(result);
}

export function grantCycleCertificates(
  realmId: number = 0,
  cycleStart: Date = new Date(virtualClock.nowMs() - 7 * 24 * 3600 * 1000),
  cycleEnd: Date = new Date(virtualClock.nowMs())
): { cycleKey: string; issued: CertificateAward[] } {
  const cycleStartIso = cycleStart.toISOString();
  const cycleEndIso = cycleEnd.toISOString();
  const cycleKey = `${realmId}:${cycleStartIso}:${cycleEndIso}`;
  const companies = realmCompanies(realmId);
  const issued: CertificateAward[] = [];
  if (companies.length === 0) return { cycleKey, issued };

  const activityRows = cycleActivity(cycleStartIso, cycleEndIso);
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

  const productionRows = cycleProduction(realmId, cycleStartIso, cycleEndIso);
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

  const retailRows = cycleRetail(realmId, cycleStartIso, cycleEndIso);
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
