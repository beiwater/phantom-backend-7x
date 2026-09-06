import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { addFollower, removeFollower, listFollowers } from '../server/application/buildings/followers.ts';
import { socialRepository } from '../server/repositories/social-repository.ts';
import { handleSimboostRoutes } from '../server/routes/simboost-routes.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
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
  Object.assign(req, {
    headers: { 'content-type': 'application/json' },
    url: ''
  });

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
    getBody: () => {
      try {
        return JSON.parse(responseData) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    waitForCompletion: () => promise
  };
}

async function runTests() {
  console.log('=== Running Followers Sync & V1 Rush Regression Suite ===\n');

  // 1. Setup Test Companies and Buildings
  const timestamp = Date.now();
  const playerA = registerPlayer(
    `follower_test_a_${timestamp}@test.com`,
    'TestPass123!',
    `Follower Co A ${timestamp}`
  );
  const playerB = registerPlayer(
    `follower_test_b_${timestamp}@test.com`,
    'TestPass123!',
    `Follower Co B ${timestamp}`
  );

  const companyAId = playerA.companyId;
  const companyBId = playerB.companyId;

  // Insert test buildings
  const b1 = db.prepare(`
    INSERT INTO buildings (company_id, kind, size, position, name, cost, category, created_at)
    VALUES (?, 'W', 1, '10', 'Water Reservoir 1', 6900, 'production', ?)
    RETURNING id
  `).get(companyAId, virtualClock.nowIso()) as { id: number };

  const b2 = db.prepare(`
    INSERT INTO buildings (company_id, kind, size, position, name, cost, category, created_at)
    VALUES (?, 'W', 1, '11', 'Water Reservoir 2', 6900, 'production', ?)
    RETURNING id
  `).get(companyAId, virtualClock.nowIso()) as { id: number };

  const b3 = db.prepare(`
    INSERT INTO buildings (company_id, kind, size, position, name, cost, category, created_at)
    VALUES (?, 'W', 1, '12', 'Water Reservoir 3', 6900, 'production', ?)
    RETURNING id
  `).get(companyAId, virtualClock.nowIso()) as { id: number };

  const bOther = db.prepare(`
    INSERT INTO buildings (company_id, kind, size, position, name, cost, category, created_at)
    VALUES (?, 'W', 1, '10', 'Other Co Reservoir', 6900, 'production', ?)
    RETURNING id
  `).get(companyBId, virtualClock.nowIso()) as { id: number };

  // --------------------------------------------------------------------------
  // PART 1: Followers State Sync & Contract Testing
  // --------------------------------------------------------------------------
  console.log('[1/7] Testing addFollower returns fresh linking state immediately...');
  const linkingAfterFirstAdd = await addFollower(b1.id, b2.id, companyAId);
  assert.deepEqual(
    { ...linkingAfterFirstAdd[0] },
    { id: b2.id, controllerId: b1.id, followerId: b2.id },
    'Linking item must have id, controllerId, followerId matching contract'
  );

  console.log('[2/7] Testing second follower addition returns both links without delay...');
  const linkingAfterSecondAdd = await addFollower(b1.id, b3.id, companyAId);
  assert.equal(linkingAfterSecondAdd.length, 2, 'Should immediately return 2 linking relationships');
  const followerIds = linkingAfterSecondAdd.map(l => l.followerId).sort();
  assert.deepEqual(followerIds, [b2.id, b3.id].sort(), 'Both followers must be present in response');

  console.log('[3/7] Testing follower re-linking to a new controller cleans up old relationship...');
  // Move b2 from controller b1 to controller b3
  const linkingAfterRebind = await addFollower(b3.id, b2.id, companyAId);
  const b2Links = linkingAfterRebind.filter(l => l.followerId === b2.id);
  assert.equal(b2Links.length, 1, 'Follower b2 should only have 1 controller');
  assert.equal(b2Links[0].controllerId, b3.id, 'Follower b2 controller should now be b3');

  console.log('[4/7] Testing removeFollower (by follower ID directly) unlinks immediately...');
  const linkingAfterRemove = await removeFollower(b2.id, null, companyAId);
  const remainingFollowers = linkingAfterRemove.map(l => l.followerId);
  assert.ok(!remainingFollowers.includes(b2.id), 'Follower b2 must be removed from linking list');

  console.log('[5/7] Testing validation rules (self-link and cross-company rejection)...');
  await assert.rejects(
    () => addFollower(b1.id, b1.id, companyAId),
    /Cannot link a building to itself/,
    'Self-link must be rejected'
  );
  await assert.rejects(
    () => addFollower(b1.id, bOther.id, companyAId),
    /Buildings must belong to your company/,
    'Cross-company link must be rejected'
  );

  // --------------------------------------------------------------------------
  // PART 2: SimBoost Rush V1 Endpoint Testing
  // --------------------------------------------------------------------------
  console.log('\n[6/7] Testing POST /api/v1/rush/:buildingId/ for construction rush...');
  // Credit SimBoosts to company A
  companyRepository.creditSimboosts(companyAId, 100);

  // Set building b1 to under construction (e.g. 10 minutes busy)
  const busyUntilFuture = new Date(virtualClock.nowMs() + 600 * 1000).toISOString();
  db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(busyUntilFuture, b1.id);

  const mockRushConstruction = createMockReqRes();
  const handledConstruction = await handleSimboostRoutes(
    mockRushConstruction.req,
    mockRushConstruction.res,
    `/api/v1/rush/${b1.id}/`,
    'POST',
    playerA.playerId,
    companyAId
  );
  await mockRushConstruction.waitForCompletion();

  assert.equal(handledConstruction, true, 'Route should be handled');
  assert.equal(mockRushConstruction.getStatusCode(), 200, 'Construction rush should return HTTP 200');

  const constructionResponseBody = mockRushConstruction.getBody() as {
    success: boolean;
    sim_boosts_spend: number;
    simBoosts: number;
    newBusy: null;
    achievements: unknown[];
    levelInfo: unknown;
    building: { busy: unknown };
  };

  assert.equal(constructionResponseBody.success, true);
  assert.ok(constructionResponseBody.sim_boosts_spend >= 1, 'Should have positive sim_boosts_spend');
  assert.equal(constructionResponseBody.newBusy, null, 'newBusy must be null on completion');
  assert.ok(Array.isArray(constructionResponseBody.achievements), 'achievements must be array');
  assert.ok(constructionResponseBody.levelInfo !== null, 'levelInfo must be present');

  // Verify DB state
  const b1AfterRush = db.prepare('SELECT busy_until FROM buildings WHERE id = ?').get(b1.id) as { busy_until: string | null };
  assert.equal(b1AfterRush.busy_until, null, 'building busy_until must be cleared to NULL in DB');

  console.log('[7/7] Testing POST /api/v1/rush/:buildingId/ for active production queue rush...');
  // Seed active production queue on b2 (kind: 1, water)
  const queueFinishFuture = new Date(virtualClock.nowMs() + 300 * 1000).toISOString();
  const queueResult = db.prepare(`
    INSERT INTO production_queues (company_id, building_id, kind, amount, duration_seconds, quality, cost, started_at, finishes_at, resolved)
    VALUES (?, ?, 1, 100, 300, 0, 100, ?, ?, 0)
    RETURNING id
  `).get(companyAId, b2.id, virtualClock.nowIso(), queueFinishFuture) as { id: number };
  // Also set building busy_until to queue finishes_at (mimicking start-production behavior)
  db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?').run(queueFinishFuture, b2.id);
  const initialWarehouseWater = warehouseRepository.findByCompanyAndResource(companyAId, 1, 0)?.amount || 0;
  const mockRushProd = createMockReqRes();
  const handledProd = await handleSimboostRoutes(
    mockRushProd.req,
    mockRushProd.res,
    `/api/v1/rush/${b2.id}/`,
    'POST',
    playerA.playerId,
    companyAId
  );
  await mockRushProd.waitForCompletion();

  assert.equal(handledProd, true, 'Production rush route should be handled');
  assert.equal(mockRushProd.getStatusCode(), 200, 'Production rush should return HTTP 200');

  const prodResponseBody = mockRushProd.getBody() as {
    success: boolean;
    sim_boosts_spend: number;
    newBusy: null;
  };
  assert.equal(prodResponseBody.success, true);
  assert.ok(prodResponseBody.sim_boosts_spend >= 1);
  const queueAfterRush = db.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(queueResult.id) as { resolved: number };
  assert.equal(queueAfterRush.resolved, 1, 'Production queue item must be resolved');

  // Verify warehouse received produced resources
  const afterWarehouseWater = warehouseRepository.findByCompanyAndResource(companyAId, 1, 0)?.amount || 0;
  assert.equal(afterWarehouseWater, initialWarehouseWater + 100, 'Warehouse must receive produced goods');
  const mockRushIdle = createMockReqRes();
  await handleSimboostRoutes(
    mockRushIdle.req,
    mockRushIdle.res,
    `/api/v1/rush/${b2.id}/`,
    'POST',
    playerA.playerId,
    companyAId
  );
  await mockRushIdle.waitForCompletion();
  assert.equal(mockRushIdle.getStatusCode(), 400, 'Rushing an idle building must return HTTP 400');

  console.log('\n✔ All Followers Sync & V1 Rush Regression Checks PASSED!');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
