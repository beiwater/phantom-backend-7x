import { db } from '../db/database.ts';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from './company.ts';

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS company_achievements (
    company_id INTEGER NOT NULL,
    achievement_id TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    PRIMARY KEY (company_id, achievement_id)
  )
`);

export interface IndividualAchievement {
  id: string;
  name: string;
  congratulation: string;
  is_daily: boolean;
  is_level: boolean;
  level: number;
  done: number;
  available: number;
  sim_boosts: number;
  reward: number;
  message: string;
  nextAchievement: {
    name: string;
    done: number;
    available: number;
    message: string;
    reward: number;
    sim_boosts: number;
  } | null;
}

export const ALL_ACHIEVEMENTS: IndividualAchievement[] = [
  {
    id: "market-tycoon",
    name: "Market Tycoon",
    congratulation: "恭喜达成市场大亨成就！",
    is_daily: false,
    is_level: false,
    level: 1,
    done: 1,
    available: 1,
    sim_boosts: 5,
    reward: 5000,
    message: "在交易所买卖并达成大宗商品交易。",
    nextAchievement: {
      name: "Market Tycoon II",
      done: 2,
      available: 0,
      message: "继续在交易所交易以达到更高星级。",
      reward: 10000,
      sim_boosts: 10
    }
  },
  {
    id: "first-steps",
    name: "First Steps",
    congratulation: "初涉商海，迈出成功第一步！",
    is_daily: false,
    is_level: false,
    level: 1,
    done: 1,
    available: 1,
    sim_boosts: 5,
    reward: 2500,
    message: "在产业地图上兴建并运营你的第一座工厂。",
    nextAchievement: null
  },
  {
    id: "builder",
    name: "Builder",
    congratulation: "建筑大师，产业规模进一步扩张！",
    is_daily: false,
    is_level: false,
    level: 2,
    done: 2,
    available: 1,
    sim_boosts: 5,
    reward: 5000,
    message: "升级建筑以扩大产能和员工规模。",
    nextAchievement: {
      name: "Builder III",
      done: 3,
      available: 0,
      message: "继续升级建筑以达到最高星级。",
      reward: 15000,
      sim_boosts: 10
    }
  },
  {
    id: "employer-of-the-year",
    name: "Employer of the Year",
    congratulation: "卓越雇主，高管团队高效运转！",
    is_daily: false,
    is_level: false,
    level: 1,
    done: 1,
    available: 1,
    sim_boosts: 5,
    reward: 5000,
    message: "招聘并培训管理团队，提升公司运营效益。",
    nextAchievement: null
  }
];

export function getIndividualAchievements(companyId: number): IndividualAchievement[] {
  const collectedRows = db.prepare(`
    SELECT achievement_id FROM company_achievements WHERE company_id = ?
  `).all(companyId) as Array<{ achievement_id: string }>;

  const collectedSet = new Set(collectedRows.map(r => String(r.achievement_id)));

  // Return uncollected achievements with available: 1
  return ALL_ACHIEVEMENTS.map(ach => {
    const isCollected = collectedSet.has(ach.id) || collectedSet.has(String(ach.id));
    return {
      ...ach,
      done: isCollected ? 2 : 1,
      available: isCollected ? 0 : 1
    };
  }).filter(ach => ach.available > 0);
}

export function claimAchievement(companyId: number, achievementId: string) {
  const ach = ALL_ACHIEVEMENTS.find(a => a.id === achievementId || String(a.id) === String(achievementId)) || ALL_ACHIEVEMENTS[0];
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO company_achievements (company_id, achievement_id, collected_at)
    VALUES (?, ?, ?)
  `).run(companyId, String(achievementId), now);

  const boostReward = ach.sim_boosts || 5;
  const cashReward = ach.reward || 5000;

  updateCompanySimBoosts(companyId, boostReward);
  updateCompanyMoney(companyId, cashReward);

  const updatedComp = getCompanyById(companyId);
  return {
    success: true,
    sim_boosts: boostReward,
    simboosts: updatedComp?.sim_boosts || 250,
    reward: cashReward,
    money: updatedComp?.money || 100000
  };
}

export function getAchievementsOverview(companyId: number) {
  const collectedRows = db.prepare(`
    SELECT achievement_id FROM company_achievements WHERE company_id = ?
  `).all(companyId) as Array<{ achievement_id: string }>;

  const collectedSet = new Set(collectedRows.map(r => String(r.achievement_id)));

  return [
    {
      id: "market-tycoon",
      label: "Market Tycoon",
      action: "在交易所买卖并达成大宗商品交易",
      type: "market-tycoon",
      stars: collectedSet.has("market-tycoon") ? 2 : 1,
      starsMax: 5,
      reward: 5000,
      simBoosts: 5,
      rewards: [1000, 2500, 5000, 10000, 25000],
      progress: { percent: 100, label: "已达成" },
      image: "images/achievements/market.png"
    },
    {
      id: "first-steps",
      label: "First Steps",
      action: "建立第一座生产建筑",
      type: "first-steps",
      stars: collectedSet.has("first-steps") ? 2 : 1,
      starsMax: 5,
      reward: 2500,
      simBoosts: 5,
      rewards: [500, 1000, 2500, 5000, 10000],
      progress: { percent: 100, label: "已达成" },
      image: "images/achievements/general.png"
    },
    {
      id: "builder",
      label: "Builder",
      action: "升级产业建筑规模",
      type: "builder",
      stars: collectedSet.has("builder") ? 3 : 2,
      starsMax: 5,
      reward: 5000,
      simBoosts: 5,
      rewards: [1000, 2500, 5000, 10000, 25000],
      progress: { percent: 80, label: "4 / 5" },
      image: "images/achievements/construction.png"
    },
    {
      id: "employer-of-the-year",
      label: "Employer of the Year",
      action: "管理并培训高管团队",
      type: "employer-of-the-year",
      stars: collectedSet.has("employer-of-the-year") ? 2 : 1,
      starsMax: 5,
      reward: 5000,
      simBoosts: 5,
      rewards: [1000, 2500, 5000, 10000, 25000],
      progress: { percent: 100, label: "已达成" },
      image: "images/achievements/executives.png"
    }
  ];
}

export interface DisplayCaseRow {
  id: number;
  company_id: number;
  slot: number;
  resource_kind: number;
  quality: number;
  title: string;
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
