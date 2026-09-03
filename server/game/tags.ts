import { db } from '../db/database.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { getCompanyById, type CompanyRow } from './company.ts';

export interface CompanyTagDbRow {
  id: number;
  company_id: number;
  resource_kind: number;
  kind: string;
  buy_sell: string;
  created_at: string;
  expires_at: string;
}

function findCompany(idOrCompanyId: number | string): CompanyRow | null {
  const num = typeof idOrCompanyId === 'number' ? idOrCompanyId : parseInt(idOrCompanyId, 10);
  if (isNaN(num)) return null;
  const byComp = getCompanyById(num);
  if (byComp) return byComp;
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(num) as CompanyRow | undefined;
  return row || null;
}

// 1. Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS company_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    resource_kind INTEGER,
    kind TEXT,
    buy_sell TEXT,
    created_at TEXT,
    expires_at TEXT
  );
`);

// 2. Seed Default Tags
(function seedTags() {
  const tagCount = db.prepare('SELECT COUNT(*) as count FROM company_tags').get() as { count: number };
  if (tagCount.count === 0) {
    const insertTag = db.prepare('INSERT INTO company_tags (company_id, resource_kind, kind, buy_sell, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)');
    const nowStr = virtualClock.nowIso();
    const expStr = new Date(virtualClock.nowMs() + 30 * 86400000).toISOString();
    const firstComp = db.prepare('SELECT company_id FROM companies LIMIT 1').get() as { company_id: number } | undefined;
    const cid = firstComp ? firstComp.company_id : 4259175;
    insertTag.run(cid, 1, '1', 'b', nowStr, expStr);
    insertTag.run(cid, 2, '2', 's', nowStr, expStr);
  }
})();

// 3. Tag Management Functions
export function getCompanyTags(companyId: number) {
  const comp = findCompany(companyId);
  const actualId = comp ? comp.company_id : companyId;
  const rows = db.prepare('SELECT * FROM company_tags WHERE company_id = ? OR company_id = ?').all(actualId, companyId) as CompanyTagDbRow[];
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    resource: r.resource_kind,
    kind: r.kind,
    buy: r.buy_sell === 'b',
    sell: r.buy_sell === 's',
    buySell: r.buy_sell,
    expires: r.expires_at
  }));
}

export function addCompanyTag(companyId: number, kind: string, buySell: string) {
  const comp = findCompany(companyId);
  const actualId = comp ? comp.company_id : companyId;
  const resourceKind = parseInt(kind, 10) || 1;
  const now = virtualClock.nowIso();
  const expires = new Date(virtualClock.nowMs() + 30 * 86400000).toISOString();

  db.prepare('INSERT INTO company_tags (company_id, resource_kind, kind, buy_sell, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    actualId, resourceKind, kind, buySell, now, expires
  );

  return getCompanyTags(actualId);
}

export function deleteCompanyTag(tagId: number, companyId?: number) {
  if (companyId) {
    const comp = findCompany(companyId);
    const actualId = comp ? comp.company_id : companyId;
    db.prepare('DELETE FROM company_tags WHERE id = ? AND (company_id = ? OR company_id = ?)').run(tagId, actualId, companyId);
  } else {
    db.prepare('DELETE FROM company_tags WHERE id = ?').run(tagId);
  }
  return { success: true };
}

export function searchCompaniesByTags(tagQuery: string) {
  const tagParts = tagQuery.split('-');
  const allTags = db.prepare('SELECT * FROM company_tags').all() as CompanyTagDbRow[];
  const matchingCompanyIds = new Set<number>();

  for (const t of allTags) {
    const code = `${t.resource_kind}${t.buy_sell}`;
    if (tagParts.some((p) => p.toLowerCase() === code.toLowerCase() || p.includes(String(t.resource_kind)))) {
      matchingCompanyIds.add(t.company_id);
    }
  }

  if (matchingCompanyIds.size === 0) {
    const firstComp = db.prepare('SELECT company_id FROM companies LIMIT 1').get() as { company_id: number } | undefined;
    if (firstComp) matchingCompanyIds.add(firstComp.company_id);
  }

  const result = [];
  for (const cid of matchingCompanyIds) {
    const comp = findCompany(cid);
    if (!comp) continue;
    const ctags = getCompanyTags(cid);
    const tagCode = ctags.map((t) => `${t.resource}${t.buySell}`).join('-');
    result.push({
      id: comp.company_id,
      company: comp.name,
      logo: comp.logo || '',
      realmId: comp.realm_id || 0,
      level: comp.level || 1,
      tags: tagCode || '1b-2s',
      rating: comp.rating || 'AA',
      score: 100
    });
  }

  return result;
}

export function lookupCompany(realmId: number, search: string | number) {
  let comp: CompanyRow | null = null;
  const num = typeof search === 'number' ? search : parseInt(search, 10);
  if (!isNaN(num) && num > 0) {
    comp = findCompany(num);
  }
  if (!comp) {
    const cleanSearch = String(search).replace(/-/g, ' ');
    const row = db.prepare('SELECT * FROM companies WHERE (realm_id = ? OR 1=1) AND (name = ? OR name LIKE ?) LIMIT 1').get(realmId, cleanSearch, `%${cleanSearch}%`) as CompanyRow | undefined;
    if (row) comp = row;
  }
  if (!comp) {
    const firstComp = db.prepare('SELECT * FROM companies LIMIT 1').get() as CompanyRow | undefined;
    comp = firstComp || {
      id: 1,
      company_id: 4259175,
      player_id: 1,
      name: 'SimCorpHQ',
      money: 100000,
      simboosts: 250,
      level: 15,
      rating: 'AAA',
      experience: 20,
      realm_id: realmId,
      logo: '',
      personal_assistant: 'old',
      note: '',
      created_at: virtualClock.nowIso()
    };
  }

  return {
    id: comp.company_id || comp.id || 1,
    company: comp.name || 'SimCorpHQ',
    company_id: comp.company_id || comp.id || 1,
    realm_id: comp.realm_id ?? realmId,
    realmId: comp.realm_id ?? realmId,
    logo: comp.logo || '',
    rating: comp.rating || 'AAA',
    level: comp.level || 15
  };
}
