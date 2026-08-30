import { db } from '../db/database.ts';
import { CONFIG } from '../config.ts';

export interface CompanyRow {
  id: number;
  company_id: number;
  player_id: number;
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
  created_at: string;
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
  const comp = getCompanyById(companyId);
  if (!comp) return 0;
  const newMoney = Math.max(0, comp.money + delta);
  db.prepare('UPDATE companies SET money = ? WHERE company_id = ?').run(newMoney, companyId);
  return newMoney;
}

export function createCompanyForPlayer(playerId: number, name: string, realmId: number = 0) {
  const companyId = Math.floor(4000000 + Math.random() * 6000000);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BBB', 20, ?, '', 'old', 'Private Server Company', ?)
  `).run(companyId, playerId, name, CONFIG.INITIAL_MONEY, CONFIG.INITIAL_SIMBOOSTS, CONFIG.INITIAL_LEVEL, realmId, now);

  // Seed default Farm and Grocery store
  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
  `).run(companyId, now);

  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '1', 'G', 1, 'Grocery store', 10350, 'sales', ?)
  `).run(companyId, now);

  // Seed warehouse goods
  const seedStock = [
    { kind: 1, amount: 10000 },
    { kind: 2, amount: 10000 },
    { kind: 66, amount: 5000 },
    { kind: 13, amount: 10000 },
    { kind: 3, amount: 2000 },
  ];

  for (const s of seedStock) {
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, ?, 0, ?, 0, 0, 0, 0, 1.0, ?)
    `).run(companyId, s.kind, s.amount, now);
  }

  return getCompanyById(companyId);
}

export function resetCompany(companyId: number) {
  const comp = getCompanyById(companyId);
  if (!comp) return;

  // Clear buildings and queues
  db.prepare('DELETE FROM buildings WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM production_queues WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM warehouse WHERE company_id = ?').run(companyId);

  const now = new Date().toISOString();
  // Reset company stats
  db.prepare(`
    UPDATE companies
    SET money = ?, level = 1, experience = 0, created_at = ?
    WHERE company_id = ?
  `).run(CONFIG.INITIAL_MONEY, now, companyId);

  // Seed fresh farm
  db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, '0', 'P', 1, 'Farm', 6900, 'production', ?)
  `).run(companyId, now);
}

export function updatePlayerPreferences(playerId: number, prefs: { theme?: string; language?: string }) {
  if (prefs.theme) {
    db.prepare('UPDATE players SET theme = ? WHERE player_id = ?').run(prefs.theme, playerId);
  }
  if (prefs.language) {
    db.prepare('UPDATE players SET language = ? WHERE player_id = ?').run(prefs.language, playerId);
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
      money: c.money,
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
      company: company.name,
      personalAssistant: company.personal_assistant || "old",
      moderatorSign: false,
      hqImage: "",
      money: company.money,
      exchangedToday: 0,
      simBoosts: company.simboosts,
      popupNotifications: {
        help: true,
        sale: true,
        social: true,
        other: true,
        contract: true,
        buyOrderFill: true
      },
      productionModifier: 0,
      salesModifier: 0,
      countryCodeIsoUserSet: "",
      rank: 1,
      evaRank: null,
      evaMonth: null,
      extraExecutiveSlots: 0,
      extraBuildingSlots: 0,
      displayCaseSlots: 1,
      logo: company.logo || "",
      startingPackPurchased: false,
      maxTags: 1,
      courseId: null,
      showOnlineIndicator: true,
      testCategory: 0,
      level: company.level,
      realmId: company.realm_id,
      excludeFromRanks: false,
      challengeStart: null
    },
    levelInfo: {
      levelName: "Family business",
      ratingCode: company.rating || "BBB",
      level: company.level,
      inTutorial: false,
      experience: company.experience,
      experienceToNextLevel: 80,
      maxBuildings: 10,
      capabilities: {
        contracts: true,
        research: true,
        scrape: true,
        bonds: true,
        governmentOrders: true,
        executives: true,
        hqUpdates: true,
        paUpdates: true,
        buildingAuctions: true,
        seasonal: true,
        buyOrders: true
      },
      timeLimit: 86400,
      acceleration: {
        multiplier: 1,
        until: null
      }
    },
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
    company: c.name,
    logo: c.logo || "",
    realmId: c.realm_id,
    deleted: false,
    level: {
      levelName: "Family business",
      ratingCode: c.rating,
      level: c.level,
      inTutorial: false,
      experience: c.experience,
      experienceToNextLevel: 80,
      maxBuildings: 10,
      capabilities: {
        contracts: true,
        research: true,
        scrape: true,
        bonds: true,
        governmentOrders: true,
        executives: true,
        hqUpdates: true,
        paUpdates: true,
        buildingAuctions: true,
        seasonal: true,
        buyOrders: true
      },
      timeLimit: 86400,
      acceleration: { multiplier: 1, until: null }
    },
    moderatorSign: false,
    showOnlineIndicator: true,
    countryCodeIsoUserSet: "",
    personalAssistant: c.personal_assistant || "old",
    dateReset: c.created_at
  }));
}
