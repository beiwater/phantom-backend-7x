/**
 * Realm Phase Progression Service
 *
 * Implements the official Sim Companies Realm Phase Progression system documented in:
 * http://127.0.0.1:3100/zh-cn/pages/realms-guide/
 *
 * Presets:
 * - Phase 1 (第一阶段 - 农业): Agriculture, basic utilities, Q0 research, no bonds/GO
 * - Phase 2 (第二阶段 - 时尚与研究): Fashion, oil, refineries, laboratories, Q2 research
 * - Phase 3 (第三阶段 - 能源、债券和政府订单): Shipping, beverage, quarry, concrete, food processing, bonds, GO, Q4 research
 * - Full (全部解锁): All industries, automotive, robotics, aerospace, restaurants, Q12 research
 *
 * All presets support fine-grained custom parameter overrides.
 */
import type { DatabaseSync } from 'node:sqlite';
import { db } from '../db/database.ts';
import { CONFIG } from '../config.ts';
import { CONSTANTS_BUILDINGS, CONSTANTS_RESOURCES, type BuildingDef, type ResourceDef } from '../game/constants.ts';
import { logger } from '../core/logger.ts';

// Persisted realm phase state
db.exec(`
  CREATE TABLE IF NOT EXISTS realm_phase_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preset TEXT NOT NULL DEFAULT 'full',
    phase INTEGER NOT NULL DEFAULT 8,
    research_limit INTEGER NOT NULL DEFAULT 12,
    bonds_enabled INTEGER NOT NULL DEFAULT 1,
    gov_orders_enabled INTEGER NOT NULL DEFAULT 1,
    executives_enabled INTEGER NOT NULL DEFAULT 1,
    rec_buildings_enabled INTEGER NOT NULL DEFAULT 1,
    collectibles_enabled INTEGER NOT NULL DEFAULT 1,
    robots_enabled INTEGER NOT NULL DEFAULT 1,
    purchases_enabled INTEGER NOT NULL DEFAULT 1,
    simboosts_exchange_limit INTEGER NOT NULL DEFAULT 10000,
    retail_modeling INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  );
`);

export interface RealmPhaseConfig {
  preset: string;
  name: string;
  phase: number;
  researchLimit: number;
  bonds: boolean;
  govOrders: boolean;
  executives: boolean;
  recBuildings: boolean;
  collectibles: boolean;
  robots: boolean;
  purchases: boolean;
  resourceProductionModifiers: boolean;
  buildingAuctions: boolean;
  simboostsExchangeLimit: number;
  bondsMaxInterest: number;
  bondsMinInterest: number;
  exchangeFee: number;
  retailModeling: number;
  description: string;
}

export const REALM_PHASE_PRESETS: Record<string, Omit<RealmPhaseConfig, 'preset'>> = {
  phase_1: {
    name: '第一阶段 - 农业 (Phase 1: Agriculture)',
    phase: 0,
    researchLimit: 0,
    bonds: false,
    govOrders: false,
    executives: false,
    recBuildings: false,
    collectibles: false,
    robots: false,
    purchases: true,
    resourceProductionModifiers: false,
    buildingAuctions: false,
    simboostsExchangeLimit: 2000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '可用的建筑和资源：种植园、水库、发电厂、生鲜商店、农场、五金商店、屠宰场、磨坊等基础农业与生活品；研究上限为Q0品质。'
  },
  phase_2: {
    name: '第二阶段 - 时尚与研究 (Phase 2: Fashion & Research)',
    phase: 1,
    researchLimit: 2,
    bonds: false,
    govOrders: false,
    executives: false,
    recBuildings: false,
    collectibles: false,
    robots: false,
    purchases: true,
    resourceProductionModifiers: false,
    buildingAuctions: false,
    simboostsExchangeLimit: 4000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '增加油井、炼油厂、时装工厂、时装商店与科研实验室（作物、物理、畜牧、化学、时装、菜谱研究）；研究上限提升至Q2品质。'
  },
  phase_3: {
    name: '第三阶段 - 能源、债券和政府订单 (Phase 3: Energy, Bonds & Government Orders)',
    phase: 2,
    researchLimit: 4,
    bonds: true,
    govOrders: true,
    executives: false,
    recBuildings: false,
    collectibles: false,
    robots: false,
    purchases: true,
    resourceProductionModifiers: false,
    buildingAuctions: false,
    simboostsExchangeLimit: 6000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '增加货运站、加油站、饮料工厂、采石场、混凝土厂、食品加工厂；正式启用公司债券与政府订单，运输单位可由公司生产；研究上限提升至Q4品质。'
  },
  phase_4: {
    name: '第四阶段 - 采矿和电子 (Phase 4: Mining & Electronics)',
    phase: 3,
    researchLimit: 6,
    bonds: true,
    govOrders: true,
    executives: false,
    recBuildings: false,
    collectibles: false,
    robots: false,
    purchases: true,
    resourceProductionModifiers: true,
    buildingAuctions: false,
    simboostsExchangeLimit: 8000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '增加矿井、建材厂、材料加工厂、电子产品厂、电子商店、软件研发院；研究上限提升至Q6品质。'
  },
  phase_5: {
    name: '第五阶段 - 奢侈时尚 (Phase 5: Luxury Fashion)',
    phase: 4,
    researchLimit: 8,
    bonds: true,
    govOrders: true,
    executives: false,
    recBuildings: false,
    collectibles: false,
    robots: false,
    purchases: true,
    resourceProductionModifiers: true,
    buildingAuctions: false,
    simboostsExchangeLimit: 10000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '新增总承包商建筑，推出金矿、金条、玻璃、珠宝与奢侈时尚；研究上限提升至Q8品质。'
  },
  phase_6: {
    name: '第6阶段 - 休闲建筑与银行业务 (Phase 6: Recreation & Banking)',
    phase: 5,
    researchLimit: 10,
    bonds: true,
    govOrders: true,
    executives: true,
    recBuildings: true,
    collectibles: false,
    robots: false,
    purchases: true,
    resourceProductionModifiers: true,
    buildingAuctions: false,
    simboostsExchangeLimit: 10000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '新增城堡、公园、湖泊、银行与高管培训学院，正式启用高管系统与休闲建筑开销减免；研究上限提升至Q10品质。'
  },
  phase_7: {
    name: '第七阶段 - 汽车、机器人和收藏品 (Phase 7: Automotive & Robotics)',
    phase: 6,
    researchLimit: 12,
    bonds: true,
    govOrders: true,
    executives: true,
    recBuildings: true,
    collectibles: true,
    robots: true,
    purchases: true,
    resourceProductionModifiers: true,
    buildingAuctions: true,
    simboostsExchangeLimit: 10000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '新增汽车厂、车行、赛车场与推进器工厂，公司可生产机器人与全品类汽车；启用展示柜收藏品；研究上限达到Q12。'
  },
  phase_8: {
    name: '第8阶段 - 航空航天 (Phase 8: Aerospace)',
    phase: 7,
    researchLimit: 12,
    bonds: true,
    govOrders: true,
    executives: true,
    recBuildings: true,
    collectibles: true,
    robots: true,
    purchases: true,
    resourceProductionModifiers: true,
    buildingAuctions: true,
    simboostsExchangeLimit: 10000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '新增发射台、航天电子厂、航天厂、垂直/水平整合设施、机库与销售办公室；解锁火箭、航天器材与商业客机。'
  },
  full: {
    name: '全功能解锁 (Full Unlocked / Phase 8)',
    phase: 8,
    researchLimit: 12,
    bonds: true,
    govOrders: true,
    executives: true,
    recBuildings: true,
    collectibles: true,
    robots: true,
    purchases: true,
    resourceProductionModifiers: true,
    buildingAuctions: true,
    simboostsExchangeLimit: 10000,
    bondsMaxInterest: 2,
    bondsMinInterest: 0.5,
    exchangeFee: 0.04,
    retailModeling: 0,
    description: '解锁包括烘焙厂、中央厨房、餐馆在内的所有9个时代完整建筑与全部经济模块。'
  }
};

// Aliases for user convenience
export const PRESET_ALIASES: Record<string, string> = {
  '0': 'phase_1',
  '1': 'phase_1',
  'phase0': 'phase_1',
  'phase1': 'phase_1',
  'agriculture': 'phase_1',
  'start': 'phase_1',
  '2': 'phase_2',
  'phase2': 'phase_2',
  'fashion': 'phase_2',
  'research': 'phase_2',
  '3': 'phase_3',
  'phase3': 'phase_3',
  'energy_bonds_go': 'phase_3',
  'bonds': 'phase_3',
  'energy': 'phase_3',
  '4': 'phase_4',
  'phase4': 'phase_4',
  'electronics': 'phase_4',
  'mining': 'phase_4',
  '5': 'phase_5',
  'phase5': 'phase_5',
  'car_parts': 'phase_5',
  'contractor': 'phase_5',
  'luxury': 'phase_5',
  '6': 'phase_6',
  'phase6': 'phase_6',
  'executives': 'phase_6',
  'recreation': 'phase_6',
  'banking': 'phase_6',
  '7': 'phase_7',
  'phase7': 'phase_7',
  'automotive': 'phase_7',
  'robotics': 'phase_7',
  'robots': 'phase_7',
  'collectibles': 'phase_7',
  '8': 'phase_8',
  'phase8': 'phase_8',
  'aerospace': 'phase_8',
  'space': 'phase_8',
  'rockets': 'phase_8',
  '9': 'full',
  'phase9': 'full',
  'restaurants': 'full',
  'restaurant': 'full',
  'bakery': 'full',
  'catering': 'full',
  'all': 'full',
  'unlocked': 'full',
  'default': 'full'
};

export class RealmPhaseService {

  /**
   * Normalize preset name with alias support.
   */
  static normalizePresetName(key: string): string {
    const clean = key.toLowerCase().trim();
    if (REALM_PHASE_PRESETS[clean]) return clean;
    if (PRESET_ALIASES[clean]) return PRESET_ALIASES[clean];
    return 'full';
  }

  private static cachedConfig: RealmPhaseConfig | null = null;
  private static runtimePreset: string | null = null;
  static getActiveRealmConfig(database: DatabaseSync = db): RealmPhaseConfig {
    if (this.cachedConfig) return this.cachedConfig;

    // Read the persisted selection so it can be used when no higher-priority
    // runtime or explicit environment preset is configured.
    const dbRow = database.prepare(`
      SELECT * FROM realm_phase_settings WHERE id = 1
    `).get() as {
      preset: string;
      phase: number;
      research_limit: number;
      bonds_enabled: number;
      gov_orders_enabled: number;
      executives_enabled: number;
      rec_buildings_enabled: number;
      collectibles_enabled: number;
      robots_enabled: number;
      purchases_enabled: number;
      simboosts_exchange_limit: number;
      retail_modeling: number;
    } | undefined;

    // Runtime debug updates take precedence for this process. An explicit
    // REALM_PHASE_PRESET env value is the startup pin, followed by the
    // persisted debug selection and finally the full-unlocked default.
    const configuredPreset = CONFIG.REALM_PHASE_PRESET?.trim();
    const activePresetKey = this.runtimePreset
      || (configuredPreset ? this.normalizePresetName(configuredPreset) : undefined)
      || (dbRow?.preset ? this.normalizePresetName(dbRow.preset) : 'full');
    const basePreset = REALM_PHASE_PRESETS[activePresetKey] || REALM_PHASE_PRESETS.full;
    // Apply field overrides: explicit env fields > persisted values for the
    // selected preset > preset defaults.
    const isDbMatchingPreset = Boolean(dbRow && this.normalizePresetName(dbRow.preset) === activePresetKey);
    const phase = CONFIG.REALM_PHASE !== undefined
      ? Number(CONFIG.REALM_PHASE)
      : (isDbMatchingPreset && dbRow ? dbRow.phase : basePreset.phase);

    const researchLimit = CONFIG.REALM_RESEARCH_LIMIT !== undefined
      ? Number(CONFIG.REALM_RESEARCH_LIMIT)
      : (isDbMatchingPreset && dbRow ? dbRow.research_limit : basePreset.researchLimit);

    const bonds = CONFIG.REALM_BONDS_ENABLED !== undefined
      ? CONFIG.REALM_BONDS_ENABLED
      : (isDbMatchingPreset && dbRow ? Boolean(dbRow.bonds_enabled) : basePreset.bonds);

    const govOrders = CONFIG.REALM_GOV_ORDERS_ENABLED !== undefined
      ? CONFIG.REALM_GOV_ORDERS_ENABLED
      : (isDbMatchingPreset && dbRow ? Boolean(dbRow.gov_orders_enabled) : basePreset.govOrders);

    const executives = CONFIG.REALM_EXECUTIVES_ENABLED !== undefined
      ? CONFIG.REALM_EXECUTIVES_ENABLED
      : (isDbMatchingPreset && dbRow ? Boolean(dbRow.executives_enabled) : basePreset.executives);

    const recBuildings = CONFIG.REALM_REC_BUILDINGS_ENABLED !== undefined
      ? CONFIG.REALM_REC_BUILDINGS_ENABLED
      : (isDbMatchingPreset && dbRow ? Boolean(dbRow.rec_buildings_enabled) : basePreset.recBuildings);

    const collectibles = CONFIG.REALM_COLLECTIBLES_ENABLED !== undefined
      ? CONFIG.REALM_COLLECTIBLES_ENABLED
      : (isDbMatchingPreset && dbRow ? Boolean(dbRow.collectibles_enabled) : basePreset.collectibles);

    const robots = CONFIG.REALM_ROBOTS_ENABLED !== undefined
      ? CONFIG.REALM_ROBOTS_ENABLED
      : (isDbMatchingPreset && dbRow ? Boolean(dbRow.robots_enabled) : basePreset.robots);

    const config: RealmPhaseConfig = {
      preset: activePresetKey,
      name: basePreset.name,
      phase,
      researchLimit,
      bonds,
      govOrders,
      executives,
      recBuildings,
      collectibles,
      robots,
      purchases: basePreset.purchases,
      resourceProductionModifiers: basePreset.resourceProductionModifiers,
      buildingAuctions: basePreset.buildingAuctions,
      simboostsExchangeLimit: basePreset.simboostsExchangeLimit,
      bondsMaxInterest: basePreset.bondsMaxInterest,
      bondsMinInterest: basePreset.bondsMinInterest,
      exchangeFee: basePreset.exchangeFee,
      retailModeling: basePreset.retailModeling,
      description: basePreset.description
    };

    this.cachedConfig = config;
    return config;
  }

  /**
   * Switch active preset, optionally applying custom field overrides.
   */
  static setPreset(
    presetKey: string,
    overrides?: Partial<RealmPhaseConfig>,
    database: DatabaseSync = db
  ): RealmPhaseConfig {
    const normalized = this.normalizePresetName(presetKey);
    const base = REALM_PHASE_PRESETS[normalized] || REALM_PHASE_PRESETS.full;

    const phase = overrides?.phase !== undefined ? overrides.phase : base.phase;
    const researchLimit = overrides?.researchLimit !== undefined ? overrides.researchLimit : base.researchLimit;
    const bonds = overrides?.bonds !== undefined ? overrides.bonds : base.bonds;
    const govOrders = overrides?.govOrders !== undefined ? overrides.govOrders : base.govOrders;
    const executives = overrides?.executives !== undefined ? overrides.executives : base.executives;
    const recBuildings = overrides?.recBuildings !== undefined ? overrides.recBuildings : base.recBuildings;
    const collectibles = overrides?.collectibles !== undefined ? overrides.collectibles : base.collectibles;
    const robots = overrides?.robots !== undefined ? overrides.robots : base.robots;

    const nowIso = new Date().toISOString();
    database.prepare(`
      INSERT INTO realm_phase_settings (
        id, preset, phase, research_limit, bonds_enabled, gov_orders_enabled,
        executives_enabled, rec_buildings_enabled, collectibles_enabled, robots_enabled,
        purchases_enabled, simboosts_exchange_limit, retail_modeling, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 10000, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        preset = excluded.preset,
        phase = excluded.phase,
        research_limit = excluded.research_limit,
        bonds_enabled = excluded.bonds_enabled,
        gov_orders_enabled = excluded.gov_orders_enabled,
        executives_enabled = excluded.executives_enabled,
        rec_buildings_enabled = excluded.rec_buildings_enabled,
        collectibles_enabled = excluded.collectibles_enabled,
        robots_enabled = excluded.robots_enabled,
        updated_at = excluded.updated_at
    `).run(
      normalized, phase, researchLimit,
      bonds ? 1 : 0, govOrders ? 1 : 0, executives ? 1 : 0,
      recBuildings ? 1 : 0, collectibles ? 1 : 0, robots ? 1 : 0,
      nowIso
    );

    this.runtimePreset = normalized;
    this.cachedConfig = null; // bust cache
    const updated = this.getActiveRealmConfig(database);
    logger.info(`[RealmPhase] Active preset set to '${normalized}' (Phase ${phase}, Research Limit Q${researchLimit})`);
    return updated;
  }

  /**
   * Check if a building kind is unlocked in the active realm phase.
   */
  static isBuildingUnlocked(kind: string, database: DatabaseSync = db): boolean {
    const config = this.getActiveRealmConfig(database);
    const def = CONSTANTS_BUILDINGS[kind] as BuildingDef & { sincePhase?: number } | undefined;
    if (!def) return true;
    const sincePhase = Number(def.sincePhase) || 0;
    return sincePhase <= config.phase;
  }

  /**
   * Check if a resource kind is unlocked in the active realm phase.
   */
  static isResourceUnlocked(kind: number, database: DatabaseSync = db): boolean {
    const config = this.getActiveRealmConfig(database);
    const def = CONSTANTS_RESOURCES[String(kind)] as ResourceDef & { sincePhase?: number } | undefined;
    if (!def) return true;
    const sincePhase = Number(def.sincePhase) || 0;
    return sincePhase <= config.phase;
  }

  /**
   * Get list of currently unlocked buildings.
   */
  static getUnlockedBuildings(database: DatabaseSync = db): Array<{
    dbLetter: string;
    name: string;
    sincePhase: number;
    category: string;
  }> {
    const config = this.getActiveRealmConfig(database);
    return Object.entries(CONSTANTS_BUILDINGS)
      .map(([k, def]) => ({
        dbLetter: k,
        name: def.name || `Building ${k}`,
        sincePhase: Number((def as BuildingDef & { sincePhase?: number }).sincePhase) || 0,
        category: def.category
      }))
      .filter(b => b.sincePhase <= config.phase)
      .sort((a, b) => a.sincePhase - b.sincePhase);
  }

  /**
   * Get list of currently unlocked resources.
   */
  static getUnlockedResources(database: DatabaseSync = db): Array<{
    dbLetter: number;
    sincePhase: number;
  }> {
    const config = this.getActiveRealmConfig(database);
    return Object.entries(CONSTANTS_RESOURCES)
      .map(([k, def]) => ({
        dbLetter: Number(k),
        sincePhase: Number((def as ResourceDef & { sincePhase?: number }).sincePhase) || 0
      }))
      .filter(r => r.sincePhase <= config.phase)
      .sort((a, b) => a.sincePhase - b.sincePhase);
  }

  /**
   * Generate the JavaScript string representing `Px` for frontend bundle injection.
   */
  static generateFrontendPxScript(database: DatabaseSync = db): string {
    const config = this.getActiveRealmConfig(database);

    const realm0 = {
      idx: 0,
      textId: 'magnates',
      name: 'Magnates',
      logo: 'images/realms/Magnates_140.png',
      retailModeling: config.retailModeling,
      phase: config.phase,
      researchLimit: config.researchLimit,
      bonds: config.bonds,
      govOrders: config.govOrders,
      executives: config.executives,
      recBuildings: config.recBuildings,
      collectibles: config.collectibles,
      robots: config.robots,
      purchases: config.purchases,
      simboostsExchangeLimit: config.simboostsExchangeLimit,
      resourceProductionModifiers: config.resourceProductionModifiers,
      buildingAuctions: config.buildingAuctions,
      bondsMaxInterest: config.bondsMaxInterest,
      bondsMinInterest: config.bondsMinInterest,
      exchangeFee: config.exchangeFee,
      challenge: false
    };

    const realm1 = {
      ...realm0,
      idx: 1,
      textId: 'entrepreneurs',
      name: 'Entrepreneurs',
      logo: 'images/realms/Entrepeneurs_140.png',
      retailModeling: 1
    };

    const realm2 = {
      ...realm0,
      idx: 2,
      textId: 'challenge',
      name: 'Challenge',
      logo: 'images/realms/Challenge_140.png',
      retailModeling: 0,
      challenge: true
    };

    return `Px={0:${JSON.stringify(realm0)},1:${JSON.stringify(realm1)},2:${JSON.stringify(realm2)}}`;
  }
}
