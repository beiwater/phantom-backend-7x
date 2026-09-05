import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCumulativeXpForLevel, getTierForLevel } from './domain/leveling/level-rules.ts';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');

const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Ignore parse/read errors so .env remains optional.
  }
}
export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '127.0.0.1',
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  ROOT_DIR,
  DATA_DIR: path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR),
  STATIC_DIR: path.join(ROOT_DIR, 'frontend-original', 'static'),
  HTML_DIR: path.join(ROOT_DIR, 'frontend-original', 'html'),
  CONSTANTS_DIR: path.join(ROOT_DIR, 'server', 'data', 'constants'),
  UPSTREAM_BASE: 'https://www.simcompanies.com',
  UPSTREAM_CDN: 'https://d1fxy698ilbz6u.cloudfront.net',
  
  // Game parameters
  PRODUCTION_SPEED_MULTIPLIER: parseFloat(process.env.SPEED_MULTIPLIER || '1.0'),
  // Initial User / Company Settings (Configurable via .env)
  INITIAL_MONEY: parseFloat(process.env.INITIAL_MONEY || '100000'),
  INITIAL_SIMBOOSTS: parseInt(process.env.INITIAL_SIMBOOSTS || '250', 10),
  INITIAL_LEVEL: parseInt(process.env.INITIAL_LEVEL || '0', 10),
  INITIAL_EXPERIENCE: process.env.INITIAL_EXPERIENCE !== undefined ? parseInt(process.env.INITIAL_EXPERIENCE, 10) : undefined,
  INITIAL_EXTRA_BUILDING_SLOTS: parseInt(process.env.INITIAL_EXTRA_BUILDING_SLOTS || '0', 10),
  INITIAL_BUILDING_SLOTS: process.env.INITIAL_BUILDING_SLOTS !== undefined ? parseInt(process.env.INITIAL_BUILDING_SLOTS, 10) : undefined,
  INITIAL_WAREHOUSE_STOCK: process.env.INITIAL_WAREHOUSE_STOCK || 'standard',
  // Construction Time Mode: 'test' (10s fast default) vs 'realistic' (authentic encyclopedia buildDuration)
  CONSTRUCTION_TIME_MODE: (process.env.CONSTRUCTION_TIME_MODE as 'realistic' | 'test') || 'test',
  CONSTRUCTION_SPEED_MULTIPLIER: parseFloat(process.env.CONSTRUCTION_SPEED_MULTIPLIER || process.env.SPEED_MULTIPLIER || '1.0'),

  // Market Pricing Mode & Target Profit
  MARKET_PRICING_MODE: (process.env.MARKET_PRICING_MODE as 'realistic' | 'test') || 'realistic',
  TARGET_BUILDING_PROFIT: parseFloat(process.env.TARGET_BUILDING_PROFIT || '300'),
  MARKET_PRICE_VOLATILITY: parseFloat(process.env.MARKET_PRICE_VOLATILITY || '0.05'),
  // NPC Market & Restock Configuration
  NPC_MARKET_Q0_ONLY: process.env.NPC_MARKET_Q0_ONLY !== undefined
    ? process.env.NPC_MARKET_Q0_ONLY === 'true'
    : (process.env.NPC_MARKET_MAX_QUALITY !== undefined ? parseInt(process.env.NPC_MARKET_MAX_QUALITY, 10) === 0 : false),
  NPC_MARKET_MAX_QUALITY: process.env.NPC_MARKET_MAX_QUALITY !== undefined
    ? parseInt(process.env.NPC_MARKET_MAX_QUALITY, 10)
    : (process.env.NPC_MARKET_Q0_ONLY === 'true' ? 0 : 12),
  NPC_MARKET_INFINITE: process.env.NPC_MARKET_INFINITE === 'true',
  NPC_RESTOCK_INTERVAL_HOURS: parseFloat(process.env.NPC_RESTOCK_INTERVAL_HOURS || '24'),
  NPC_RESTOCK_INTERVAL_SECONDS: process.env.NPC_RESTOCK_INTERVAL_SECONDS ? parseFloat(process.env.NPC_RESTOCK_INTERVAL_SECONDS) : undefined,
  NPC_RESTOCK_BASE_HOURS: parseFloat(process.env.NPC_RESTOCK_BASE_HOURS || '24'),
  NPC_RESTOCK_CAP_MULTIPLIER: parseFloat(process.env.NPC_RESTOCK_CAP_MULTIPLIER || '3.0'),
  NPC_RESTOCK_DEMAND_SCALING: process.env.NPC_RESTOCK_DEMAND_SCALING !== 'false',
  NPC_RESTOCK_DEMAND_WINDOW_HOURS: parseFloat(process.env.NPC_RESTOCK_DEMAND_WINDOW_HOURS || '24'),
  NPC_RESTOCK_DEMAND_ELASTICITY: parseFloat(process.env.NPC_RESTOCK_DEMAND_ELASTICITY || '1.0'),
  NPC_RESTOCK_MIN_QUANTITY: parseInt(process.env.NPC_RESTOCK_MIN_QUANTITY || '10', 10),
  NPC_RESTOCK_MAX_STOCK_ABSOLUTE: parseInt(process.env.NPC_RESTOCK_MAX_STOCK_ABSOLUTE || '1000000', 10),
  // Realm Phase Progression Configuration (realms-guide)
  REALM_PHASE_PRESET: process.env.REALM_PHASE_PRESET || undefined,
  REALM_PHASE: process.env.REALM_PHASE !== undefined ? parseInt(process.env.REALM_PHASE, 10) : undefined,
  REALM_RESEARCH_LIMIT: process.env.REALM_RESEARCH_LIMIT !== undefined ? parseInt(process.env.REALM_RESEARCH_LIMIT, 10) : undefined,
  REALM_BONDS_ENABLED: process.env.REALM_BONDS_ENABLED !== undefined ? process.env.REALM_BONDS_ENABLED === 'true' : undefined,
  REALM_GOV_ORDERS_ENABLED: process.env.REALM_GOV_ORDERS_ENABLED !== undefined ? process.env.REALM_GOV_ORDERS_ENABLED === 'true' : undefined,
  REALM_EXECUTIVES_ENABLED: process.env.REALM_EXECUTIVES_ENABLED !== undefined ? process.env.REALM_EXECUTIVES_ENABLED === 'true' : undefined,
  REALM_REC_BUILDINGS_ENABLED: process.env.REALM_REC_BUILDINGS_ENABLED !== undefined ? process.env.REALM_REC_BUILDINGS_ENABLED === 'true' : undefined,
  REALM_COLLECTIBLES_ENABLED: process.env.REALM_COLLECTIBLES_ENABLED !== undefined ? process.env.REALM_COLLECTIBLES_ENABLED === 'true' : undefined,
  REALM_ROBOTS_ENABLED: process.env.REALM_ROBOTS_ENABLED !== undefined ? process.env.REALM_ROBOTS_ENABLED === 'true' : undefined,
  // Economy Phase & Random Rotation Configuration
  ECONOMY_STATE: (process.env.ECONOMY_STATE?.toLowerCase() as 'recession' | 'normal' | 'boom') || 'normal',
  ECONOMY_RANDOM: process.env.ECONOMY_RANDOM !== 'false',
  ECONOMY_REFRESH_SCHEDULE: process.env.ECONOMY_REFRESH_SCHEDULE || 'friday_15_utc',
  // Issue #70: when set to '1', every state-changing payment route (main
  // payment, stripe, tron, google purchase) answers 501 without mutating any
  // balance. Default is unset: local direct purchase stays available (P0-03).
  PAYMENTS_DISABLED: process.env.PAYMENTS_DISABLED === '1',
};

export interface InitialStockItem {
  kind: number;
  amount: number;
  quality?: number;
}

export const PRESET_WAREHOUSE_STOCKS: Record<string, InitialStockItem[]> = {
  standard: [
    { kind: 1, amount: 20000 },   // Power (电力)
    { kind: 2, amount: 20000 },   // Water (水)
    { kind: 66, amount: 10000 },  // Seeds (种子)
    { kind: 13, amount: 20000 },  // Transport (运输)
    { kind: 3, amount: 5000 },    // Apples (苹果)
    { kind: 4, amount: 5000 },    // Oranges (橙子)
    { kind: 119, amount: 5000 },  // Coffee (咖啡)
    { kind: 101, amount: 5000 },  // Planks (木板)
    { kind: 102, amount: 5000 },  // Bricks (砖块)
    { kind: 108, amount: 5000 },  // Reinforced concrete (钢筋混凝土)
    { kind: 111, amount: 5000 }   // Construction units (建筑构件)
  ],
  rich: [
    { kind: 1, amount: 100000 },
    { kind: 2, amount: 100000 },
    { kind: 66, amount: 50000 },
    { kind: 13, amount: 100000 },
    { kind: 3, amount: 20000 },
    { kind: 4, amount: 20000 },
    { kind: 119, amount: 20000 },
    { kind: 101, amount: 20000 },
    { kind: 102, amount: 20000 },
    { kind: 108, amount: 20000 },
    { kind: 111, amount: 20000 }
  ],
  builder: [
    { kind: 1, amount: 50000 },
    { kind: 2, amount: 50000 },
    { kind: 13, amount: 50000 },
    { kind: 101, amount: 50000 },
    { kind: 102, amount: 50000 },
    { kind: 108, amount: 50000 },
    { kind: 111, amount: 20000 }
  ],
  empty: []
};

/**
 * Parse INITIAL_WAREHOUSE_STOCK environment variable into an array of stock items.
 * Supports preset names ('standard', 'rich', 'builder', 'empty')
 * or comma-separated pairs: 'kind:amount[:quality],...'
 * or JSON string: '[{"kind":1,"amount":50000},...]'
 */
export function parseInitialWarehouseStock(raw?: string): InitialStockItem[] {
  const clean = (raw || CONFIG.INITIAL_WAREHOUSE_STOCK || 'standard').trim();
  if (!clean || clean.toLowerCase() === 'empty' || clean.toLowerCase() === 'none') {
    return [];
  }
  if (PRESET_WAREHOUSE_STOCKS[clean.toLowerCase()]) {
    return PRESET_WAREHOUSE_STOCKS[clean.toLowerCase()];
  }

  // Try JSON
  if (clean.startsWith('[') && clean.endsWith(']')) {
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        return parsed.map(item => ({
          kind: Number(item.kind),
          amount: Math.max(0, Number(item.amount) || 0),
          quality: Math.max(0, Number(item.quality) || 0)
        })).filter(item => Number.isFinite(item.kind) && item.amount > 0);
      }
    } catch {
      // Fall back to comma-separated parser
    }
  }

  // Comma-separated pairs e.g. "1:20000,2:20000,66:10000"
  const items: InitialStockItem[] = [];
  const tokens = clean.split(',');
  for (const token of tokens) {
    const parts = token.trim().split(':');
    if (parts.length >= 2) {
      const kind = parseInt(parts[0], 10);
      const amount = parseFloat(parts[1]);
      const quality = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
      if (!isNaN(kind) && !isNaN(amount) && amount > 0) {
        items.push({ kind, amount, quality: isNaN(quality) ? 0 : quality });
      }
    }
  }

  return items.length > 0 ? items : PRESET_WAREHOUSE_STOCKS.standard;
}

/**
 * Returns resolved initial company settings based on current CONFIG and .env settings.
 */
export function getInitialCompanySettings() {
  const level = Number.isFinite(CONFIG.INITIAL_LEVEL) ? CONFIG.INITIAL_LEVEL : 0;
  const experience = CONFIG.INITIAL_EXPERIENCE !== undefined
    ? CONFIG.INITIAL_EXPERIENCE
    : getCumulativeXpForLevel(level);
  const tier = getTierForLevel(level);
  const extraBuildingSlots = CONFIG.INITIAL_BUILDING_SLOTS !== undefined
    ? Math.max(0, CONFIG.INITIAL_BUILDING_SLOTS - tier.maxBuildings)
    : (CONFIG.INITIAL_EXTRA_BUILDING_SLOTS || 0);
  const money = Number.isFinite(CONFIG.INITIAL_MONEY) ? CONFIG.INITIAL_MONEY : 100000;
  const simboosts = Number.isFinite(CONFIG.INITIAL_SIMBOOSTS) ? CONFIG.INITIAL_SIMBOOSTS : 250;
  const warehouseStock = parseInitialWarehouseStock(CONFIG.INITIAL_WAREHOUSE_STOCK);

  return {
    level,
    experience,
    extraBuildingSlots,
    money,
    simboosts,
    warehouseStock
  };
}
