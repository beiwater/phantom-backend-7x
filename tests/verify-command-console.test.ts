import assert from 'node:assert';
import { executeCommand, getCommandRegistry } from '../server/game/commands/command-engine.ts';
import { getCompanyById } from '../server/game/company.ts';
import { getWarehouseItem } from '../server/game/warehouse.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { socialRepository } from '../server/repositories/social-repository.ts';
import { handleSocialRoutes } from '../server/routes/social-routes.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

console.log('=== Testing Minecraft-Style Command Console & PA Integration ===\n');

// Setup test fixture company
const fixture = await FixtureService.applyScenario({
  companyName: 'Command Test Corp',
  money: 100000,
  simboosts: 100,
  level: 10
});

const company = getCompanyById(fixture.companyId);
assert(company, 'Fixture company must exist');
const testCompanyId = company.company_id;

// 1. Test Command Tokenizer
console.log('[1/7] Testing Command Tokenizer...');
const registry = getCommandRegistry();
const tokens1 = registry.tokenize('/give 1 water 5000 0');
assert.deepStrictEqual(tokens1, ['/give', '1', 'water', '5000', '0']);

const tokens2 = registry.tokenize('/give "Command Test Corp" "crude oil" 2000 1');
assert.deepStrictEqual(tokens2, ['/give', 'Command Test Corp', 'crude oil', '2000', '1']);
console.log('  -> OK: Tokenizer handles plain and quoted tokens with spaces\n');

// 2. Test Target Selectors
console.log('[2/7] Testing Target Resolution (@s, @a, ID, Name)...');
// Test @s with context
const resSelf = await executeCommand('/money @s add 1000', {
  executorCompanyId: testCompanyId,
  isOp: true,
  source: 'pa'
});
assert.strictEqual(resSelf.success, true);
assert(resSelf.message.includes('1,000'));

// Test @s in CLI without target should fail safely
const resCliSelf = await executeCommand('/money @s add 1000', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resCliSelf.success, false);
assert(resCliSelf.message.includes('Cannot resolve @s'));

// Test by ID
const resId = await executeCommand(`/money ${testCompanyId} add 5000`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resId.success, true);

// Test by Name
const resName = await executeCommand('/money "Command Test Corp" add 2000', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resName.success, true);
console.log('  -> OK: Target selectors (@s, ID, Name) resolved correctly\n');

// 3. Test Asset Commands (/money, /give, /simboost)
console.log('[3/7] Testing Asset Commands (/money, /give, /simboost)...');
// Set money to exact value
const resSetMoney = await executeCommand(`/money ${testCompanyId} set 500000`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resSetMoney.success, true);
assert.strictEqual(Number(getCompanyById(testCompanyId)?.money), 500000);

// Remove money
const resRemoveMoney = await executeCommand(`/money ${testCompanyId} remove 50000`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resRemoveMoney.success, true);
assert.strictEqual(Number(getCompanyById(testCompanyId)?.money), 450000);

// Give water
const resGiveWater = await executeCommand(`/give ${testCompanyId} water 8000 2`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resGiveWater.success, true);
const waterItem = getWarehouseItem(testCompanyId, 2, 2);
assert(waterItem && waterItem.amount >= 8000, 'Warehouse must have received 8000 Q2 water');

// Give crude oil (multi-word alias)
const resGiveOil = await executeCommand(`/give ${testCompanyId} crude_oil 3500 0`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resGiveOil.success, true);
const oilItem = getWarehouseItem(testCompanyId, 10, 0);
assert(oilItem && oilItem.amount >= 3500, 'Warehouse must have received 3500 Q0 crude oil');

// Simboost add
const resSb = await executeCommand(`/simboost ${testCompanyId} add 250`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resSb.success, true);
assert.strictEqual(Number(getCompanyById(testCompanyId)?.simboosts), 350);
console.log('  -> OK: Asset commands updated warehouse, cash ledger, and simboost balances\n');

// 4. Test Macro-Economy & Time Warp
console.log('[4/7] Testing Economy & Time Warp Commands...');
const resEcon = await executeCommand('/economy boom', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resEcon.success, true);
assert(resEcon.message.includes('BOOM'));

const resTime = await executeCommand('/time add 24h', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resTime.success, true);
assert(virtualClock.getOffsetHours() >= 24);

const resCycle = await executeCommand('/cycle force', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resCycle.success, true);
assert(resCycle.message.includes('Settled cycle'));
console.log('  -> OK: Economy set to boom, virtual time warped 24h, cycle settled\n');

// 5. Test Admin & OP Authorization
console.log('[5/7] Testing Admin & OP Authorization (/op, /deop, /say)...');
// Unauthenticated PA user should be rejected from OP command
socialRepository.upsertCompanySetting(testCompanyId, 'is_admin_op', '0');
const resReject = await executeCommand('/give @s water 100', {
  executorCompanyId: testCompanyId,
  isOp: false,
  source: 'pa'
});
assert.strictEqual(resReject.success, false);
assert(resReject.message.includes('Permission denied'));

// Wrong secret key rejected
const resBadKey = await executeCommand('/op wrong-password', {
  executorCompanyId: testCompanyId,
  isOp: false,
  source: 'pa'
});
assert.strictEqual(resBadKey.success, false);

// Authenticate via correct secret key
const resAuth = await executeCommand('/op phantom-admin', {
  executorCompanyId: testCompanyId,
  isOp: false,
  source: 'pa'
});
assert.strictEqual(resAuth.success, true);
assert.strictEqual(socialRepository.getCompanySetting(testCompanyId, 'is_admin_op'), '1');

// Now permitted to run OP commands
const resAllowed = await executeCommand('/give @s water 100', {
  executorCompanyId: testCompanyId,
  isOp: false, // will read is_admin_op = '1' from DB
  source: 'pa'
});
assert.strictEqual(resAllowed.success, true);

// Broadcast /say command
const resSay = await executeCommand('/say Server maintenance scheduled in 10 minutes', {
  executorCompanyId: testCompanyId,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resSay.success, true);
console.log('  -> OK: OP secret key gating and authorization lifecycle verified\n');

// 6. Test Certificate Commands
console.log('[6/7] Testing Certificate Commands (/cert grant, /cert list)...');
const resCertGrant = await executeCommand(`/cert ${testCompanyId} grant 36`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resCertGrant.success, true);
assert(resCertGrant.message.includes('Kind 36'));

const resCertList = await executeCommand(`/cert ${testCompanyId} list`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resCertList.success, true);
assert(resCertList.message.includes('Kind 36'));
console.log('  -> OK: Certificate granted and listed via command\n');

// 7. Test In-Game PA Message Interception via Social Route
console.log('[7/7] Testing In-Game PA Message Interception via POST /api/v2/message/ ...');

function createMockReqRes(body: unknown) {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = 'POST';
  req.url = '/api/v2/message/';
  req.headers = { 'content-type': 'application/json' };
  setPreparsedBody(req, body);

  let responseData = '';
  let statusCode = 200;

  const res = {
    writeHead: (code: number) => { statusCode = code; },
    setHeader: () => {},
    getHeader: () => undefined,
    end: (chunk?: string) => { if (chunk) responseData += chunk; }
  } as unknown as ServerResponse;

  return { req, res, getResult: () => ({ statusCode, json: JSON.parse(responseData || '{}') }) };
}

const mock1 = createMockReqRes({ text: '/help', recipient: 0 });
const handled = await handleSocialRoutes(mock1.req, mock1.res, '/api/v2/message/', 'POST', testCompanyId);
assert.strictEqual(handled, true);
await new Promise(r => setTimeout(r, 50));
const resultJson = mock1.getResult().json;
assert(resultJson.sender && resultJson.sender.company === '个人助理', 'Sender must be Personal Assistant');
assert(resultJson.body && resultJson.body.includes('老板'), 'Assistant reply should start with secretary tone');
assert(resultJson.commandResult && resultJson.commandResult.success, 'Command execution result must be true');

console.log('  -> OK: PA chat intercept successfully executed /help and replied with secretary persona\n');

// 8. Test Market Restock Command (/market restock)
console.log('[8/10] Testing Market Command (/market restock)...');
const resMarket = await executeCommand('/market restock', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resMarket.success, true);
assert(resMarket.message.includes('NPC Market Restocked'));
console.log('  -> OK: Market restock executed and repopulated NPC orders\n');

// 9. Test Speed Command (/speed 10x, /speed fast, /speed normal)
console.log('[9/10] Testing Speed Command (/speed multiplier, fast, normal)...');
const resSpeed10 = await executeCommand('/speed 10x', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resSpeed10.success, true);
assert(resSpeed10.message.includes('10x'));

const resSpeedFast = await executeCommand('/speed fast', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resSpeedFast.success, true);
assert(resSpeedFast.message.includes('TEST'));

const resSpeedNormal = await executeCommand('/speed normal', {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resSpeedNormal.success, true);
assert(resSpeedNormal.message.includes('REALISTIC'));
console.log('  -> OK: Speed multipliers and 10s fast build mode toggled correctly\n');

// 10. Test Executive Command (/exec hire, /exec list, /exec fire)
console.log('[10/10] Testing Executive Command (/exec hire, list, fire)...');
const resExecHire = await executeCommand(`/exec ${testCompanyId} hire COO 100 20000 "Sarah Chen"`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resExecHire.success, true);
assert(resExecHire.message.includes('Sarah Chen'));
assert(resExecHire.message.includes('COO'));

const resExecList = await executeCommand(`/exec ${testCompanyId} list`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resExecList.success, true);
assert(resExecList.message.includes('Sarah Chen'));
assert(resExecList.message.includes('管理100'));

const resExecFire = await executeCommand(`/exec ${testCompanyId} fire COO`, {
  executorCompanyId: null,
  isOp: true,
  source: 'cli'
});
assert.strictEqual(resExecFire.success, true);
assert(resExecFire.message.includes('Fired'));
console.log('  -> OK: Executive hired with 100 skill, listed in org chart, and fired\n');

console.log('=== ALL 10 COMMAND CONSOLE & PA TESTS PASSED! ===');

