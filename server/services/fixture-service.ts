/**
 * Test State Generator & Fixture Service.
 *
 * Authoritatively creates or mutates game states for local testing,
 * E2E test runs, and boundary state verification.
 */
import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { hashPassword } from '../db/migrations/index.ts';
import { createSession } from '../auth/session.ts';
import { normalizePositionCode } from '../domain/executives.ts';
import { getBuildingMeta } from '../game-data/buildings.ts';
import { CONFIG } from '../config.ts';
import {
  calculateConstructionDurationSeconds,
  formatDurationHuman,
  type ConstructionTimeMode
} from '../domain/buildings/building-rules.ts';
import {
  getConfiguredChatrooms,
  setConfiguredChatrooms,
  type ChatroomSubscriptionEntry
} from '../routes/social-routes.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import {
  setEconomyPhase,
  rollEconomyPhase,
  getEconomyPhase,
  type EconomyPhaseStatus
} from '../application/scheduler/daily-jobs.ts';
export interface ScenarioBuildingInput {
  kind: string; // 'P', 'r', 'G', 'F', 'B', etc.
  size: number;
  slot?: number;
  abundance?: number;
  isLuxury?: boolean;
  upkeep?: boolean;
}

export interface ScenarioWarehouseInput {
  kind: number;
  quality: number;
  amount: number;
}

export interface ScenarioExecutiveInput {
  name: string;
  position: string; // 'coo', 'cfo', 'cmo', 'cto', 'o', 'f', 'm', 't', 'none'
  skills: {
    management?: number;
    accounting?: number;
    science?: number;
    communication?: number;
    coo?: number;
    cfo?: number;
    cto?: number;
    cmo?: number;
  };
  salary?: number;
}

export interface ScenarioInput {
  email?: string;
  password?: string;
  companyName?: string;
  money?: number;
  simboosts?: number;
  level?: number;
  experience?: number;
  rating?: string;
  realmId?: number;
  extraBuildingSlots?: number;
  buildings?: ScenarioBuildingInput[];
  warehouse?: ScenarioWarehouseInput[];
  executives?: ScenarioExecutiveInput[];
  clearExistingBuildings?: boolean;
  clearExistingWarehouse?: boolean;
  clearExistingExecutives?: boolean;
}

export interface FixtureResult {
  playerId: number;
  companyId: number;
  email: string;
  companyName: string;
  money: number;
  simboosts: number;
  level: number;
  sessionToken: string;
  buildingsCount: number;
  warehouseRows: number;
  executivesCount: number;
}

interface IdRow {
  player_id: number;
  company_id: number;
  email: string;
}

interface MaxRow {
  m: number;
}

export class FixtureService {
  /**
   * Built-in scenario presets for common testing requirements.
   */
  static readonly PRESETS: Record<string, ScenarioInput> = {
    'level-60-max': {
      email: 'qa60_max@test.local',
      companyName: 'Level 60 MegaCorp',
      money: 100000000,
      simboosts: 50000,
      level: 60,
      rating: 'AAA',
      extraBuildingSlots: 40,
      buildings: [
        { kind: 'P', size: 10, slot: 0 },
        { kind: 'r', size: 5, slot: 1, isLuxury: true },
        { kind: 'G', size: 15, slot: 2, abundance: 100 },
        { kind: 'E', size: 10, slot: 3 },
        { kind: 'C', size: 10, slot: 4 }
      ],
      warehouse: [
        { kind: 1, quality: 3, amount: 100000 },
        { kind: 2, quality: 3, amount: 50000 },
        { kind: 3, quality: 2, amount: 20000 },
        { kind: 117, quality: 5, amount: 5000 }
      ],
      executives: [
        { name: 'Sarah COO', position: 'coo', skills: { management: 25, accounting: 10, science: 5, communication: 8 }, salary: 500 },
        { name: 'David CFO', position: 'cfo', skills: { management: 5, accounting: 28, science: 4, communication: 6 }, salary: 550 },
        { name: 'Elena CMO', position: 'cmo', skills: { management: 8, accounting: 6, science: 4, communication: 26 }, salary: 520 },
        { name: 'Marcus CTO', position: 'cto', skills: { management: 6, accounting: 4, science: 27, communication: 5 }, salary: 540 }
      ]
    },

    'fresh-account': {
      email: 'qa_fresh@test.local',
      companyName: 'Fresh Startup Ltd',
      money: 500000,
      simboosts: 200,
      level: 0,
      rating: 'BBB',
      buildings: [
        { kind: 'P', size: 1, slot: 0 }
      ],
      warehouse: [
        { kind: 1, quality: 0, amount: 1000 }
      ]
    },

    'restaurant-tycoon': {
      email: 'qa_restaurant@test.local',
      companyName: 'Michelin Star Dining',
      money: 15000000,
      simboosts: 5000,
      level: 25,
      rating: 'AA',
      buildings: [
        { kind: 'r', size: 5, slot: 0, isLuxury: true },
        { kind: 'r', size: 3, slot: 1, isLuxury: false },
        { kind: 'F', size: 5, slot: 2 }
      ],
      warehouse: [
        { kind: 117, quality: 4, amount: 2000 }, // Samosa
        { kind: 118, quality: 3, amount: 2000 }, // Pasta
        { kind: 119, quality: 4, amount: 2000 }, // Salad
        { kind: 121, quality: 3, amount: 3000 }, // Steak
        { kind: 122, quality: 5, amount: 1500 }, // Cocktail
        { kind: 123, quality: 4, amount: 2500 }  // Cake
      ],
      executives: [
        { name: 'Chef Gordon COO', position: 'coo', skills: { management: 20, communication: 15 } },
        { name: 'Maitre CMO', position: 'cmo', skills: { communication: 24 } }
      ]
    },

    'aerospace-corp': {
      email: 'qa_aero@test.local',
      companyName: 'Orbital Dynamics',
      money: 30000000,
      simboosts: 10000,
      level: 35,
      rating: 'AAA',
      buildings: [
        { kind: 'H', size: 10, slot: 0 },
        { kind: 'A', size: 8, slot: 1 },
        { kind: 'Y', size: 6, slot: 2 }
      ],
      warehouse: [
        { kind: 101, quality: 3, amount: 500 }, // Sub-orbital rocket
        { kind: 102, quality: 2, amount: 300 }, // Sub-orbital 2nd stage
        { kind: 105, quality: 3, amount: 100 }, // Jumbo Jet
        { kind: 106, quality: 4, amount: 50 }   // Luxury Jet
      ]
    }
  };

  /**
   * Applies a complete scenario: creates or updates player, company, buildings, warehouse, executives.
   */
  static async applyScenario(input: ScenarioInput): Promise<FixtureResult> {
    const email = input.email || `qa_scenario_${Date.now()}@test.local`;
    const password = input.password || 'Test12345!';
    const companyName = input.companyName || 'Custom QA Corp';
    const money = input.money ?? 10000000;
    const simboosts = input.simboosts ?? 5000;
    const level = input.level ?? 20;
    const experience = input.experience ?? 0;
    const rating = input.rating || 'AAA';
    const realmId = input.realmId ?? 0;
    const extraSlots = input.extraBuildingSlots ?? 20;
    const nowIso = new Date().toISOString();

    return runInTransaction(async () => {
      // 1. Ensure Player exists
      const playerRow = db.prepare('SELECT player_id, email FROM players WHERE email = ?').get(email) as IdRow | undefined;
      let playerId: number;

      if (playerRow && playerRow.player_id) {
        playerId = playerRow.player_id;
        db.prepare('UPDATE players SET is_admin = 0 WHERE player_id = ?').run(playerId);
      } else {
        const maxPlayerRow = db.prepare('SELECT COALESCE(MAX(player_id), 100000) AS m FROM players').get() as MaxRow | undefined;
        const maxPlayer = maxPlayerRow?.m ?? 100000;
        playerId = maxPlayer + 1;
        db.prepare(
          'INSERT INTO players (player_id, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)'
        ).run(playerId, email, hashPassword(password), nowIso);
      }

      // 2. Ensure Company exists
      const companyRow = db.prepare('SELECT company_id FROM companies WHERE player_id = ?').get(playerId) as IdRow | undefined;
      let companyId: number;

      if (companyRow && companyRow.company_id) {
        companyId = companyRow.company_id;
        db.prepare(`
          UPDATE companies
          SET name = ?, money = ?, simboosts = ?, level = ?, experience = ?, rating = ?, realm_id = ?, extra_building_slots = ?
          WHERE company_id = ?
        `).run(companyName, money, simboosts, level, experience, rating, realmId, extraSlots, companyId);
      } else {
        const maxCompRow = db.prepare('SELECT COALESCE(MAX(company_id), 400000) AS m FROM companies').get() as MaxRow | undefined;
        const maxComp = maxCompRow?.m ?? 400000;
        companyId = maxComp + 1;
        db.prepare(`
          INSERT INTO companies (company_id, player_id, name, money, simboosts, level, experience, rating, realm_id, logo, personal_assistant, note, extra_building_slots, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'old', 'QA Fixture Created', ?, ?)
        `).run(companyId, playerId, companyName, money, simboosts, level, experience, rating, realmId, extraSlots, nowIso);
      }

      // 3. Buildings setup
      if (input.clearExistingBuildings !== false) {
        db.prepare('DELETE FROM buildings WHERE company_id = ?').run(companyId);
        db.prepare('DELETE FROM production_queues WHERE company_id = ?').run(companyId);
        db.prepare('DELETE FROM restaurant_properties WHERE company_id = ?').run(companyId);
        db.prepare('DELETE FROM restaurant_runs WHERE company_id = ?').run(companyId);
      }

      let buildingsCount = 0;
      if (input.buildings && input.buildings.length > 0) {
        for (let i = 0; i < input.buildings.length; i++) {
          const b = input.buildings[i];
          const slot = b.slot ?? i;
          const abundance = b.abundance ?? 100;
          const maxBldgRow = db.prepare('SELECT COALESCE(MAX(id), 1000) AS m FROM buildings').get() as MaxRow | undefined;
          const buildingId = (maxBldgRow?.m ?? 1000) + 1;

          const posName = `slot_${slot}`;
          const buildingMeta = getBuildingMeta(b.kind);
          db.prepare(`
            INSERT INTO buildings (id, company_id, kind, size, position, name, cost, category, abundance, busy_until, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
          `).run(
            buildingId,
            companyId,
            b.kind,
            b.size,
            posName,
            buildingMeta.name,
            buildingMeta.cost,
            buildingMeta.category,
            abundance,
            nowIso
          );
          buildingsCount++;

          // If restaurant, initialize properties
          if (b.kind === 'r') {
            db.prepare(`
              INSERT INTO restaurant_properties (
                building_id, company_id, good_service, is_luxury, keep_open, menu_json, menu_price, rating, occupancy, updated_at
              ) VALUES (?, ?, ?, ?, 1, '[]', 60, 0, 0, ?)
            `).run(buildingId, companyId, b.isLuxury ? 1 : 0, b.isLuxury ? 1 : 0, nowIso);
          }
        }
      }

      // 4. Warehouse setup
      if (input.clearExistingWarehouse !== false) {
        db.prepare('DELETE FROM warehouse WHERE company_id = ?').run(companyId);
      }

      let warehouseRows = 0;
      if (input.warehouse && input.warehouse.length > 0) {
        for (const w of input.warehouse) {
          const existingWarehouse = db.prepare(
            'SELECT id FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ? ORDER BY id LIMIT 1'
          ).get(companyId, w.kind, w.quality) as { id: number } | undefined;
          if (existingWarehouse) {
            db.prepare(
              'UPDATE warehouse SET amount = amount + ?, updated_at = ? WHERE id = ?'
            ).run(w.amount, nowIso, existingWarehouse.id);
          } else {
            db.prepare(`
              INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, updated_at)
              VALUES (?, ?, ?, ?, 1.0, ?)
            `).run(companyId, w.kind, w.quality, w.amount, nowIso);
          }
          warehouseRows++;
        }
      }

      // 5. Executives setup
      if (input.clearExistingExecutives !== false) {
        db.prepare('DELETE FROM executives WHERE company_id = ?').run(companyId);
      }

      let executivesCount = 0;
      if (input.executives && input.executives.length > 0) {
        for (const exec of input.executives) {
          const maxExecRow = db.prepare('SELECT COALESCE(MAX(id), 100) AS m FROM executives').get() as MaxRow | undefined;
          const execId = (maxExecRow?.m ?? 100) + 1;
          const normPos = normalizePositionCode(exec.position);
          const mgmt = exec.skills.management ?? exec.skills.coo ?? 10;
          const acct = exec.skills.accounting ?? exec.skills.cfo ?? 10;
          const sci = exec.skills.science ?? exec.skills.cto ?? 10;
          const comm = exec.skills.communication ?? exec.skills.cmo ?? 10;
          const salary = exec.salary ?? 350;

          db.prepare(`
            INSERT INTO executives (
              id, company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at
            ) VALUES (?, ?, ?, 'images/avatars/male_01.png', ?, ?, ?, ?, ?, ?, 'employed', ?)
          `).run(execId, companyId, exec.name, normPos, mgmt, acct, sci, comm, salary, nowIso);
          executivesCount++;
        }
      }

      // 6. Generate active session token
      const sessionToken = createSession(playerId, companyId);

      return {
        playerId,
        companyId,
        email,
        companyName,
        money,
        simboosts,
        level,
        sessionToken,
        buildingsCount,
        warehouseRows,
        executivesCount
      };
    });
  }

  /**
   * Fast preset applier: loads a named preset and applies it.
   */
  static async applyPreset(presetName: string, overrides?: Partial<ScenarioInput>): Promise<FixtureResult> {
    const preset = FixtureService.PRESETS[presetName];
    if (!preset) {
      throw new Error(`Unknown preset: "${presetName}". Available presets: ${Object.keys(FixtureService.PRESETS).join(', ')}`);
    }
    const combined = { ...preset, ...overrides };
    return FixtureService.applyScenario(combined);
  }

  /**
   * Switch marketplace pricing mode:
   * - 'realistic': Calculates floating NPC prices based on each building's production model,
   *   guaranteeing approximately $300 (or TARGET_BUILDING_PROFIT) profit per building level per hour.
   * - 'test': Seeds market orders with flat $1.00 + Q testing prices.
   */
  static async setMarketPricingMode(
    mode: 'realistic' | 'test',
    database: typeof db = db,
    options?: { targetProfit?: number; volatility?: number; maxQuality?: number }
  ): Promise<{
    mode: string;
    targetProfit: number;
    volatility: number;
    ordersUpdated: number;
    samplePrices: Array<{ resource: string; q0: number; q2: number; estHourlyProfit: number }>;
  }> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { CONFIG } = await import('../config.ts');
    const { CONSTANTS_RESOURCES } = await import('../game/constants.ts');
    const { getPriceTickSize } = await import('../domain/market/market-rules.ts');
    const { NpcMarketService } = await import('./npc-market-service.ts');

    let economyModels: Record<string, any> = {};
    try {
      const modelPath = path.join(CONFIG.CONSTANTS_DIR, '..', 'decompile', 'economy_model.json');
      if (fs.existsSync(modelPath)) {
        economyModels = JSON.parse(fs.readFileSync(modelPath, 'utf-8')).models || {};
      }
    } catch {
      // fallback
    }

    function roundToTick(price: number): number {
      const tick = getPriceTickSize(price);
      return Math.round((Math.round(price / tick) * tick) * 1000) / 1000;
    }

    function deterministicFloat(seed: number): number {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }

    const targetProfit = options?.targetProfit ?? Number(CONFIG.TARGET_BUILDING_PROFIT) ?? 300;
    const volatility = options?.volatility ?? Number(CONFIG.MARKET_PRICE_VOLATILITY) ?? 0.05;
    const maxQuality = options?.maxQuality !== undefined
      ? options.maxQuality
      : (CONFIG.NPC_MARKET_Q0_ONLY ? 0 : Number(CONFIG.NPC_MARKET_MAX_QUALITY));

    const nowIso = new Date().toISOString();
    const samplePrices: Array<{ resource: string; q0: number; q2: number; estHourlyProfit: number }> = [];
    let ordersUpdated = 0;
    return runInTransaction(async () => {
      // 1. Delete previous NPC seeded market orders (seller_id = 999900)
      database.prepare('DELETE FROM market_orders WHERE seller_id = 999900').run();

      // Load latest retail saturations to compute product demand factors
      const saturationRows = database.prepare(`
        SELECT kind, saturation FROM retail_saturation
        WHERE date = (SELECT MAX(date) FROM retail_saturation)
      `).all() as Array<{ kind: number; saturation: number }>;
      const saturationMap = new Map<number, number>();
      for (const row of saturationRows) {
        saturationMap.set(Number(row.kind), Number(row.saturation));
      }

      const insertStmt = database.prepare(`
        INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
        VALUES (999900, ?, ?, ?, ?, 0, ?, 1)
      `);

      for (const [k, def] of Object.entries(CONSTANTS_RESOURCES)) {
        const kind = Number(k);
        if (def.isExchangeTradable === false) continue;

        const model = economyModels[String(kind)]?.state_1 || economyModels[String(kind)]?.state_0;
        const baseCost = Number(model?.modeledProductionCostPerUnit) || Number(def.cost) || 2.0;
        const levelsNeeded = Number(model?.buildingLevelsNeededPerUnitPerHour) || 0;

        // Demand-adjusted pricing:
        // - Baseline saturation ~0.50 yields demand = 1.0 (hourly profit ~ $300)
        // - High saturation (low demand) compresses terminal price & profit (< $300)
        // - Low saturation (high demand) expands price & profit (> $300)
        const rawSat = saturationMap.get(kind);
        const demand = rawSat !== undefined
          ? Math.max(0.4, Math.min(2.0, Math.round((0.5 / Math.max(0.1, rawSat)) * 100) / 100))
          : 1.0;

        const effectiveProfitTarget = targetProfit * demand;
        const unitProfitTarget = levelsNeeded > 0
          ? effectiveProfitTarget * levelsNeeded
          : baseCost * 0.15 * demand;
        const targetQ0BasePrice = baseCost + unitProfitTarget;
        let q0Price = 1.0;
        let q2Price = 1.02;

        for (let q = 0; q <= maxQuality; q++) {
          let unitPrice = 1.0 + q;
          if (mode === 'realistic') {
            // Natural price volatility floating within [-volatility, +volatility]
            const floatDelta = (deterministicFloat(kind * 137 + q * 29 + 17) - 0.5) * 2 * volatility;
            const floatPrice = targetQ0BasePrice * (1 + floatDelta);
            const qualityMultiplier = 1.0 + q * 0.10;
            unitPrice = roundToTick(floatPrice * qualityMultiplier);
            unitPrice = Math.max(getPriceTickSize(unitPrice), unitPrice);
          } else {
            unitPrice = roundToTick(1.0 + q * 0.01);
          }

          if (q === 0) q0Price = unitPrice;
          if (q === 2) q2Price = unitPrice;

          const dynamicQty = NpcMarketService.calculateDynamicBatch(kind, q, database).adjustedBatch;
          insertStmt.run(kind, q, dynamicQty, unitPrice, nowIso);
          ordersUpdated++;
        }
        if (samplePrices.length < 6) {
          const unitsPerHour = levelsNeeded > 0 ? (1 / levelsNeeded) : 100;
          const estHourlyProfit = Math.round(unitsPerHour * (q0Price - baseCost));
          samplePrices.push({
            resource: def.image || `Resource #${kind}`,
            q0: q0Price,
            q2: q2Price,
            estHourlyProfit
          });
        }
      }

      database.prepare(`
        INSERT INTO company_settings (company_id, key, value)
        VALUES (0, 'market_pricing_mode', ?)
        ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value
      `).run(mode);

      return { mode, targetProfit, volatility, ordersUpdated, samplePrices };
    });
  }

  /**
   * Get current market pricing mode based on sample electricity/water prices.
   */
  static getMarketPricingMode(database: typeof db = db): { mode: 'realistic' | 'test' | 'custom'; totalNpcOrders: number } {
    const sample = database.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 1 AND quality = 0').get() as { price: number } | undefined;
    const total = (database.prepare('SELECT COUNT(*) as c FROM market_orders WHERE seller_id = 999900').get() as { c: number })?.c || 0;

    let mode: 'realistic' | 'test' | 'custom' = 'custom';
    if (sample) {
      if (Math.abs(sample.price - 1.0) < 0.001) mode = 'test';
      else if (sample.price < 0.3) mode = 'realistic';
    }
    return { mode, totalNpcOrders: total };
  }

  /**
   * Get active construction time mode ('test' vs 'realistic').
   */
  static getActiveConstructionTimeMode(database: typeof db = db): ConstructionTimeMode {
    try {
      const row = database
        .prepare("SELECT value FROM company_settings WHERE company_id = 0 AND key = 'construction_time_mode'")
        .get() as { value: string } | undefined;
      if (row?.value === 'realistic' || row?.value === 'test') {
        return row.value;
      }
    } catch {
      // fallback
    }
    return (CONFIG.CONSTRUCTION_TIME_MODE as ConstructionTimeMode) || 'test';
  }

  /**
   * Get active construction speed multiplier.
   */
  static getConstructionSpeedMultiplier(database: typeof db = db): number {
    try {
      const row = database
        .prepare("SELECT value FROM company_settings WHERE company_id = 0 AND key = 'construction_speed_multiplier'")
        .get() as { value: string } | undefined;
      if (row?.value) {
        const val = parseFloat(row.value);
        if (Number.isFinite(val) && val > 0) return val;
      }
    } catch {
      // fallback
    }
    return Number(CONFIG.CONSTRUCTION_SPEED_MULTIPLIER) || 1.0;
  }

  /**
   * One-click switcher for construction time mode:
   * - 'realistic': uses authentic encyclopedia buildDuration for buildings and upgrades.
   * - 'test': flat 10-second fast build duration.
   */
  static async setConstructionTimeMode(
    mode: 'realistic' | 'test',
    speedMultiplier?: number,
    database: typeof db = db
  ): Promise<{
    mode: 'realistic' | 'test';
    description: string;
    speedMultiplier: number;
    samples: Array<{ name: string; kind: string; durationSeconds: number; durationDisplay: string }>;
  }> {
    database.prepare(`
      INSERT INTO company_settings (company_id, key, value)
      VALUES (0, 'construction_time_mode', ?)
      ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value
    `).run(mode);

    if (typeof speedMultiplier === 'number' && speedMultiplier > 0) {
      database.prepare(`
        INSERT INTO company_settings (company_id, key, value)
        VALUES (0, 'construction_speed_multiplier', ?)
        ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value
      `).run(String(speedMultiplier));
    }

    return FixtureService.getConstructionTimeMode(database);
  }

  /**
   * Get current construction time mode and representative sample durations.
   */
  static getConstructionTimeMode(database: typeof db = db): {
    mode: 'realistic' | 'test';
    description: string;
    speedMultiplier: number;
    samples: Array<{ name: string; kind: string; durationSeconds: number; durationDisplay: string }>;
  } {
    const mode = FixtureService.getActiveConstructionTimeMode(database);
    const speedMultiplier = FixtureService.getConstructionSpeedMultiplier(database);
    const sampleBuildings = [
      { name: 'Plantation', kind: 'P' },
      { name: 'Water reservoir', kind: 'W' },
      { name: 'Power plant', kind: 'E' },
      { name: 'Car factory', kind: '1' },
      { name: 'Launchpad', kind: 'l' }
    ];

    const samples = sampleBuildings.map(b => {
      const durationSeconds = calculateConstructionDurationSeconds(b.kind, 1, mode, speedMultiplier);
      return {
        name: b.name,
        kind: b.kind,
        durationSeconds,
        durationDisplay: formatDurationHuman(durationSeconds)
      };
    });

    return {
      mode,
      description: mode === 'realistic'
        ? `Realistic construction time enabled (derived from encyclopedia buildDuration, ${speedMultiplier}x speed)`
        : 'Fast test construction time enabled (10 seconds flat)',
      speedMultiplier,
      samples
    };
  }

  /**
   * Get configured chatrooms list.
   */
  static getConfiguredChatrooms(): Array<ChatroomSubscriptionEntry> {
    return getConfiguredChatrooms();
  }

  /**
   * Configure custom chatrooms (count, preset, or custom rooms).
   */
  static setConfiguredChatrooms(options: {
    count?: number;
    preset?: string;
    rooms?: Array<ChatroomSubscriptionEntry>;
    reset?: boolean;
  }) {
    return setConfiguredChatrooms(options);
  }

  /**
   * Set economy phase: 'recession' (0), 'normal' (1), or 'boom' (2).
   */
  static setEconomyState(
    stateInput: 'recession' | 'normal' | 'boom' | number,
    options?: {
      realmId?: number;
      random?: boolean;
      refreshSchedule?: string;
    },
    database: typeof db = db
  ): EconomyPhaseStatus & { random: boolean; refreshSchedule: string } {
    const realmId = options?.realmId ?? 0;
    let numericState = 1;
    if (typeof stateInput === 'number') {
      numericState = Math.max(0, Math.min(2, Math.floor(stateInput)));
    } else {
      const s = String(stateInput).toLowerCase();
      if (s === 'recession' || s === '0' || s === 'depression' || s === '萧条') numericState = 0;
      else if (s === 'boom' || s === '2' || s === '景气') numericState = 2;
      else numericState = 1;
    }

    // Persist phase directly into economy_state
    setEconomyPhase(realmId, numericState, new Date(virtualClock.nowMs()), 'admin', true);

    if (options?.random !== undefined) {
      database.prepare(`
        INSERT INTO company_settings (company_id, key, value)
        VALUES (0, 'economy_random', ?)
        ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value
      `).run(options.random ? 'true' : 'false');
    }

    if (options?.refreshSchedule) {
      database.prepare(`
        INSERT INTO company_settings (company_id, key, value)
        VALUES (0, 'economy_refresh_schedule', ?)
        ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value
      `).run(options.refreshSchedule);
    }

    return FixtureService.getEconomyState(realmId, database);
  }

  /**
   * Get current economy state and settings.
   */
  static getEconomyState(
    realmId: number = 0,
    database: typeof db = db
  ): EconomyPhaseStatus & { random: boolean; refreshSchedule: string } {
    const phase = getEconomyPhase(realmId);
    let random = CONFIG.ECONOMY_RANDOM;
    let refreshSchedule = CONFIG.ECONOMY_REFRESH_SCHEDULE;

    try {
      const rowRandom = database.prepare("SELECT value FROM company_settings WHERE company_id = 0 AND key = 'economy_random'").get() as { value: string } | undefined;
      if (rowRandom?.value) random = rowRandom.value === 'true';

      const rowSched = database.prepare("SELECT value FROM company_settings WHERE company_id = 0 AND key = 'economy_refresh_schedule'").get() as { value: string } | undefined;
      if (rowSched?.value) refreshSchedule = rowSched.value;
    } catch {
      // fallback
    }

    return {
      ...phase,
      random,
      refreshSchedule
    };
  }

  /**
   * Roll next economy phase randomly according to Markov transition weights.
   */
  static rollEconomyState(realmId: number = 0, database: typeof db = db) {
    rollEconomyPhase(new Date(virtualClock.nowMs()), realmId);
    return FixtureService.getEconomyState(realmId, database);
  }
}
