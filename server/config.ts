import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');

const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Ignore parse/read errors
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
  INITIAL_MONEY: 100000,
  INITIAL_SIMBOOSTS: 250,
  INITIAL_LEVEL: parseInt(process.env.INITIAL_LEVEL || '0', 10),

  // Construction Time Mode: 'test' (10s fast default) vs 'realistic' (authentic encyclopedia buildDuration)
  CONSTRUCTION_TIME_MODE: (process.env.CONSTRUCTION_TIME_MODE as 'realistic' | 'test') || 'test',
  CONSTRUCTION_SPEED_MULTIPLIER: parseFloat(process.env.CONSTRUCTION_SPEED_MULTIPLIER || process.env.SPEED_MULTIPLIER || '1.0'),

  // Market Pricing Mode & Target Profit
  MARKET_PRICING_MODE: (process.env.MARKET_PRICING_MODE as 'realistic' | 'test') || 'realistic',
  TARGET_BUILDING_PROFIT: parseFloat(process.env.TARGET_BUILDING_PROFIT || '300'),
  MARKET_PRICE_VOLATILITY: parseFloat(process.env.MARKET_PRICE_VOLATILITY || '0.05'),
  // Economy Phase & Random Rotation Configuration
  ECONOMY_STATE: (process.env.ECONOMY_STATE?.toLowerCase() as 'recession' | 'normal' | 'boom') || 'normal',
  ECONOMY_RANDOM: process.env.ECONOMY_RANDOM !== 'false',
  ECONOMY_REFRESH_SCHEDULE: process.env.ECONOMY_REFRESH_SCHEDULE || 'friday_15_utc',
  // Issue #70: when set to '1', every state-changing payment route (main
  // payment, stripe, tron, google purchase) answers 501 without mutating any
  // balance. Default is unset: local direct purchase stays available (P0-03).
  PAYMENTS_DISABLED: process.env.PAYMENTS_DISABLED === '1',
};
