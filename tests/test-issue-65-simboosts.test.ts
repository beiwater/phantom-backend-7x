import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { getCompanyById } from '../server/game/company.ts';
import {
  exchangeSimBoosts,
  unlockBuildingSlot,
  unlockExecutiveSlot,
  unlockTagSlot,
  unlockDisplayCaseSlot,
  rushBuildingUpgradeOrConstruction
} from '../server/game/simboosts.ts';
import { handleSimboostRoutes } from '../server/routes/simboost-routes.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

interface MockHttpHandler {
  req: IncomingMessage;
  res: ServerResponse;
  getStatusCode: () => number;
  getBody: () => Record<string, unknown> | null;
  waitForCompletion: () => Promise<void>;
}

function createMockReqRes(body: unknown = {}): MockHttpHandler {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, { headers: { 'content-type': 'application/json' } });

  let statusCode = 200;
  let responseData = '';
  const { promise, resolve } = Promise.withResolvers<void>();

  const headersMap = new Map<string, string | string[]>();
  const res = {
    writeHead(code: number) {
      statusCode = code;
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      headersMap.set(name.toLowerCase(), value);
      return res;
    },
    getHeader(name: string) {
      return headersMap.get(name.toLowerCase());
    },
    end(data?: string) {
      if (data) responseData += data;
      resolve();
    }
  } as unknown as ServerResponse;

  queueMicrotask(() => {
    const payload = JSON.stringify(body);
    req.emit('data', Buffer.from(payload));
    req.emit('end');
  });

  return {
    req,
    res,
    getStatusCode: () => statusCode,
    getBody: () => (responseData ? (JSON.parse(responseData) as Record<string, unknown>) : null),
    waitForCompletion: () => promise
  };
}

async function runIssue65Verification() {
  console.log('=== Starting Issue #65 SimBoosts Verification ===');

  // 1. Create a test player & company
  const randomEmail = `issue65_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.local`;
  const { playerId, companyId } = registerPlayer(randomEmail, 'password123', 'Issue65 Test Co');

  // Set predictable starting SimBoosts & money
  db.prepare('UPDATE companies SET simboosts = 500, money = 10000, extra_building_slots = 0, extra_executive_slots = 0, display_case_slots = 1, max_tags = 1 WHERE company_id = ?')
    .run(companyId);

  const initialComp = getCompanyById(companyId);
  assert.ok(initialComp, 'Company must exist');
  assert.equal(initialComp.simboosts, 500);
  assert.equal(initialComp.money, 10000);

  // 2. Test Construction Rush on Idle Building (busy_until is null)
  console.log('-> Test 1: Rush construction on idle building (busy_until = NULL)');
  const buildingInsert = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, busy_until, created_at)
    VALUES (?, '90', 'P', 1, 'Farm', 6900, 'production', NULL, ?)
    RETURNING id
  `).get(companyId, new Date().toISOString()) as { id: number };

  const idleBuildingId = buildingInsert.id;

  // Attempt rush on idle building - MUST fail and NOT deduct 5 SimBoosts
  let errorCaught = false;
  try {
    await rushBuildingUpgradeOrConstruction(companyId, idleBuildingId);
  } catch (err: unknown) {
    errorCaught = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /not under construction/i);
  }
  assert.equal(errorCaught, true, 'Rushing idle building must throw an error');

  let compAfterFailedRush = getCompanyById(companyId);
  assert.equal(compAfterFailedRush?.simboosts, 500, 'SimBoost balance must remain unchanged (500) after rejected idle rush');

  // Test 2: Construction Rush on Past Busy Building (busy_until in the past)
  console.log('-> Test 2: Rush construction on building with past busy_until');
  const pastIso = new Date(Date.now() - 60000).toISOString();
  db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(pastIso, idleBuildingId);

  errorCaught = false;
  try {
    await rushBuildingUpgradeOrConstruction(companyId, idleBuildingId);
  } catch (err: unknown) {
    errorCaught = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /not under construction/i);
  }
  assert.equal(errorCaught, true, 'Rushing building with expired busy_until must throw an error');

  compAfterFailedRush = getCompanyById(companyId);
  assert.equal(compAfterFailedRush?.simboosts, 500, 'SimBoost balance must remain unchanged (500) after past busy_until rush');

  // Test 3: Construction Rush on Actively Busy Building (busy_until in the future)
  console.log('-> Test 3: Rush construction on actively constructing building');
  const futureIso = new Date(Date.now() + 60000).toISOString();
  db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(futureIso, idleBuildingId);

  const rushResult = await rushBuildingUpgradeOrConstruction(companyId, idleBuildingId);
  assert.equal(rushResult.success, true);
  assert.equal(rushResult.simBoosts, 495, 'SimBoosts must be decremented by 5 (500 -> 495)');

  const buildingAfterRush = db.prepare('SELECT busy_until FROM buildings WHERE id = ?').get(idleBuildingId) as { busy_until: string | null };
  assert.equal(buildingAfterRush.busy_until, null, 'busy_until must be cleared to NULL');

  const compAfterValidRush = getCompanyById(companyId);
  assert.equal(compAfterValidRush?.simboosts, 495);

  // Test 4: Atomic exchangeSimBoosts
  console.log('-> Test 4: Atomic exchangeSimBoosts');
  const exchangeResult = await exchangeSimBoosts(companyId, 10);
  assert.equal(exchangeResult.success, true);
  assert.equal(exchangeResult.simBoosts, 485, '10 SimBoosts deducted (495 -> 485)');
  assert.equal(exchangeResult.money, 11000, '$1,000 added ($10,000 -> $11,000)');

  // Attempt exchange with insufficient SimBoosts
  errorCaught = false;
  try {
    await exchangeSimBoosts(companyId, 10000);
  } catch (err: unknown) {
    errorCaught = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /insufficient/i);
  }
  assert.equal(errorCaught, true);
  const compAfterFailedEx = getCompanyById(companyId);
  assert.equal(compAfterFailedEx?.simboosts, 485);
  assert.equal(compAfterFailedEx?.money, 11000);

  // Test 5: Atomic unlockBuildingSlot
  console.log('-> Test 5: Atomic unlockBuildingSlot');
  // First slot costs 50
  const slot1 = await unlockBuildingSlot(companyId);
  assert.equal(slot1.success, true);
  assert.equal(slot1.spent, 50);
  assert.equal(slot1.extraBuildingSlots, 1);
  assert.equal(slot1.simBoosts, 435);

  const compSlot1 = getCompanyById(companyId);
  assert.equal(compSlot1?.extra_building_slots, 1);
  assert.equal(compSlot1?.simboosts, 435);

  // Test 6: Atomic unlockExecutiveSlot
  console.log('-> Test 6: Atomic unlockExecutiveSlot');
  const execSlot = await unlockExecutiveSlot(companyId);
  assert.equal(execSlot.success, true);
  assert.equal(execSlot.extraExecutiveSlots, 1);
  assert.equal(execSlot.simBoosts, 335, '100 SimBoosts deducted (435 -> 335)');

  const compExec = getCompanyById(companyId);
  assert.equal(compExec?.extra_executive_slots, 1);
  assert.equal(compExec?.simboosts, 335);

  // Test 7: Atomic unlockTagSlot
  console.log('-> Test 7: Atomic unlockTagSlot');
  const tagSlot = await unlockTagSlot(companyId);
  assert.equal(tagSlot.success, true);
  assert.equal(tagSlot.maxTags, 2);
  assert.equal(tagSlot.simBoosts, 135, '200 SimBoosts deducted (335 -> 135)');

  const compTag = getCompanyById(companyId);
  assert.equal(compTag?.max_tags, 2);
  assert.equal(compTag?.simboosts, 135);

  // Test 8: Atomic unlockDisplayCaseSlot
  console.log('-> Test 8: Atomic unlockDisplayCaseSlot');
  const dcSlot = await unlockDisplayCaseSlot(companyId);
  assert.equal(dcSlot.success, true);
  assert.equal(dcSlot.displayCaseSlots, 2);
  assert.equal(dcSlot.simBoosts, 85, '50 SimBoosts deducted (135 -> 85)');

  const compDc = getCompanyById(companyId);
  assert.equal(compDc?.display_case_slots, 2);
  assert.equal(compDc?.simboosts, 85);

  // Test 9: HTTP Route Level - Idle Construction Rush Returns 400 Bad Request
  console.log('-> Test 9: HTTP Route Level POST /construction-rush/ for idle building');
  const mockHttp = createMockReqRes();
  const handled = await handleSimboostRoutes(
    mockHttp.req,
    mockHttp.res,
    `/api/v2/companies/buildings/${idleBuildingId}/construction-rush/`,
    'POST',
    playerId,
    companyId
  );
  assert.equal(handled, true, 'Route must be handled');
  await mockHttp.waitForCompletion();

  assert.equal(mockHttp.getStatusCode(), 400, 'HTTP status code must be 400');
  const responseBody = mockHttp.getBody();
  assert.ok(typeof responseBody?.error === 'string', 'Response must have error message string');
  assert.match(responseBody.error as string, /not under construction/i);

  const finalComp = getCompanyById(companyId);
  assert.equal(finalComp?.simboosts, 85, 'Final SimBoosts must remain 85 with 0 deduction on 400 response');

  console.log('✅ All Issue #65 regression tests passed successfully!');
}

runIssue65Verification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
