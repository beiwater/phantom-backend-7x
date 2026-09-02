import { db, seedDefaultDisplayCase } from '../db/database.ts';
import { CONFIG } from '../config.ts';
import { computeLevelInfo, getXpRequiredForLevel } from '../domain/leveling/level-rules.ts';
import { seedDefaultExecutives } from './executives.ts';
import { getCompanyBoostSettings, getExchangedToday } from './simboost-settings.ts';
import { recordCashLedger, refreshDailyFinanceSnapshot } from './cash-ledger.ts';
import { runInTransaction } from '../db/transaction.ts';

export interface CompanyRow {
  id: number;
  company_id: number;
  player_id?: number;
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
  supporter_until?: string | null;
  supporter_certificates?: number;
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

export function updateCompanyMoney(companyId: number, delta: number, skipLedger: boolean = false): number {
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
  if (!skipLedger) {
    recordCashLedger({ companyId, amount: delta, category: 'g', description: 'Company money change', descriptionKey: '' });
  }
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

  const before = Number(comp.level || 0);
  db.prepare('UPDATE companies SET level = ?, experience = ? WHERE company_id = ?').run(level, experience, companyId);
  if (level > before) {
    void payoutReferralLevelRewards(companyId, before, level);
  }
  return { level, experience };
}

/**
 * Referral tier rewards (data/referral.json): the referrer earns SimBoosts
 * when a referred company reaches level 5/10/15. Imported lazily to avoid a
 * module cycle; failures never break the level-up path.
 */
function payoutReferralLevelRewards(companyId: number, oldLevel: number, newLevel: number): void {
  Promise.all([
    import('../repositories/referrals-repository.ts'),
    import('../repositories/company-repository.ts')
  ]).then(([{ referralsRepository, REFERRAL_LEVEL_TIERS }, { companyRepository }]) => {
    const referrerCompanyId = referralsRepository.findReferrerOf(companyId);
    if (!referrerCompanyId) return;
    const company = getCompanyById(referrerCompanyId);
    if (!company) return;
    for (const tier of REFERRAL_LEVEL_TIERS) {
      if (newLevel >= tier.level && oldLevel < tier.level) {
        const rewarded = referralsRepository.markTierPaidAndReward(referrerCompanyId, tier.level, tier.reward);
        if (rewarded) {
          companyRepository.creditSimboosts(referrerCompanyId, tier.reward);
        }
      }
    }
  }).catch(err => console.error('[referral] tier reward failed:', err));
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

// ============================================================================
// Issue #97: supporter package state (decompiled Supporters guide)
// ============================================================================

/**
 * Supporters pay 10% less for SimBoost packages (payment_packages.json
 * supporterDiscount.percentage = 10; Checkout.supporterDiscountApplied:
 * "All prices listed already reflect your 10% supporter discount.").
 */
export const SUPPORTER_DISCOUNT_PERCENT = 10;

/** Each supporter package purchase buys a 30-day supporter term. */
export const SUPPORTER_DURATION_DAYS = 30;

export interface SupporterState {
  /** True once the company has ever purchased the supporter package. */
  supporterPurchased: boolean;
  /** True while the purchased term has not expired yet. */
  supporterActive: boolean;
  /** ISO UTC datetime the term ends, null when never purchased. */
  supporterUntil: string | null;
  /** Supporter certificates awarded by supporter package purchases. */
  certificates: number;
}

function parseSupporterUntil(raw: unknown): { iso: string | null; ms: number } {
  if (typeof raw !== 'string' || raw === '') return { iso: null, ms: NaN };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { iso: null, ms: NaN };
  return { iso: new Date(ms).toISOString(), ms };
}

/**
 * Reads the persisted supporter state off a companies row. Expiry is
 * evaluated against `now`: an expired term keeps supporterPurchased (the
 * certificate was earned) but drops supporterActive, which degrades every
 * perk — the +1 building slot, the 10% discount and the package visibility —
 * until the supporter package is purchased again.
 */
export function getSupporterState(
  company: CompanyRow | null | undefined,
  now: number = Date.now()
): SupporterState {
  const certificates = Math.max(0, Math.floor(Number(company?.supporter_certificates) || 0));
  const until = parseSupporterUntil(company?.supporter_until);
  return {
    supporterPurchased: certificates > 0 || until.iso !== null,
    supporterActive: until.iso !== null && until.ms > now,
    supporterUntil: until.iso,
    certificates
  };
}

/**
 * Persists a completed supporter package purchase: starts or extends the
 * supporter term by SUPPORTER_DURATION_DAYS and awards one supporter
 * certificate ("Awarded to companies for supporting the game by purchasing
 * the supporter package"). Renewals stack on an unexpired term so buying
 * early never loses days; after expiry the term restarts from `now`.
 */
export async function activateSupporter(companyId: number, now: number = Date.now()): Promise<SupporterState> {
  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp) {
      throw new Error('Company not found');
    }
    const current = getSupporterState(comp, now);
    const baseMs = current.supporterActive && current.supporterUntil ? Date.parse(current.supporterUntil) : now;
    const supporterUntil = new Date(baseMs + SUPPORTER_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const certificates = current.certificates + 1;
    const result = db.prepare(
      'UPDATE companies SET supporter_until = ?, supporter_certificates = ? WHERE company_id = ?'
    ).run(supporterUntil, certificates, companyId);
    if (result.changes !== 1) {
      throw new Error('Company not found');
    }
    return {
      supporterPurchased: true,
      supporterActive: true, // a fresh 30-day term always ends in the future
      supporterUntil,
      certificates
    };
  }, { immediate: true });
}

/**
 * Supporters pay 10% less for SimBoost packages. Prices are USD strings;
 * rounding in integer cents keeps the result deterministic (10.45 -> 1045c
 * -> 941c -> "9.41", immune to float drift).
 */
export function applySupporterDiscount(price: string, discountPercent: number = SUPPORTER_DISCOUNT_PERCENT): string {
  const cents = Math.round(Number.parseFloat(price) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return price;
  return (Math.round(cents * (100 - discountPercent) / 100) / 100).toFixed(2);
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
      // Issue #119: the SPA dereferences levelInfo.acceleration unguarded on
      // public market pages, so anonymous visitors must still receive a
      // well-formed guest levelInfo (level 0, no capabilities) instead of null.
      levelInfo: computeLevelInfo({ level: 0, experience: 0, rating: "BBB" }),
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

  // C-18: non-finite values serialize as JSON null (JSON.stringify(Infinity)
  // -> "null"); the payload must always carry a numeric balance.
  const safeMoney = typeof company.money === 'number'
    ? (Number.isFinite(company.money) ? company.money : 0)
    : Number(company.money || 100000);
  const safeSimBoosts = typeof company.simboosts === 'number'
    ? (Number.isFinite(company.simboosts) ? company.simboosts : 0)
    : Number(company.simboosts || 250);
  // Issue #97: supporter status comes from persisted purchases, never from
  // the admin flag (the old conflation made it impossible for normal
  // players to become supporters). The supporter perk adds +1 extra
  // building slot while the term is active — mirrored into the maxBuildings
  // computation of levelInfo below.
  const supporter = getSupporterState(company);
  const extraBuildingSlots = (Number(company.extra_building_slots) || 0) + (supporter.supporterActive ? 1 : 0);

  return {
    authUser: {
      id: player.player_id,
      playerId: player.player_id,
      isModerator: Boolean(player.is_admin),
      auditAccess: Boolean(player.is_admin),
      preapprovedToCreateCourses: Boolean(player.is_admin),
      newspaperEditor: Boolean(player.is_admin),
      isAdmin: Boolean(player.is_admin),
      canImpersonate: Boolean(player.is_admin),
      aiSuggestions: Boolean(player.is_admin),
      supporterPurchased: supporter.supporterPurchased,
      supporter: supporter.supporterActive,
      countryCodeIso: "AU",
      email: player.email,
      bouncingEmail: false,
      language: player.language || "zh-cn",
      age18: false,
      communicationRestricted: false,
      emailVerificationRequired: false,
      featureFlags: JSON.stringify({ simplifyGameStart: true, newBuildings: true, automaticResolveBusy: true, tutorialFinished: true, skipTutorial: true }),
      soundEnabled: false,
      buildingAnimationsEnabled: false,
      autoDisableAnimations: true,
      source: ""
    },
    authCompany: {
      id: company.company_id,
      companyId: company.company_id,
      money: safeMoney,
      hqImage: "",
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
      extraBuildingSlots,
      displayCaseSlots: Number(company.display_case_slots) || 1,
      logo: company.logo || "",
      startingPackPurchased: true,
      maxTags: Math.max(1, Number(company.max_tags) || 1),
      showOnlineIndicator: company.show_online_indicator === null || company.show_online_indicator === undefined
        ? true
        : Boolean(company.show_online_indicator),
      testCategory: 0,
      level: Math.max(1, Number(company.level) || 1),
      realmId: company.realm_id || 0,
      excludeFromRanks: false,
      challengeStart: null
    },
    levelInfo: computeLevelInfo({
      level: Math.max(1, Number(company.level) || 1),
      experience: company.experience ?? 0,
      rating: company.rating,
      extra_building_slots: extraBuildingSlots
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
