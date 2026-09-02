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
import { normalizePositionCode } from '../game/executives.ts';

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
          db.prepare(`
            INSERT INTO buildings (id, company_id, kind, size, position, abundance, busy_until, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
          `).run(buildingId, companyId, b.kind, b.size, posName, abundance, nowIso);
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
          db.prepare(`
            INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, updated_at)
            VALUES (?, ?, ?, ?, 1.0, ?)
            ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = amount + ?
          `).run(companyId, w.kind, w.quality, w.amount, nowIso, w.amount);
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
   * - 'realistic': Seeds market orders using canonical production costs from economy models.
   * - 'test': Seeds market orders with flat $1.00 + Q testing prices.
   */
  static async setMarketPricingMode(
    mode: 'realistic' | 'test',
    database: typeof db = db
  ): Promise<{ mode: string; ordersUpdated: number; samplePrices: Array<{ resource: string; q0: number; q2: number }> }> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { CONFIG } = await import('../config.ts');
    const { CONSTANTS_RESOURCES } = await import('../game/constants.ts');
    const { getPriceTickSize } = await import('../domain/market/market-rules.ts');

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

    const nowIso = new Date().toISOString();
    const samplePrices: Array<{ resource: string; q0: number; q2: number }> = [];
    let ordersUpdated = 0;

    return runInTransaction(async () => {
      // 1. Delete previous NPC seeded market orders (seller_id = 999900)
      database.prepare('DELETE FROM market_orders WHERE seller_id = 999900').run();

      const insertStmt = database.prepare(`
        INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active)
        VALUES (999900, ?, ?, 100000, ?, 0, ?, 1)
      `);

      for (const [k, def] of Object.entries(CONSTANTS_RESOURCES)) {
        const kind = Number(k);
        if (def.isExchangeTradable === false) continue;

        const model = economyModels[String(kind)]?.state_1 || economyModels[String(kind)]?.state_0;
        const baseCost = Number(model?.modeledProductionCostPerUnit) || 2.0;

        let q0Price = 1.0;
        let q2Price = 1.02;

        for (let q = 0; q <= 12; q++) {
          let unitPrice = 1.0 + q;
          if (mode === 'realistic') {
            unitPrice = roundToTick(baseCost * (1.05 + q * 0.10));
          } else {
            unitPrice = roundToTick(1.0 + q * 0.01);
          }

          if (q === 0) q0Price = unitPrice;
          if (q === 2) q2Price = unitPrice;

          insertStmt.run(kind, q, unitPrice, nowIso);
          ordersUpdated++;
        }

        if (samplePrices.length < 6) {
          samplePrices.push({ resource: def.image || `Resource #${kind}`, q0: q0Price, q2: q2Price });
        }
      }

      return { mode, ordersUpdated, samplePrices };
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
}
