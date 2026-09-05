/**
 * NPC Market & Dynamic Restock Service
 *
 * Implements:
 * 1. Q0-only / max-quality filtering for NPC orders (seller 999900).
 * 2. Scheduled periodic restocking instead of infinite stock.
 * 3. Dynamic batch quantities based on resource production rates.
 * 4. Upper stock limit cap (preventing unbounded accumulation).
 * 5. Real-time dynamic replenishment adjustment based on player purchase volume.
 * 6. Time acceleration and virtual clock synchronization.
 */
import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { CONFIG } from '../config.ts';
import { CONSTANTS_RESOURCES, type ResourceDef } from '../game/constants.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { getPriceTickSize } from '../domain/market/market-rules.ts';
import { logger } from '../core/logger.ts';

export const NPC_SELLER_ID = 999900;

// Initialize tables for NPC market state and demand tracking
db.exec(`
  CREATE TABLE IF NOT EXISTS npc_market_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_restock_virtual_ms INTEGER NOT NULL,
    last_restock_wall_ms INTEGER NOT NULL,
    restock_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS npc_resource_demand (
    kind INTEGER PRIMARY KEY,
    total_bought REAL NOT NULL DEFAULT 0,
    last_bought_at TEXT,
    updated_at TEXT
  );
`);

export interface NpcMarketStatus {
  q0Only: boolean;
  maxQuality: number;
  infiniteStock: boolean;
  restockIntervalHours: number;
  restockIntervalSeconds: number;
  effectiveRealIntervalMs: number;
  speedMultiplier: number;
  lastRestockVirtualIso: string | null;
  lastRestockWallIso: string | null;
  nextRestockEtaSeconds: number;
  restockCount: number;
  demandScalingEnabled: boolean;
  demandElasticity: number;
  capMultiplier: number;
  sampleBatches: Array<{
    kind: number;
    name: string;
    producedPerHour: number;
    baseBatch: number;
    adjustedBatch: number;
    maxCap: number;
    currentStock: number;
    recentPurchased: number;
  }>;
}

let restockerTimer: NodeJS.Timeout | null = null;

export class NpcMarketService {
  private static economyModelsCache: Record<string, any> | null = null;

  private static getEconomyModels(): Record<string, any> {
    if (this.economyModelsCache) return this.economyModelsCache;
    try {
      const modelPath = path.join(CONFIG.CONSTANTS_DIR, '..', 'decompile', 'economy_model.json');
      if (fs.existsSync(modelPath)) {
        this.economyModelsCache = JSON.parse(fs.readFileSync(modelPath, 'utf-8')).models || {};
        return this.economyModelsCache!;
      }
    } catch {
      // fallback
    }
    this.economyModelsCache = {};
    return this.economyModelsCache;
  }

  /**
   * Get in-game restock interval in milliseconds.
   */
  static getGameIntervalMs(): number {
    if (CONFIG.NPC_RESTOCK_INTERVAL_SECONDS && CONFIG.NPC_RESTOCK_INTERVAL_SECONDS > 0) {
      return CONFIG.NPC_RESTOCK_INTERVAL_SECONDS * 1000;
    }
    const hours = Number(CONFIG.NPC_RESTOCK_INTERVAL_HOURS) || 24;
    return Math.max(1000, Math.round(hours * 3600 * 1000));
  }

  /**
   * Get effective real-time restock interval in milliseconds under current speed multiplier.
   */
  static getEffectiveRealIntervalMs(): number {
    const gameMs = this.getGameIntervalMs();
    const speed = Math.max(0.001, Number(CONFIG.PRODUCTION_SPEED_MULTIPLIER) || 1.0);
    return Math.max(500, Math.round(gameMs / speed));
  }

  /**
   * Calculate base batch quantity for a resource kind based on raw production rate.
   */
  static calculateBaseBatch(kind: number, quality: number = 0): number {
    const def = CONSTANTS_RESOURCES[String(kind)] as ResourceDef | undefined;
    const baseHours = Math.max(1, Number(CONFIG.NPC_RESTOCK_BASE_HOURS) || 24);
    const minQty = Math.max(1, Number(CONFIG.NPC_RESTOCK_MIN_QUANTITY) || 10);

    let producedPerHour = Number(def?.producedPerHourRaw) || 0;
    if (producedPerHour <= 0) {
      const models = this.getEconomyModels();
      const model = models[String(kind)]?.state_1 || models[String(kind)]?.state_0;
      const levelsNeeded = Number(model?.buildingLevelsNeededPerUnitPerHour) || 0;
      if (levelsNeeded > 0) {
        producedPerHour = 1 / levelsNeeded;
      } else {
        producedPerHour = 4.0; // fallback standard unit rate
      }
    }

    let baseBatch = Math.max(minQty, Math.round(producedPerHour * baseHours));

    // Quality scaling: higher quality items are scarcer
    if (quality > 0) {
      const qFactor = Math.max(0.05, 1 - quality * 0.07);
      baseBatch = Math.max(1, Math.round(baseBatch * qFactor));
    }

    return baseBatch;
  }

  /**
   * Calculate upper stock limit cap for a resource kind.
   */
  static calculateMaxCap(kind: number, quality: number = 0): number {
    const baseBatch = this.calculateBaseBatch(kind, quality);
    const capMultiplier = Math.max(1.0, Number(CONFIG.NPC_RESTOCK_CAP_MULTIPLIER) || 3.0);
    const cap = Math.round(baseBatch * capMultiplier);
    const absoluteMax = Number(CONFIG.NPC_RESTOCK_MAX_STOCK_ABSOLUTE) || 1000000;
    return Math.min(absoluteMax, cap);
  }

  /**
   * Query recent player purchases of a resource from NPC in the demand window.
   */
  static getRecentPlayerPurchases(kind: number, database: DatabaseSync = db): number {
    const windowHours = Math.max(1, Number(CONFIG.NPC_RESTOCK_DEMAND_WINDOW_HOURS) || 24);
    const windowStartIso = new Date(virtualClock.nowMs() - windowHours * 3600 * 1000).toISOString();

    // 1. Query market_trades where seller was NPC
    const row = database.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM market_trades
      WHERE seller_id = ? AND kind = ? AND traded_at >= ?
    `).get(NPC_SELLER_ID, kind, windowStartIso) as { total: number } | undefined;

    const tradeVolume = Number(row?.total) || 0;

    // 2. Query realtime demand tracker
    const demandRow = database.prepare(`
      SELECT total_bought, last_bought_at FROM npc_resource_demand WHERE kind = ?
    `).get(kind) as { total_bought: number; last_bought_at: string } | undefined;

    let trackerVolume = 0;
    if (demandRow && demandRow.last_bought_at && demandRow.last_bought_at >= windowStartIso) {
      trackerVolume = Number(demandRow.total_bought) || 0;
    }

    return Math.max(tradeVolume, trackerVolume);
  }

  /**
   * Calculate dynamically adjusted batch quantity based on player purchase volume.
   */
  static calculateDynamicBatch(kind: number, quality: number = 0, database: DatabaseSync = db): {
    baseBatch: number;
    adjustedBatch: number;
    maxCap: number;
    purchasedVolume: number;
    demandFactor: number;
  } {
    const baseBatch = this.calculateBaseBatch(kind, quality);
    const maxCap = this.calculateMaxCap(kind, quality);

    if (!CONFIG.NPC_RESTOCK_DEMAND_SCALING) {
      return { baseBatch, adjustedBatch: baseBatch, maxCap, purchasedVolume: 0, demandFactor: 1.0 };
    }

    const purchasedVolume = this.getRecentPlayerPurchases(kind, database);
    const elasticity = Math.max(0.1, Number(CONFIG.NPC_RESTOCK_DEMAND_ELASTICITY) || 1.0);

    let demandFactor = 1.0;
    if (purchasedVolume > 0) {
      const demandRatio = purchasedVolume / Math.max(1, baseBatch);
      // Scaling factor: if players bought 100% of base stock, demandFactor = 1.5x (up to 3.5x)
      demandFactor = Math.min(3.5, Math.max(0.5, 1.0 + (demandRatio - 0.5) * elasticity));
    } else {
      // Cooldown factor if no purchases recently (down to 0.75x)
      demandFactor = 0.75;
    }

    const minQty = Math.max(1, Number(CONFIG.NPC_RESTOCK_MIN_QUANTITY) || 10);
    const adjustedBatch = Math.max(minQty, Math.round(baseBatch * demandFactor));

    return { baseBatch, adjustedBatch, maxCap, purchasedVolume, demandFactor };
  }

  /**
   * Record a player purchase from NPC in real time to update demand immediately.
   */
  static recordPlayerPurchase(kind: number, amount: number, database: DatabaseSync = db): void {
    if (amount <= 0) return;
    const nowIso = virtualClock.nowIso();
    database.prepare(`
      INSERT INTO npc_resource_demand (kind, total_bought, last_bought_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(kind) DO UPDATE SET
        total_bought = total_bought + excluded.total_bought,
        last_bought_at = excluded.last_bought_at,
        updated_at = excluded.updated_at
    `).run(kind, amount, nowIso, nowIso);
  }

  /**
   * Calculate realistic or test unit price for resource kind and quality.
   */
  static calculateUnitPrice(kind: number, quality: number, database: DatabaseSync = db): number {
    function roundToTick(price: number): number {
      const tick = getPriceTickSize(price);
      return Math.round((Math.round(price / tick) * tick) * 1000) / 1000;
    }
    function deterministicFloat(seed: number): number {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }

    const mode = CONFIG.MARKET_PRICING_MODE || 'realistic';
    if (mode === 'test') {
      return roundToTick(1.0 + quality * 0.01);
    }

    const def = CONSTANTS_RESOURCES[String(kind)] as ResourceDef | undefined;
    const models = this.getEconomyModels();
    const model = models[String(kind)]?.state_1 || models[String(kind)]?.state_0;
    const baseCost = Number(model?.modeledProductionCostPerUnit) || Number(def?.cost) || 2.0;
    const levelsNeeded = Number(model?.buildingLevelsNeededPerUnitPerHour) || 0;
    const targetProfit = Number(CONFIG.TARGET_BUILDING_PROFIT) || 300;
    const volatility = Number(CONFIG.MARKET_PRICE_VOLATILITY) || 0.05;

    let saturation = 0.5;
    try {
      const satRow = database.prepare(`
        SELECT saturation FROM retail_saturation
        WHERE kind = ? ORDER BY date DESC LIMIT 1
      `).get(kind) as { saturation: number } | undefined;
      if (satRow && Number.isFinite(satRow.saturation)) {
        saturation = satRow.saturation;
      }
    } catch {
      // ignore
    }

    const demand = Math.max(0.4, Math.min(2.0, Math.round((0.5 / Math.max(0.1, saturation)) * 100) / 100));
    const effectiveProfitTarget = targetProfit * demand;
    const unitProfitTarget = levelsNeeded > 0
      ? effectiveProfitTarget * levelsNeeded
      : baseCost * 0.15 * demand;
    const targetQ0BasePrice = baseCost + unitProfitTarget;

    const floatDelta = (deterministicFloat(kind * 137 + quality * 29 + 17) - 0.5) * 2 * volatility;
    const floatPrice = targetQ0BasePrice * (1 + floatDelta);
    const qualityMultiplier = 1.0 + quality * 0.10;
    let unitPrice = roundToTick(floatPrice * qualityMultiplier);
    return Math.max(getPriceTickSize(unitPrice), unitPrice);
  }

  /**
   * Perform a complete market restocking cycle.
   */
  static async restock(
    options?: { force?: boolean },
    database: DatabaseSync = db
  ): Promise<{
    ordersUpdated: number;
    ordersCreated: number;
    ordersDeactivated: number;
    restockCount: number;
    timestamp: string;
  }> {
    return runInTransaction(async () => {
      const { RealmPhaseService } = await import('./realm-phase-service.ts');
      const realmConfig = RealmPhaseService.getActiveRealmConfig(database);
      const effectiveMaxQuality = Math.min(
        CONFIG.NPC_MARKET_Q0_ONLY ? 0 : Number(CONFIG.NPC_MARKET_MAX_QUALITY),
        realmConfig.researchLimit
      );
      let ordersDeactivated = 0;
      let ordersUpdated = 0;
      let ordersCreated = 0;

      // 1. Deactivate NPC orders that exceed max allowed quality (e.g. Q>0 in Q0-only mode or phase research limit)
      const deactRes = database.prepare(`
        UPDATE market_orders
        SET active = 0, quantity = 0
        WHERE seller_id = ? AND quality > ? AND active = 1
      `).run(NPC_SELLER_ID, effectiveMaxQuality);
      ordersDeactivated = Number(deactRes.changes) || 0;

      const nowIso = virtualClock.nowIso();
      const findExistingStmt = database.prepare(`
        SELECT id, quantity, active, price FROM market_orders
        WHERE seller_id = ? AND kind = ? AND quality = ?
      `);

      const updateOrderStmt = database.prepare(`
        UPDATE market_orders
        SET quantity = ?, active = 1, posted_at = ?
        WHERE id = ?
      `);

      const insertOrderStmt = database.prepare(`
        INSERT INTO market_orders (seller_id, kind, quality, quantity, price, fees, posted_at, active, is_npc)
        VALUES (?, ?, ?, ?, ?, 0, ?, 1, 1)
      `);

      // 2. Iterate all tradable resources and qualities up to effectiveMaxQuality
      for (const [k, def] of Object.entries(CONSTANTS_RESOURCES)) {
        const kind = Number(k);
        if (def.isExchangeTradable === false) continue;

        // Phase gate: do not stock resources introduced in future phases
        if (!RealmPhaseService.isResourceUnlocked(kind, database)) {
          const deactLocked = database.prepare(`
            UPDATE market_orders SET active = 0, quantity = 0
            WHERE seller_id = ? AND kind = ? AND active = 1
          `).run(NPC_SELLER_ID, kind);
          ordersDeactivated += Number(deactLocked.changes) || 0;
          continue;
        }

        for (let q = 0; q <= effectiveMaxQuality; q++) {
          const { adjustedBatch, maxCap } = this.calculateDynamicBatch(kind, q, database);
          const existing = findExistingStmt.get(NPC_SELLER_ID, kind, q) as {
            id: number;
            quantity: number;
            active: number;
            price: number;
          } | undefined;

          if (existing) {
            const currentQty = existing.active === 1 ? Math.max(0, existing.quantity) : 0;
            const spaceAvailable = Math.max(0, maxCap - currentQty);
            const addQty = Math.min(adjustedBatch, spaceAvailable);
            const newQty = currentQty + addQty;

            // Restock if there is room to add, or reactivate if empty
            if (addQty > 0 || (currentQty > 0 && existing.active === 0)) {
              updateOrderStmt.run(newQty, nowIso, existing.id);
              ordersUpdated++;
            }
          } else {
            // Order does not exist yet: create it
            const price = this.calculateUnitPrice(kind, q, database);
            const initialQty = Math.min(adjustedBatch, maxCap);
            insertOrderStmt.run(NPC_SELLER_ID, kind, q, initialQty, price, nowIso);
            ordersCreated++;
          }
        }
      }

      // 3. Reset temporary demand counters after cycle settlement
      database.prepare(`UPDATE npc_resource_demand SET total_bought = 0, updated_at = ?`).run(nowIso);

      // 4. Update persistent state
      const virtualNowMs = virtualClock.nowMs();
      const wallNowMs = Date.now();
      database.prepare(`
        INSERT INTO npc_market_state (id, last_restock_virtual_ms, last_restock_wall_ms, restock_count, updated_at)
        VALUES (1, ?, ?, 1, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_restock_virtual_ms = excluded.last_restock_virtual_ms,
          last_restock_wall_ms = excluded.last_restock_wall_ms,
          restock_count = restock_count + 1,
          updated_at = excluded.updated_at
      `).run(virtualNowMs, wallNowMs, nowIso);

      const stateRow = database.prepare('SELECT restock_count FROM npc_market_state WHERE id = 1').get() as { restock_count: number } | undefined;
      const restockCount = stateRow?.restock_count || 1;

      logger.info(`[NpcMarket] Restock cycle #${restockCount} completed: ${ordersUpdated} updated, ${ordersCreated} created, ${ordersDeactivated} deactivated`);

      return {
        ordersUpdated,
        ordersCreated,
        ordersDeactivated,
        restockCount,
        timestamp: nowIso
      };
    });
  }

  /**
   * Check if restock is due based on virtual clock progression or time-accelerated wall clock.
   */
  static async checkAndRestockIfNeeded(database: DatabaseSync = db): Promise<boolean> {
    const row = database.prepare(`
      SELECT last_restock_virtual_ms, last_restock_wall_ms FROM npc_market_state WHERE id = 1
    `).get() as { last_restock_virtual_ms: number; last_restock_wall_ms: number } | undefined;

    const gameIntervalMs = this.getGameIntervalMs();
    const virtualNowMs = virtualClock.nowMs();
    const wallNowMs = Date.now();
    const speed = Math.max(0.001, Number(CONFIG.PRODUCTION_SPEED_MULTIPLIER) || 1.0);

    if (!row) {
      // First run: execute initial restock
      await this.restock({ force: true }, database);
      return true;
    }

    const elapsedVirtualMs = virtualNowMs - Number(row.last_restock_virtual_ms);
    const elapsedWallMsScaled = (wallNowMs - Number(row.last_restock_wall_ms)) * speed;

    if (elapsedVirtualMs >= gameIntervalMs || elapsedWallMsScaled >= gameIntervalMs) {
      await this.restock({ force: true }, database);
      return true;
    }

    return false;
  }

  /**
   * Get complete status report of NPC market.
   */
  static getNpcMarketStatus(database: DatabaseSync = db): NpcMarketStatus {
    const maxQuality = CONFIG.NPC_MARKET_Q0_ONLY ? 0 : Number(CONFIG.NPC_MARKET_MAX_QUALITY);
    const gameIntervalMs = this.getGameIntervalMs();
    const effectiveRealIntervalMs = this.getEffectiveRealIntervalMs();
    const speed = Number(CONFIG.PRODUCTION_SPEED_MULTIPLIER) || 1.0;

    const row = database.prepare(`
      SELECT last_restock_virtual_ms, last_restock_wall_ms, restock_count FROM npc_market_state WHERE id = 1
    `).get() as {
      last_restock_virtual_ms: number;
      last_restock_wall_ms: number;
      restock_count: number;
    } | undefined;

    let lastRestockVirtualIso: string | null = null;
    let lastRestockWallIso: string | null = null;
    let nextRestockEtaSeconds = Math.round(effectiveRealIntervalMs / 1000);

    if (row) {
      lastRestockVirtualIso = new Date(row.last_restock_virtual_ms).toISOString();
      lastRestockWallIso = new Date(row.last_restock_wall_ms).toISOString();
      const elapsedWallMs = Date.now() - row.last_restock_wall_ms;
      const remainingRealMs = Math.max(0, effectiveRealIntervalMs - elapsedWallMs);
      nextRestockEtaSeconds = Math.round(remainingRealMs / 1000);
    }

    // Pick 5 representative resource kinds for sample display
    const sampleKinds = [1, 2, 3, 24, 57]; // Power, Water, Apples, Smartphones, Trucks
    const sampleBatches = sampleKinds.map(k => {
      const def = CONSTANTS_RESOURCES[String(k)] as ResourceDef | undefined;
      const { baseBatch, adjustedBatch, maxCap, purchasedVolume } = this.calculateDynamicBatch(k, 0, database);
      const stockRow = database.prepare(`
        SELECT quantity FROM market_orders WHERE seller_id = ? AND kind = ? AND quality = 0 AND active = 1
      `).get(NPC_SELLER_ID, k) as { quantity: number } | undefined;

      return {
        kind: k,
        name: def?.image ? path.basename(def.image, path.extname(def.image)) : `Resource #${k}`,
        producedPerHour: Number(def?.producedPerHourRaw) || 0,
        baseBatch,
        adjustedBatch,
        maxCap,
        currentStock: Number(stockRow?.quantity) || 0,
        recentPurchased: purchasedVolume
      };
    });

    return {
      q0Only: CONFIG.NPC_MARKET_Q0_ONLY,
      maxQuality,
      infiniteStock: CONFIG.NPC_MARKET_INFINITE,
      restockIntervalHours: Number(CONFIG.NPC_RESTOCK_INTERVAL_HOURS) || 24,
      restockIntervalSeconds: Math.round(gameIntervalMs / 1000),
      effectiveRealIntervalMs,
      speedMultiplier: speed,
      lastRestockVirtualIso,
      lastRestockWallIso,
      nextRestockEtaSeconds,
      restockCount: Number(row?.restock_count) || 0,
      demandScalingEnabled: CONFIG.NPC_RESTOCK_DEMAND_SCALING,
      demandElasticity: Number(CONFIG.NPC_RESTOCK_DEMAND_ELASTICITY) || 1.0,
      capMultiplier: Number(CONFIG.NPC_RESTOCK_CAP_MULTIPLIER) || 3.0,
      sampleBatches
    };
  }
}

/**
 * Start the background restocker ticker.
 */
export function startNpcMarketRestocker(): NodeJS.Timeout {
  if (restockerTimer) return restockerTimer;

  // Run catch-up check immediately
  NpcMarketService.checkAndRestockIfNeeded().catch(err => {
    logger.error('[NpcMarket] Initial restock check failed:', err);
  });

  // Ticker runs frequently to respond promptly to high speed multipliers (e.g. 2000x)
  const realInterval = NpcMarketService.getEffectiveRealIntervalMs();
  const tickerMs = Math.max(500, Math.min(3000, Math.round(realInterval / 2)));

  restockerTimer = setInterval(() => {
    NpcMarketService.checkAndRestockIfNeeded().catch(err => {
      logger.error('[NpcMarket] Scheduled restock check failed:', err);
    });
  }, tickerMs);

  return restockerTimer;
}

/**
 * Stop the background restocker ticker.
 */
export function stopNpcMarketRestocker(): void {
  if (restockerTimer) {
    clearInterval(restockerTimer);
    restockerTimer = null;
  }
}
