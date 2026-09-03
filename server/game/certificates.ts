import { db } from '../db/database.ts';
import { getCompanyById, type CompanyRow } from './company.ts';

export interface CertificateDbRow {
  id: number;
  realm_id: number;
  kind: number;
  place: number;
  name: string;
  company_id: number;
  company_name: string;
  value: number;
  rarity: number;
  year_started: number | null;
  resource_kind: number | null;
  datetime: string | null;
}

function findCompany(idOrCompanyId: number): CompanyRow | null {
  const byComp = getCompanyById(idOrCompanyId);
  if (byComp) return byComp;
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(idOrCompanyId) as CompanyRow | undefined;
  return row || null;
}

// 2. Seed Default Certificates
(function seedCertificates() {
  const certCount = db.prepare('SELECT COUNT(*) as count FROM certificates').get() as { count: number };
  if (certCount.count === 0) {
    const insertCert = db.prepare(`
      INSERT INTO certificates (realm_id, kind, place, name, company_id, company_name, value, rarity, year_started, resource_kind, datetime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const dateStr = new Date().toISOString();
    const firstComp = db.prepare('SELECT company_id, name FROM companies LIMIT 1').get() as { company_id: number; name: string } | undefined;
    const cid = firstComp ? firstComp.company_id : 4259175;
    const cname = firstComp ? firstComp.name : 'SimCorpHQ';
    insertCert.run(0, 29, 1, 'King Midas', cid, cname, 10000000, 0.005, 2024, null, dateStr);
    insertCert.run(0, 36, 1, 'Elon Award', cid, cname, 5000000, 0.012, 2024, null, dateStr);
    insertCert.run(0, 39, 1, 'Retailer of the Month', cid, cname, 2500000, 0.025, 2025, 3, dateStr);
    insertCert.run(0, 41, 1, 'Producer of the Year', cid, cname, 8000000, 0.018, 2024, 1, dateStr);
  }
})();

// 3. Certificates Query Functions
export function getLatestCertificates(realmId: number = 0) {
  const rows = db.prepare('SELECT * FROM certificates WHERE realm_id = ? ORDER BY id DESC LIMIT 20').all(realmId) as CertificateDbRow[];
  const latestCertificates = rows.map((r) => {
    const comp = findCompany(r.company_id);
    return {
      company: { id: comp ? comp.company_id : r.company_id, company: comp ? comp.name : r.company_name, logo: comp?.logo || '', realmId },
      kind: r.kind,
      place: r.place || 1,
      name: r.name,
      yearStarted: r.year_started || 2024,
      resourceKind: r.resource_kind || null,
      value: r.value || 0,
      datetime: r.datetime || new Date().toISOString()
    };
  });
  return { latestCertificates };
}

export function getRarestCertificates(realmId: number = 0) {
  const rows = db.prepare('SELECT * FROM certificates WHERE realm_id = ? ORDER BY rarity ASC, value DESC LIMIT 20').all(realmId) as CertificateDbRow[];
  const rarestCertificates = rows.map((r) => {
    const comp = findCompany(r.company_id);
    return {
      company: { id: comp ? comp.company_id : r.company_id, company: comp ? comp.name : r.company_name, logo: comp?.logo || '', realmId },
      kind: r.kind,
      place: r.place || 1,
      name: r.name,
      rarity: r.rarity || 0.05,
      realm: realmId,
      value: r.value || 1
    };
  });
  return { rarestCertificates };
}

export function getCertificateDetail(realmId: number = 0, kind: number, _certId: string | number = '-', _extra: string | number = '-') {
  const certRow = db.prepare('SELECT * FROM certificates WHERE realm_id = ? AND kind = ?').get(realmId, kind) as CertificateDbRow | undefined;
  const ownerComp = certRow ? findCompany(certRow.company_id) : findCompany(1);

  return {
    certificate: {
      id: certRow?.id || 1,
      kind,
      place: certRow?.place || 1,
      name: certRow?.name || 'Certificate',
      resourceKind: certRow?.resource_kind ?? null,
      yearStarted: certRow?.year_started ?? null
    },
    certificateRarity: {
      score: 1250,
      rarity: certRow?.rarity || 0.005
    },
    companiesCount: certRow ? 1 : 0,
    owner: ownerComp ? {
      id: ownerComp.company_id,
      company: ownerComp.name,
      logo: ownerComp.logo || '',
      realmId,
      contest_wins: 0,
      certificates: 4
    } : null,
    topHunters: ownerComp ? [{
      company: { id: ownerComp.company_id, company: ownerComp.name, logo: ownerComp.logo || '', realmId },
      value: certRow?.value || 10
    }] : [],
    latestOwners: ownerComp ? [{
      company: { id: ownerComp.company_id, company: ownerComp.name, logo: ownerComp.logo || '', realmId },
      value: 1
    }] : []
  };
}

export function getCompanyCertificates(companyId: number) {
  const comp = findCompany(companyId);
  const searchId = comp ? comp.company_id : companyId;
  const rows = db.prepare('SELECT * FROM certificates WHERE company_id = ? OR company_id = ? ORDER BY id DESC').all(searchId, companyId) as CertificateDbRow[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    place: r.place || 1,
    name: r.name,
    dateInfo: r.datetime ? r.datetime.slice(0, 7) : '2026',
    contestId: null,
    resourceKind: r.resource_kind || null
  }));
}
