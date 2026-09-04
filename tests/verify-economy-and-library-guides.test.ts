import assert from 'node:assert';
import { Readable } from 'node:stream';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { handlePageRoutes, getPageArticle } from '../server/routes/page-routes.ts';
import { handleDebugRoutes } from '../server/routes/debug-routes.ts';

console.log('=== Verifying Economy Customization & Library Guides Data Integrity ===');

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

function createMockPostReq(payload: any): any {
  const buf = Buffer.from(JSON.stringify(payload));
  const req: any = Readable.from([buf]);
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(buf.length)
  };
  return req;
}

// ==============================================================================
// 1. Verify Economy Customization (Boom, Recession, Normal, Random, Schedule)
// ==============================================================================
console.log('\n[1/3] Verifying Economy State Customization via FixtureService & DB...');

// 1a. Set to Boom (景气)
const boomState = FixtureService.setEconomyState('boom', {
  random: false,
  refreshSchedule: 'daily_15_utc'
});
assert.strictEqual(boomState.state, 2);
assert.strictEqual(boomState.phase, 'boom');
assert.strictEqual(boomState.stateName, 'Boom');
assert.strictEqual(boomState.random, false, 'Random rotation should be locked');
assert.strictEqual(boomState.refreshSchedule, 'daily_15_utc');
assert.ok(boomState.productionModifier >= -0.03 && boomState.productionModifier <= 0.12, 'Boom modifier in range [-3%, +12%]');
// 1b. Set to Recession (萧条)
const recState = FixtureService.setEconomyState('recession', {
  random: true,
  refreshSchedule: 'friday_15_utc'
});
assert.strictEqual(recState.state, 0);
assert.strictEqual(recState.phase, 'recession');
assert.strictEqual(recState.stateName, 'Recession');
assert.strictEqual(recState.random, true, 'Random rotation should be enabled');
assert.ok(recState.productionModifier >= -0.12 && recState.productionModifier <= 0.06, 'Recession modifier in range [-12%, +6%]');
// 1c. Set to Normal (正常)
const normState = FixtureService.setEconomyState('normal');
assert.strictEqual(normState.state, 1);
assert.strictEqual(normState.phase, 'normal');
console.log(`  * Normal state: state=1, phase=normal, modifier=${(normState.productionModifier * 100).toFixed(1)}%`);

// 1d. Roll next state
const rolledState = FixtureService.rollEconomyState();
assert.ok([0, 1, 2].includes(rolledState.state), 'Rolled state must be valid 0, 1, or 2');
console.log(`  * Rolled next state: ${rolledState.stateName} (state: ${rolledState.state})`);

// 1e. HTTP Debug Endpoints: GET & POST /api/v2/debug/economy/
console.log('\nTesting Economy HTTP Debug Endpoints...');
const getRes = createMockRes();
const getHandled = await handleDebugRoutes({ url: '/api/v2/debug/economy/' } as any, getRes as any, '/api/v2/debug/economy/', 'GET', 1, 1);
assert.strictEqual(getHandled, true);
assert.strictEqual(getRes.getStatus(), 200);
const getPayload = getRes.getBody();
assert.ok([0, 1, 2].includes(getPayload.state));

// POST to switch to Boom
const postReq = createMockPostReq({ state: 'boom', random: true, refreshSchedule: 'friday_15_utc' });
const postRes = createMockRes();
const postHandled = await handleDebugRoutes(postReq, postRes as any, '/api/v2/debug/economy/', 'POST', 1, 1);
assert.strictEqual(postHandled, true);
assert.strictEqual(postRes.getStatus(), 200);
const postPayload = postRes.getBody();
assert.strictEqual(postPayload.phase, 'boom');
assert.strictEqual(postPayload.random, true);
console.log('  [OK] Economy state management and debug endpoints verified successfully!');

// Reset to normal for clean state
FixtureService.setEconomyState('normal');

// ==============================================================================
// 2. Verify Library & Guides Data Integrity (All Categories)
// ==============================================================================
console.log('\n[2/3] Verifying Library Guides Data Integrity Across All Categories...');

const REQUIRED_GUIDES = [
  // Troubleshooting
  { slug: 'faq', category: 'Troubleshooting' },
  { slug: 'supported-platforms', category: 'Troubleshooting' },
  { slug: 'report-a-bug', category: 'Troubleshooting' },
  // Beginners
  { slug: 'guide-for-beginners', category: 'Beginners' },
  { slug: 'interface-tips', category: 'Beginners' },
  // Features
  { slug: 'change-log', category: 'Features' },
  { slug: 'future-development', category: 'Features' },
  { slug: 'suggesting-features', category: 'Features' },
  // Mechanics
  { slug: 'abundance', category: 'Mechanics' },
  { slug: 'aerospace', category: 'Mechanics' },
  { slug: 'bonds-guide', category: 'Mechanics' },
  { slug: 'building-auctions', category: 'Mechanics' },
  { slug: 'buildings', category: 'Mechanics' },
  { slug: 'collectibles-guide', category: 'Mechanics' },
  { slug: 'construction-guide', category: 'Mechanics' },
  { slug: 'economy-model', category: 'Mechanics' },
  { slug: 'executives-guide', category: 'Mechanics' },
  { slug: 'government-orders', category: 'Mechanics' },
  { slug: 'leveling', category: 'Mechanics' },
  { slug: 'realms-guide', category: 'Mechanics' },
  { slug: 'reference-prices', category: 'Mechanics' },
  { slug: 'research-guide', category: 'Mechanics' },
  { slug: 'restaurant-guide', category: 'Mechanics' },
  { slug: 'robotics-and-specialization', category: 'Mechanics' },
  { slug: 'supporters-guide', category: 'Mechanics' },
  { slug: 'time-table', category: 'Mechanics' },
  // Fairplay
  { slug: 'fpa', category: 'Fairplay' },
  { slug: 'moderators-guide', category: 'Fairplay' },
  { slug: 'moderators', category: 'Fairplay' },
  // Legal
  { slug: 'cookie-policy', category: 'Legal' },
  { slug: 'generative-ai-disclosure', category: 'Legal' },
  { slug: 'privacy', category: 'Legal' },
  { slug: 'terms', category: 'Legal' },
  // Other
  { slug: 'about', category: 'Other' },
  { slug: 'submission-guide', category: 'Other' }
];

let checkedCount = 0;
for (const g of REQUIRED_GUIDES) {
  // Test Chinese version
  const zhResult = getPageArticle('zh-cn', g.slug);
  assert.strictEqual(zhResult.status, 200, `Guide ${g.slug} (zh-cn) should return status 200`);
  const zhPayload: any = zhResult.payload;
  assert.ok(zhPayload.title && zhPayload.title.length > 0, `Guide ${g.slug} (zh-cn) must have title`);
  assert.ok(zhPayload.body && zhPayload.body.length > 50, `Guide ${g.slug} (zh-cn) must have substantial body`);

  // Test English version
  const enResult = getPageArticle('en', g.slug);
  assert.strictEqual(enResult.status, 200, `Guide ${g.slug} (en) should return status 200`);
  const enPayload: any = enResult.payload;
  assert.ok(enPayload.title && enPayload.title.length > 0, `Guide ${g.slug} (en) must have title`);
  assert.ok(enPayload.body && enPayload.body.length > 50, `Guide ${g.slug} (en) must have substantial body`);

  checkedCount++;
}

console.log(`  * Successfully verified ${checkedCount} guide articles in both Chinese & English!`);
const faqArticle = getPageArticle('zh-cn', 'faq');
console.log(`  * Sample FAQ article: title="${faqArticle.payload?.title}", body length=${(faqArticle.payload as any)?.body?.length} chars`);
assert.ok((faqArticle.payload as any)?.body?.length > 10000, 'FAQ article body should be comprehensive');

// ==============================================================================
// 3. Verify HTTP API Routing for Pages, Moderators, and Reports
// ==============================================================================
console.log('\n[3/3] Verifying HTTP Endpoints for Pages, Moderators, and Reports...');

// 3a. GET /api/v3/pages/zh-cn/guide-for-beginners/
const pageMockRes = createMockRes();
const pageHandled = await handlePageRoutes({} as any, pageMockRes as any, '/api/v3/pages/zh-cn/guide-for-beginners/', 'GET');
assert.strictEqual(pageHandled, true);
assert.strictEqual(pageMockRes.getStatus(), 200);
const pageData = pageMockRes.getBody();
assert.strictEqual(pageData.slug, 'guide-for-beginners');
assert.strictEqual(pageData.title, '新人指南');
console.log(`  * GET /api/v3/pages/zh-cn/guide-for-beginners/ -> "${pageData.title}" (${pageData.body.length} chars)`);

// 3b. GET /api/v2/moderators/
const modMockRes = createMockRes();
const modHandled = await handlePageRoutes({} as any, modMockRes as any, '/api/v2/moderators/', 'GET');
assert.strictEqual(modHandled, true);
assert.strictEqual(modMockRes.getStatus(), 200);
const modData = modMockRes.getBody();
assert.ok(Array.isArray(modData) && modData.length > 0, 'Moderators must be a non-empty array');
console.log(`  * GET /api/v2/moderators/ returned ${modData.length} moderators: ${modData.map((m: any) => m.name).join(', ')}`);

// 3c. POST /api/v2/report/
const repMockRes = createMockRes();
const repHandled = await handlePageRoutes({} as any, repMockRes as any, '/api/v2/report/', 'POST');
assert.strictEqual(repHandled, true);
assert.strictEqual(repMockRes.getStatus(), 200);
const repData = repMockRes.getBody();
assert.strictEqual(repData.success, true);
console.log(`  * POST /api/v2/report/ returned success receipt`);

console.log('\n================================================================');
console.log(' [OK] ALL ECONOMY & LIBRARY GUIDES TESTS PASSED SUCCESSFULLY!   ');
console.log('================================================================');
