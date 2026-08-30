import { db } from '../db/database.ts';

export interface DisplayCaseRow {
  id: number;
  company_id: number;
  slot: number;
  resource_kind: number;
  quality: number;
  title: string;
}

export function getCompanyAchievements(companyId: number) {
  return [
    { id: 1, achievement: 1, name: 'First Steps', level: 3, progress: 100, achieved: true, category: 'general' },
    { id: 2, achievement: 2, name: 'Industrialist', level: 2, progress: 75, achieved: false, category: 'production' },
    { id: 3, achievement: 3, name: 'Market Tycoon', level: 1, progress: 50, achieved: false, category: 'market' },
    { id: 4, achievement: 4, name: 'Employer of the Year', level: 2, progress: 100, achieved: true, category: 'executives' },
    { id: 5, achievement: 5, name: 'Scientist', level: 1, progress: 40, achieved: false, category: 'research' }
  ];
}

export function getDisplayCase(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM display_case WHERE company_id = ? ORDER BY slot ASC
  `).all(companyId) as unknown as DisplayCaseRow[];

  if (rows.length === 0) {
    const seed = [
      { slot: 1, kind: 3, quality: 12, title: 'Golden Apple' },
      { slot: 2, kind: 24, quality: 10, title: 'Flagship Smartphone' }
    ];
    for (const s of seed) {
      db.prepare(`
        INSERT INTO display_case (company_id, slot, resource_kind, quality, title)
        VALUES (?, ?, ?, ?, ?)
      `).run(companyId, s.slot, s.kind, s.quality, s.title);
    }
  }

  const current = db.prepare(`
    SELECT * FROM display_case WHERE company_id = ? ORDER BY slot ASC
  `).all(companyId) as unknown as DisplayCaseRow[];

  return current.map(r => ({
    slot: r.slot,
    resource: {
      kind: r.resource_kind,
      quality: r.quality,
      title: r.title
    }
  }));
}

export function updateDisplayCase(companyId: number, slot: number, resourceKind: number, quality: number = 0, title: string = '') {
  db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
  db.prepare(`
    INSERT INTO display_case (company_id, slot, resource_kind, quality, title)
    VALUES (?, ?, ?, ?, ?)
  `).run(companyId, slot, resourceKind, quality, title);

  return getDisplayCase(companyId);
}

export function removeDisplayCaseSlot(companyId: number, slot: number) {
  db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
  return getDisplayCase(companyId);
}

export function getCollectibles(companyId: number) {
  return [
    { id: 1, name: 'Founder Trophy', image: 'images/collectibles/trophy_01.png', tier: 1, date: new Date().toISOString() },
    { id: 2, name: 'Golden Coin 2026', image: 'images/collectibles/coin_gold.png', tier: 2, date: new Date().toISOString() }
  ];
}

export function getCertificates(realmId: number) {
  return [
    { id: 1, title: 'Top Producer of Apples', company: 'lifeline', date: new Date().toISOString(), rank: 1 },
    { id: 2, title: 'Fastest Growing Company', company: 'Solaris Energy Ltd', date: new Date().toISOString(), rank: 1 }
  ];
}
