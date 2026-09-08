import assert from 'node:assert';
import type { IncomingMessage } from 'node:http';
import { isGeoAllowed } from '../server/security/client-ip.ts';
import { CONFIG } from '../server/config.ts';

console.log('=== Verifying GeoIP Whitelist for Specified Regions ===');

function createMockReq(headers: Record<string, string> = {}, remoteAddress = '203.0.113.1'): IncomingMessage {
  return {
    headers,
    socket: {
      remoteAddress
    }
  } as unknown as IncomingMessage;
}

const originalWhitelist = CONFIG.GEOIP_WHITELIST;
try {
  CONFIG.GEOIP_WHITELIST = ['CN', 'HK', 'TW', 'MO', 'AU', 'ES', 'PT', 'AD', 'GI'];

  // 1. Whitelisted countries: China, HK, Taiwan, Macau, Australia, Spain, Portugal, Andorra, Gibraltar
  console.log('[1/4] Checking whitelisted regions...');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'CN' }), '/zh-cn/'), true, 'CN must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'HK' }), '/api/v2/auth/me/'), true, 'HK must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'TW' }), '/zh-cn/'), true, 'TW must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'MO' }), '/zh-cn/'), true, 'MO must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'AU' }), '/zh-cn/'), true, 'AU must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'ES' }), '/zh-cn/'), true, 'ES must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'PT' }), '/zh-cn/'), true, 'PT must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'AD' }), '/zh-cn/'), true, 'AD must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'GI' }), '/zh-cn/'), true, 'GI must be allowed');

  // 2. Non-whitelisted countries: US, JP, DE, RU, etc.
  console.log('[2/4] Checking non-whitelisted regions...');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'US' }), '/zh-cn/'), false, 'US must be blocked');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'JP' }), '/zh-cn/'), false, 'JP must be blocked');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'DE' }), '/zh-cn/'), false, 'DE must be blocked');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'RU' }), '/zh-cn/'), false, 'RU must be blocked');

  // 3. Health probes: always allowed regardless of country
  console.log('[3/4] Checking health probe bypass...');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'US' }), '/health/live'), true, '/health/live must never be blocked');
  assert.strictEqual(isGeoAllowed(createMockReq({ 'cf-ipcountry': 'US' }), '/health/ready'), true, '/health/ready must never be blocked');

  // 4. Internal loopback connections
  console.log('[4/4] Checking internal loopback connections...');
  assert.strictEqual(isGeoAllowed(createMockReq({}, '127.0.0.1'), '/api/time/'), true, '127.0.0.1 must be allowed');
  assert.strictEqual(isGeoAllowed(createMockReq({}, '::1'), '/api/time/'), true, '::1 must be allowed');

  console.log('PASS: GeoIP Whitelist verified successfully');
} finally {
  CONFIG.GEOIP_WHITELIST = originalWhitelist;
}
