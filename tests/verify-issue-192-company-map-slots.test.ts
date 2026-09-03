import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { computeLevelInfo } from '../server/domain/leveling/level-rules.ts';
import { handleAuthRoutes } from '../server/routes/auth-routes.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface DispatchResponse {
  status: number;
  body: Record<string, unknown>;
}

async function dispatch(url: string, method = 'GET'): Promise<DispatchResponse> {
  const req = { url, method, headers: {} } as unknown as IncomingMessage;
  let status = 200;
  let body = '';
  const res = {
    statusCode: 200,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(code: number) { status = code; },
    end(chunk?: unknown) { if (chunk) body = String(chunk); }
  } as unknown as ServerResponse;

  const parsed = new URL(url, 'http://127.0.0.1');
  const handled = await handleAuthRoutes(req, res, parsed.pathname, method, null);
  assert.ok(handled, `route must be handled: ${url}`);
  return { status, body: body ? (JSON.parse(body) as Record<string, unknown>) : {} };
}
db.prepare("DELETE FROM companies WHERE name LIKE 'Issue 192%'").run();

// 1. Level 50 company with 16 extra building slots (total 30 slots)
const c30 = await FixtureService.applyScenario({
  companyName: 'Issue 192 Level 50 Corp',
  level: 50,
  extraBuildingSlots: 16
});

const info30 = computeLevelInfo({
  level: 50,
  extra_building_slots: 16
});
assert.equal(info30.maxBuildings, 30);
assert.equal(info30.levelName, 'Multinational corporation');

const slug30 = encodeURIComponent('Issue-192-Level-50-Corp');
const res30 = await dispatch(`/api/v3/companies-by-company/0/${slug30}/`);
assert.equal(res30.status, 200);
const pubInfo30 = res30.body.companyPublicInfo as Record<string, unknown>;
assert.equal(pubInfo30.level, 50);
assert.equal(pubInfo30.levelKind, 'MultinationalCorporation');
assert.equal(pubInfo30.extraBuildingSlots, 16);
assert.equal(pubInfo30.maxBuildings, 30, 'Public map must report all 30 unlocked slots');

// 2. Level 20 company with 0 extra slots (10 slots)
const c10 = await FixtureService.applyScenario({
  companyName: 'Issue 192 Level 20 Corp',
  level: 20,
  extraBuildingSlots: 0
});
const slug10 = encodeURIComponent('Issue-192-Level-20-Corp');
const res10 = await dispatch(`/api/v3/companies-by-company/0/${slug10}/`);
assert.equal(res10.status, 200);
const pubInfo10 = res10.body.companyPublicInfo as Record<string, unknown>;
assert.equal(pubInfo10.maxBuildings, 10);
assert.equal(pubInfo10.levelKind, 'LimitedCompany');

// 3. Level 30 company with 6 extra slots (14 + 6 = 20 slots)
const c20 = await FixtureService.applyScenario({
  companyName: 'Issue 192 Level 30 Corp',
  level: 30,
  extraBuildingSlots: 6
});
const slug20 = encodeURIComponent('Issue-192-Level-30-Corp');
const res20 = await dispatch(`/api/v3/companies-by-company/0/${slug20}/`);
assert.equal(res20.status, 200);
const pubInfo20 = res20.body.companyPublicInfo as Record<string, unknown>;
assert.equal(pubInfo20.maxBuildings, 20);
assert.equal(pubInfo20.extraBuildingSlots, 6);

// 4. Parity with GET /api/v2/companies/:id/
const profile30 = await dispatch(`/api/v2/companies/${c30.companyId}/`);
assert.equal(profile30.status, 200);
const pubProfile30 = profile30.body.companyPublicInfo as Record<string, unknown>;
assert.equal(pubProfile30.maxBuildings, 30);
assert.equal(pubProfile30.levelKind, 'MultinationalCorporation');

console.log('PASS public company map reflects all unlocked slots across level and extra slots (#192)');
