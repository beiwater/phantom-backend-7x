import { db, seedDefaultDisplayCase } from '../db/database.ts';
import { CONFIG } from '../config.ts';
import { computeLevelInfo, getXpRequiredForLevel } from '../domain/leveling/level-rules.ts';
import { seedDefaultExecutives } from './executives.ts';
import { getCompanyBoostSettings, getExchangedToday } from './simboost-settings.ts';
import { recordCashLedger, refreshDailyFinanceSnapshot } from './cash-ledger.ts';

export interface CompanyRow {
  id: number;
  company_id: number;
  name: string;
  money: number;
  simboosts: number;
  level: number;
  rating: string;
  experience: number;
  realm_id: number;
  logo: string;
  personal_assistant: string;
  note: string;
  extra_building_slots?: number;
  extra_executive_slots?: number;
  display_case_slots?: number;
  max_tags?: number;
  show_online_indicator?: number;
  moderator_sign?: number;
}

function toSafeCompanyName(name: string): string {
  return name.replace(/[\/\\]/g, '-');
}


export interface PlayerRow {
  id: number;
  player_id: number;
  email: string;
  password_hash?: string;
  password?: string;
  is_admin: number;
  theme?: string;
  language?: string;
  created_at: string;
}

export function getCompanyByPlayerId(playerId: number): CompanyRow | null {
  const row = db.prepare('SELECT * FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1').get(playerId) as CompanyRow | undefined;
  return row || null;
}

export function getCompanyById(companyId: number): CompanyRow | null {
  const row = db.prepare('SELECT * FROM companies WHERE company_id = ?').get(companyId) as CompanyRow | undefined;
  return row || null;
}

export function updateCompanyMoney(companyId: number, delta: number): number {
  if (!Number.isFinite(delta)) {
    throw new Error('Money delta must be finite');
  }

  const comp = getCompanyById(companyId);
  if (!comp) {
    throw new Error('Company not found');
  }

  const currentMoney = Number(comp.money);
  if (!Number.isFinite(currentMoney)) {
    throw new Error('Company balance is invalid');
  }

  const newMoney = Math.round((currentMoney + delta) * 100) / 100;
  if (!Number.isFinite(newMoney)) {
    throw new Error('Money balance is invalid');
  }
  if (newMoney < 0) {
    throw new Error('Insufficient funds');
  }

  const result = db.prepare('UPDATE companies SET money = ? WHERE company_id = ?').run(newMoney, companyId);
  if (result.changes !== 1) {
    throw new Error('Company not found');
  }
  recordCashLedger({ companyId, amount: delta, category: 'g', description: 'Company money change', descriptionKey: '' });
  refreshDailyFinanceSnapshot(companyId);
  return newMoney;
}

export function updateCompanySimBoosts(companyId: number, delta: number): number {
  if (!Number.isFinite(delta)) {
    throw new Error('SimBoost delta must be finite');
  }

  const comp = getCompanyById(companyId);
  if (!comp) {
    throw new Error('Company not found');
  }

  const currentSB = Number(comp.simboosts);
  if (!Number.isFinite(currentSB)) {
    throw new Error('Company SimBoost balance is invalid');
  }

  const newSB = currentSB + delta;
  if (!Number.isFinite(newSB)) {
    throw new Error('SimBoost balance is invalid');
  }
  if (newSB < 0) {
    throw new Error('Insufficient SimBoosts');
  }

  const result = db.prepare('UPDATE companies SET simboosts = ? WHERE company_id = ?').run(newSB, companyId);
  if (result.changes !== 1) {
    throw new Error('Company not found');
  }
  return newSB;
}

export function createCompanyForPlayer(playerId: number, name: string, realmId: number = 0) {
  const companyId = Math.floor(4000000 + Math.random() * 6000000);
  const now = new Date().toISOString();
  const initialMoney = CONFIG.INITIAL_MONEY || 100000;
  const initialSimboosts = CONFIG.INITIAL_SIMBOOSTS || 250;
  const initialLevel = typeof CONFIG.INITIAL_LEVEL === 'number' ? CONFIG.INITIAL_LEVEL : 0;
  db.exec('BEGIN IMMEDIATE');
  try {

  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 0, ?, '', 'old', 'Private Server Company', ?)
  `).run(companyId, playerId, name, initialMoney, initialSimboosts, initialLevel, realmId, now);
  seedDefaultDisplayCase(companyId);
  seedDefaultExecutives(companyId);

  // Seed default Farm and Grocery store
  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
  `).run(companyId, now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '1', 'G', 1, 'Grocery store', 10350, 'sales', ?)
  `).run(companyId, now);

  // Seed generous initial warehouse stock including construction materials
  const seedStock = [
    { kind: 1, amount: 20000 },   // Power
    { kind: 2, amount: 20000 },   // Water
    { kind: 66, amount: 10000 },  // Seeds
    { kind: 13, amount: 20000 },  // Transport
    { kind: 3, amount: 5000 },    // Apples
    { kind: 4, amount: 5000 },    // Oranges
    { kind: 119, amount: 5000 },  // Coffee
    { kind: 101, amount: 5000 },  // Planks
    { kind: 102, amount: 5000 },  // Bricks
    { kind: 108, amount: 5000 },  // Reinforced concrete
    { kind: 111, amount: 5000 }   // Construction units
  ];

  for (const s of seedStock) {
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, 0, ?, 0, 0, 0, 0, 1.0, ?)
    `).run(companyId, s.kind, s.amount, now);
  }
    db.exec('COMMIT');
    return getCompanyById(companyId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return comp;
}

export function addCompanyExperience(companyId: number, xpGain: number) {
  if (!xpGain || xpGain <= 0) return;
  const comp = getCompanyById(companyId);
  if (!comp) return;
  let level = Number(comp.level || 0);
  let experience = Number(comp.experience || 0) + xpGain;
  let xpNeeded = getXpRequiredForLevel(level);

  while (experience >= xpNeeded && level < 60) {
    experience -= xpNeeded;
    level += 1;
    xpNeeded = getXpRequiredForLevel(level);
  }

  db.prepare('UPDATE companies SET level = ?, experience = ? WHERE company_id = ?').run(level, experience, companyId);
  return { level, experience };
}

export function resetCompany(companyId: number) {
  const comp = getCompanyById(companyId);
  if (!comp) throw new Error('Company not found');

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM buildings WHERE company_id = ?').run(companyId);
    db.prepare('DELETE FROM production_queues WHERE company_id = ?').run(companyId);
    db.prepare('DELETE FROM retail_orders WHERE company_id = ?').run(companyId);
    db.prepare('DELETE FROM warehouse WHERE company_id = ?').run(companyId);
    db.prepare('DELETE FROM display_case WHERE company_id = ?').run(companyId);

    const now = new Date().toISOString();
    const updated = db.prepare(`
      UPDATE companies
      SET money = ?, level = 1, experience = 0, created_at = ?
      WHERE company_id = ?
    `).run(CONFIG.INITIAL_MONEY, now, companyId);
    if (updated.changes !== 1) throw new Error('Company not found');

    db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
    `).run(companyId, now);
    seedDefaultDisplayCase(companyId);
    seedDefaultExecutives(companyId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updatePlayerPreferences(playerId: number, prefs: { theme?: string; language?: string }) {
  if (prefs.theme) {
    db.prepare('UPDATE players SET theme = ? WHERE player_id = ?').run(prefs.theme, playerId);
  }
  if (prefs.language) {
    db.prepare('UPDATE players SET language = ? WHERE player_id = ?').run(prefs.language, playerId);
  }
}

/**
 * P1-06: account-settings page persists company-level display flags.
 * The settings page toggles "显示在线/离线状态" and "显示协管标记" via
 * PATCH /api/v3/companies/:id/ and expects the change to survive reloads.
 */
export function updateCompanySettings(
  companyId: number,
  settings: { showOnlineIndicator?: boolean; moderatorSign?: boolean }
): void {
  if (settings.showOnlineIndicator !== undefined) {
    db.prepare('UPDATE companies SET show_online_indicator = ? WHERE company_id = ?')
      .run(settings.showOnlineIndicator ? 1 : 0, companyId);
  }
  if (settings.moderatorSign !== undefined) {
    db.prepare('UPDATE companies SET moderator_sign = ? WHERE company_id = ?')
      .run(settings.moderatorSign ? 1 : 0, companyId);
  }
}

export function getPersonalData(playerId: number) {
  const player = db.prepare('SELECT * FROM players WHERE player_id = ?').get(playerId) as PlayerRow | undefined;
  const companies = db.prepare('SELECT * FROM companies WHERE player_id = ?').all(playerId) as unknown as CompanyRow[];

  return {
    player: {
      id: player?.player_id,
      email: player?.email,
      isAdmin: Boolean(player?.is_admin),
      createdAt: player?.created_at
    },
    companies: companies.map(c => ({
      id: c.company_id,
      name: c.name,
      money: Number(c.money) || 0,
      level: c.level,
      realmId: c.realm_id
    }))
  };
}

export function getAuthData(playerId?: number | null, targetCompanyId?: number | null) {
  if (!playerId) {
    return {
      authUser: null,
      authCompany: {
        id: null,
        companyId: null,
        company: "",
        personalAssistant: "old",
        moderatorSign: false,
        hqImage: "",
        money: 0,
        exchangedToday: 0,
        simBoosts: 0,
        popupNotifications: {},
        productionModifier: 0,
        salesModifier: 0,
        countryCodeIsoUserSet: "",
        rank: null,
        evaRank: null,
        evaMonth: null,
        extraExecutiveSlots: 0,
        extraBuildingSlots: 0,
        displayCaseSlots: 0,
        logo: "",
        startingPackPurchased: false,
        maxTags: 1,
        courseId: null,
        showOnlineIndicator: false,
        testCategory: 0,
        level: 0,
        realmId: 0,
        excludeFromRanks: true,
        challengeStart: null
      },
      levelInfo: null,
      temporals: {
        sale: "",
        simboostsSalePromotion: null,
        contest: null,
        economyState: 1
      },
      cookieConsent: {},
      preferences: {
        theme: 'light'
      },
      encKey: "private-server-local-key",
      courses: []
    };
  }

  const player = db.prepare('SELECT * FROM players WHERE player_id = ?').get(playerId) as PlayerRow | undefined;
  let company: CompanyRow | null = null;

  if (targetCompanyId) {
    company = getCompanyById(targetCompanyId);
  }
  if (!company) {
    company = getCompanyByPlayerId(playerId);
  }

  if (!company || !player) {
    return null;
  }

  const safeMoney = typeof company.money === 'number' ? company.money : Number(company.money || 100000);
  const safeSimBoosts = typeof company.simboosts === 'number' ? company.simboosts : Number(company.simboosts || 250);

  return {
    authUser: {
      id: player.player_id,
      playerId: player.player_id,
      isModerator: Boolean(player.is_admin),
      auditAccess: Boolean(player.is_admin),
      preapprovedToCreateCourses: false,
      newspaperEditor: false,
      isAdmin: Boolean(player.is_admin),
      canImpersonate: false,
      aiSuggestions: false,
      supporterPurchased: false,
      supporter: false,
      countryCodeIso: "AU",
      email: player.email,
      bouncingEmail: false,
      language: player.language || "zh-cn",
      age18: false,
      communicationRestricted: false,
      emailVerificationRequired: false,
      featureFlags: JSON.stringify({ simplifyGameStart: true, newBuildings: true, automaticResolveBusy: true }),
      soundEnabled: false,
      buildingAnimationsEnabled: false,
      autoDisableAnimations: true,
      source: ""
    },
    authCompany: {
      id: company.company_id,
      companyId: company.company_id,
      company: toSafeCompanyName(company.name),
      personalAssistant: company.personal_assistant || "old",
      moderatorSign: Boolean(company.moderator_sign),
      exchangedToday: getExchangedToday(company.company_id),
      simBoosts: safeSimBoosts,
      // P1-02/P0-04: persisted SimBoost settings instead of hardcoded zeros,
      // so a saved realignment or a completed exchange survives a refresh.
      productionModifier: getCompanyBoostSettings(company.company_id).productionModifier,
      salesModifier: getCompanyBoostSettings(company.company_id).salesModifier,
      popupNotifications: {
        help: true,
        sale: true,
        social: true,
        other: true,
        contract: true,
        buyOrderFill: true
      },
      countryCodeIsoUserSet: "",
      rank: 1,
      evaRank: null,
      evaMonth: null,
      extraExecutiveSlots: Number(company.extra_executive_slots) || 0,
      extraBuildingSlots: Number(company.extra_building_slots) || 0,
      displayCaseSlots: Number(company.display_case_slots) || 1,
      logo: company.logo || "",
      startingPackPurchased: false,
      maxTags: Math.max(1, Number(company.max_tags) || 1),
      showOnlineIndicator: company.show_online_indicator === null || company.show_online_indicator === undefined
        ? true
        : Boolean(company.show_online_indicator),
      testCategory: 0,
      level: company.level ?? 0,
      realmId: company.realm_id || 0,
      excludeFromRanks: false,
      challengeStart: null
    },
    levelInfo: computeLevelInfo({
      level: company.level ?? 0,
      experience: company.experience ?? 0,
      rating: company.rating,
      extra_building_slots: company.extra_building_slots
    }),
    temporals: {
      sale: "",
      simboostsSalePromotion: null,
      contest: null,
      economyState: 1
    },
    cookieConsent: {},
    preferences: {
      theme: player.theme || 'light'
    },
    encKey: "private-server-local-key",
    courses: []
  };
}

export function getPlayerCompanies(playerId: number) {
  const companies = db.prepare('SELECT * FROM companies WHERE player_id = ? ORDER BY realm_id ASC, id ASC').all(playerId) as unknown as CompanyRow[];
  if (!companies || companies.length === 0) return [];

  return companies.map(c => ({
    id: c.company_id,
    company: toSafeCompanyName(c.name),
    logo: c.logo || "",
    realmId: c.realm_id || 0,
    deleted: false,
    level: computeLevelInfo({
      level: c.level ?? 0,
      experience: c.experience ?? 0,
      rating: c.rating,
      extra_building_slots: c.extra_building_slots
    }),
    moderatorSign: false,
    showOnlineIndicator: true,
    countryCodeIsoUserSet: "",
    personalAssistant: c.personal_assistant || "old",
    dateReset: c.created_at
  }));
}
