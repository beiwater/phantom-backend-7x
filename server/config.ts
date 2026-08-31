import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');

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
};
