import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/connection.ts';
import { getAuthData, getCompanyById, getCompanyByPlayerId } from '../server/game/company.ts';
import { computeLevelInfo } from '../server/domain/leveling/level-rules.ts';
import '../server/routes/auth-routes.ts';
import '../server/routes/building-routes.ts';
import { globalRouteRegistry } from '../server/http/route-registry.ts';

// Helper to dispatch mock HTTP requests through globalRouteRegistry
async function dispatch(
  pathname: string,
  method: string = 'GET',
  cookie?: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = pathname;
  req.headers = {
    host: '127.0.0.1:3000',
    ...(cookie ? { cookie } : {})
  };

  let status = 200;
  const headers: Record<string, string> = {};
  let rawBody = '';

  const res = new EventEmitter() as ServerResponse;
  res.statusCode = 200;
  res.setHeader = (key: string, value: string) => {
    headers[key.toLowerCase()] = String(value);
    return res;
  };
  res.getHeader = (key: string) => headers[key.toLowerCase()];
  res.writeHead = (code: number, responseHeaders?: Record<string, string>) => {
    status = code;
    if (responseHeaders) {
      for (const [k, v] of Object.entries(responseHeaders)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    return res;
  };
  res.end = (chunk?: unknown) => {
    if (chunk !== undefined) {
      rawBody += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
    }
    return res;
  };

  const handled = await globalRouteRegistry.dispatch(req, res, pathname, method);
  assert.equal(handled, true, `Route must be handled: ${method} ${pathname}`);
  return {
    status,
    payload: rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  };
}

function assertValidLevelInfo(levelInfo: unknown, label: string) {
  assert.ok(levelInfo && typeof levelInfo === 'object', `${label}: levelInfo must be non-null object`);
  const info = levelInfo as Record<string, unknown>;

  assert.equal(typeof info.level, 'number', `${label}: level must be number`);
  assert.equal(typeof info.levelName, 'string', `${label}: levelName must be string`);
  assert.equal(typeof info.ratingCode, 'string', `${label}: ratingCode must be string`);
  assert.equal(typeof info.inTutorial, 'boolean', `${label}: inTutorial must be boolean`);
  assert.equal(typeof info.experience, 'number', `${label}: experience must be number`);
  assert.equal(typeof info.experienceToNextLevel, 'number', `${label}: experienceToNextLevel must be number`);
  assert.equal(typeof info.maxBuildings, 'number', `${label}: maxBuildings must be number`);
  assert.equal(typeof info.timeLimit, 'number', `${label}: timeLimit must be number`);

  assert.ok(info.capabilities && typeof info.capabilities === 'object', `${label}: capabilities must be object`);
  const caps = info.capabilities as Record<string, unknown>;
  assert.equal(typeof caps.scrape, 'boolean', `${label}: capabilities.scrape must be boolean`);
  assert.equal(typeof caps.contracts, 'boolean', `${label}: capabilities.contracts must be boolean`);
  assert.equal(typeof caps.research, 'boolean', `${label}: capabilities.research must be boolean`);
  assert.equal(typeof caps.bonds, 'boolean', `${label}: capabilities.bonds must be boolean`);
  assert.equal(typeof caps.executives, 'boolean', `${label}: capabilities.executives must be boolean`);
  assert.equal(typeof caps.governmentOrders, 'boolean', `${label}: capabilities.governmentOrders must be boolean`);
  assert.equal(typeof caps.hqUpdates, 'boolean', `${label}: capabilities.hqUpdates must be boolean`);
  assert.equal(typeof caps.paUpdates, 'boolean', `${label}: capabilities.paUpdates must be boolean`);
  assert.equal(typeof caps.buildingAuctions, 'boolean', `${label}: capabilities.buildingAuctions must be boolean`);
  assert.equal(typeof caps.seasonal, 'boolean', `${label}: capabilities.seasonal must be boolean`);
  assert.equal(typeof caps.buyOrders, 'boolean', `${label}: capabilities.buyOrders must be boolean`);

  assert.ok(info.acceleration && typeof info.acceleration === 'object', `${label}: acceleration must be object`);
  const accel = info.acceleration as Record<string, unknown>;
  assert.equal(typeof accel.multiplier, 'number', `${label}: acceleration.multiplier must be number`);
}

// 1. Acceptance Criteria: frontend-original bundle matches preserved original artifact
console.log('Test 1: Verify frontend-original bundle integrity');
const bundlePath = path.resolve('frontend-original/static/bundle/assets/index-cgzgptQ8.js');
const bundleContent = fs.readFileSync(bundlePath, 'utf8');

// The bundle MUST NOT contain the null-guard patch
assert.ok(
  !bundleContent.includes('inTutorial:e.user.levelInfo?e.user.levelInfo.inTutorial:!1'),
  'Bundle must not contain the levelInfo null-guard patch'
);

// The bundle MUST contain the authentic unpatched code
assert.ok(
  bundleContent.includes('inTutorial:e.user.levelInfo.inTutorial'),
  'Bundle must contain the authentic original code (inTutorial:e.user.levelInfo.inTutorial)'
);

// The patch file 02_user_levelinfo_null_guard.patch must not exist
const patchPath = path.resolve('frontend-patches/02_user_levelinfo_null_guard.patch');
assert.ok(!fs.existsSync(patchPath), 'frontend-patches/02_user_levelinfo_null_guard.patch must be removed');

// 2. Acceptance Criteria: Guest auth-data supplies valid levelInfo
console.log('Test 2: Verify guest auth-data levelInfo');
const guestData = getAuthData(null, null);
assert.ok(guestData, 'Guest auth-data must not be null');
assertValidLevelInfo(guestData.levelInfo, 'Guest getAuthData');
assert.equal(guestData.levelInfo.inTutorial, false, 'Guest inTutorial must be false');
assert.equal(guestData.levelInfo.level, 0, 'Guest level must be 0');

// 3. Acceptance Criteria: Missing player or missing company still returns safe valid levelInfo
console.log('Test 3: Verify missing player/company returns safe levelInfo');
const orphanAuth = getAuthData(99999999, 99999999);
assert.ok(orphanAuth, 'Orphan auth-data must not be null');
assertValidLevelInfo(orphanAuth.levelInfo, 'Orphan getAuthData');

// 4. Acceptance Criteria: Authenticated company supplies valid levelInfo
console.log('Test 4: Verify authenticated user auth-data levelInfo');
const testCompany = db.prepare('SELECT company_id, player_id FROM companies LIMIT 1').get() as { company_id: number; player_id: number } | undefined;
if (testCompany) {
  const authData = getAuthData(testCompany.player_id, testCompany.company_id);
  assert.ok(authData, 'Authenticated auth-data must not be null');
  assertValidLevelInfo(authData.levelInfo, 'Authenticated getAuthData');
  assert.equal(typeof authData.levelInfo.inTutorial, 'boolean');
}

// 5. Acceptance Criteria: /api/v3/companies/auth-data/ endpoint contract
console.log('Test 5: Verify GET /api/v3/companies/auth-data/ endpoint');
const guestRes = await dispatch('/api/v3/companies/auth-data/');
assert.equal(guestRes.status, 200);
assertValidLevelInfo(guestRes.payload.levelInfo, 'GET /api/v3/companies/auth-data/');

// 6. Acceptance Criteria: /api/v1/realm/:realmId/sync/ endpoint contract
console.log('Test 6: Verify GET /api/v1/realm/:realmId/sync/ endpoint');
const syncRes = await dispatch('/api/v1/realm/0/sync/');
assert.equal(syncRes.status, 200);
assertValidLevelInfo(syncRes.payload.levelInfo, 'GET /api/v1/realm/0/sync/');

console.log('ALL ISSUE #61 VERIFICATION CHECKS PASSED!');
