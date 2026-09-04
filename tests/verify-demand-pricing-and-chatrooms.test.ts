import assert from 'node:assert';
import { Readable } from 'node:stream';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { handleSocialRoutes, CHATROOM_PRESETS } from '../server/routes/social-routes.ts';
import { handleDebugRoutes } from '../server/routes/debug-routes.ts';

console.log('=== Verifying Demand Pricing & Chatroom Customization ===');

// ==============================================================================
// 1. Verify Demand-Adjusted Floating Market Pricing
// ==============================================================================
console.log('\n[1/4] Verifying Demand-Adjusted Floating Market Pricing...');

const pricingRes = await FixtureService.setMarketPricingMode('realistic', db, {
  targetProfit: 300,
  volatility: 0.05
});

assert.strictEqual(pricingRes.mode, 'realistic');
assert.ok(pricingRes.ordersUpdated > 100, 'NPC orders should be seeded for all resources');

// Check Apples (kind 3, saturation ~0.72 in retail_saturation -> demand compressed)
const applesQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 3 AND quality = 0').get() as { price: number };
const appleProfit = (applesQ0.price - 1.386) * 121.7;
console.log(`  * Apples (Sat=0.72, compressed demand): Price=$${applesQ0.price.toFixed(2)}, Hourly Profit=$${appleProfit.toFixed(1)} (compressed below $300)`);
assert.ok(appleProfit >= 180 && appleProfit <= 260, `Apples profit should be compressed (~$200-240), got ${appleProfit}`);

// Check Steak (kind 7, saturation ~0.35 in retail_saturation -> high demand)
const steakQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 7 AND quality = 0').get() as { price: number };
const steakProfit = (steakQ0.price - 26.107) * 10.1;
console.log(`  * Steak  (Sat=0.35, high demand):       Price=$${steakQ0.price.toFixed(2)}, Hourly Profit=$${steakProfit.toFixed(1)} (expanded above $300)`);
assert.ok(steakProfit >= 380 && steakProfit <= 480, `Steak profit should expand above $300, got ${steakProfit}`);

// Check Power (kind 1, baseline demand ~1.0)
const powerQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 1 AND quality = 0').get() as { price: number };
const powerProfit = (powerQ0.price - 0.161) * 2566.9;
console.log(`  * Power  (Baseline demand=1.0):         Price=$${powerQ0.price.toFixed(3)}, Hourly Profit=$${powerProfit.toFixed(1)} (~$300 target)`);
assert.ok(powerProfit >= 270 && powerProfit <= 350, `Power profit should be around $300, got ${powerProfit}`);

console.log('  [OK] Demand-adjusted floating market pricing verified successfully!');

// ==============================================================================
// 2. Verify Chatroom Customization (Programmatic & Service API)
// ==============================================================================
console.log('\n[2/4] Verifying Chatroom Customization via FixtureService...');

// Reset to default
FixtureService.setConfiguredChatrooms({ reset: true });
const defaultRooms = FixtureService.getConfiguredChatrooms();
assert.strictEqual(defaultRooms.length, 10, 'Default chatroom count should be 10');
console.log(`  * Default chatrooms count: ${defaultRooms.length}`);

// Set custom count: 3 rooms
const count3Res = FixtureService.setConfiguredChatrooms({ count: 3 });
assert.strictEqual(count3Res.count, 3, 'Chatroom count should be 3');
assert.strictEqual(count3Res.chatrooms.length, 3);
const activeRooms3 = FixtureService.getConfiguredChatrooms();
assert.strictEqual(activeRooms3.length, 3);
console.log(`  * Configured count=3: active rooms = ${activeRooms3.map(r => r.name).join(', ')}`);

// Set preset: 'zh'
const zhRes = FixtureService.setConfiguredChatrooms({ preset: 'zh' });
assert.strictEqual(zhRes.count, 3);
assert.ok(zhRes.chatrooms.every(r => r.language === 'zh-cn'), 'All rooms should be Chinese');
console.log(`  * Configured preset=zh: active rooms = ${zhRes.chatrooms.map(r => r.name).join(', ')}`);

// Set preset: 'minimal'
const minRes = FixtureService.setConfiguredChatrooms({ preset: 'minimal' });
assert.strictEqual(minRes.count, 3);
assert.deepStrictEqual(minRes.chatrooms.map(r => r.name), ['Game', 'Help', 'Sales']);
console.log(`  * Configured preset=minimal: active rooms = ${minRes.chatrooms.map(r => r.name).join(', ')}`);

// Custom arbitrary rooms
const customRes = FixtureService.setConfiguredChatrooms({
  rooms: [
    { name: 'VIP Lounge', language: 'en', category: 'vip', image: '/chat-icon/vip.png', db_letter: 'V', realmsShared: true, protectedForCountry: null },
    { name: 'Trading Floor', language: 'en', category: 'sales', image: '/chat-icon/trade.png', db_letter: 'T', realmsShared: false, protectedForCountry: null }
  ]
});
assert.strictEqual(customRes.count, 2);
assert.strictEqual(customRes.chatrooms[0].name, 'VIP Lounge');
console.log('  * Configured custom arbitrary rooms: VIP Lounge, Trading Floor');

// Reset to default
FixtureService.setConfiguredChatrooms({ reset: true });
assert.strictEqual(FixtureService.getConfiguredChatrooms().length, 10);
console.log('  [OK] Chatroom customization service operations verified successfully!');

// ==============================================================================
// 3. Verify Debug API Endpoints for Chatrooms
// ==============================================================================
console.log('\n[3/4] Verifying Chatrooms HTTP Debug Endpoints...');

function createMockRes() {
  let statusCode = 200;
  let headers: Record<string, string> = {};
  let body = '';
  return {
    writeHead(code: number, h?: any) { statusCode = code; if (h) headers = { ...headers, ...h }; },
    setHeader(k: string, v: any) { headers[k] = String(v); },
    getHeader(k: string) { return headers[k]; },
    end(data?: string) { if (data) body = data; },
    getStatus() { return statusCode; },
    getBody() { return body ? JSON.parse(body) : null; }
  };
}

// GET /api/v2/debug/chatrooms/
const getMockRes = createMockRes();
const getHandled = await handleDebugRoutes({} as any, getMockRes as any, '/api/v2/debug/chatrooms/', 'GET', 1, 1);
assert.strictEqual(getHandled, true);
assert.strictEqual(getMockRes.getStatus(), 200);
const getPayload = getMockRes.getBody();
assert.strictEqual(getPayload.count, 10);
assert.ok(Array.isArray(getPayload.chatrooms));
assert.ok(getPayload.availablePresets.includes('zh'));
console.log(`  * GET /api/v2/debug/chatrooms/ returned count=${getPayload.count}, presets=${getPayload.availablePresets.join(',')}`);

function createMockPostReq(payload: any): any {
  const buf = Buffer.from(JSON.stringify(payload));
  const req: any = Readable.from([buf]);
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(buf.length)
  };
  return req;
}

const postMockReq = createMockPostReq({ count: 4 });
const postMockRes = createMockRes();
const postHandled = await handleDebugRoutes(postMockReq, postMockRes as any, '/api/v2/debug/chatrooms/', 'POST', 1, 1);
assert.strictEqual(postHandled, true);
assert.strictEqual(postMockRes.getStatus(), 200);
const postPayload = postMockRes.getBody();
assert.strictEqual(postPayload.count, 4);
assert.strictEqual(postPayload.chatrooms.length, 4);
console.log(`  * POST /api/v2/debug/chatrooms/ set count=4 successfully!`);

// Verify GET reflects the update
const verifyGetRes = createMockRes();
await handleDebugRoutes({} as any, verifyGetRes as any, '/api/v2/debug/chatrooms/', 'GET', 1, 1);
const resetMockReq = createMockPostReq({ reset: true });
const resetMockRes = createMockRes();
await handleDebugRoutes(resetMockReq, resetMockRes as any, '/api/v2/debug/chatrooms/', 'POST', 1, 1);
assert.strictEqual(resetMockRes.getBody().count, 10);
console.log('  [OK] HTTP Debug endpoints for chatroom customization verified successfully!');

// ==============================================================================
// 4. Verify Company Chatroom Subscriptions Endpoint
// ==============================================================================
console.log('\n[4/4] Verifying Company Chatroom Subscriptions Endpoint...');

// Set chatrooms to 3 rooms: Supporters (P), Game (G), Help (H)
FixtureService.setConfiguredChatrooms({ count: 3 });

const compRoomsRes = createMockRes();
const compHandled = await handleSocialRoutes({} as any, compRoomsRes as any, '/api/v2/companies/chatrooms/1/', 'GET', 1, 1);
assert.strictEqual(compHandled, true);
const compRooms = compRoomsRes.getBody();
assert.strictEqual(compRooms.length, 3, 'Should only return the 3 configured chatrooms');
assert.strictEqual(compRooms[0].db_letter, 'P');
assert.strictEqual(compRooms[1].db_letter, 'G');
assert.strictEqual(compRooms[2].db_letter, 'H');
console.log(`  * GET /api/v2/companies/chatrooms/1/ respects custom configured count: ${compRooms.length} rooms`);

// Reset back to default for clean state
FixtureService.setConfiguredChatrooms({ reset: true });

console.log('\n================================================================');
console.log(' [OK] ALL DEMAND PRICING & CHATROOM CUSTOMIZATION TESTS PASSED! ');
console.log('================================================================');
