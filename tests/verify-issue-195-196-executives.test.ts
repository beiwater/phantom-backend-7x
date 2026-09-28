import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { handleExecutiveRoutes } from '../server/routes/executive-routes.ts';
import { executiveRepository } from '../server/repositories/executive-repository.ts';
import { formatOffer, formatHostileOffer } from '../server/application/executives/executive-use-cases.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface DispatchResult {
  status: number;
  body: Record<string, unknown>;
}

async function dispatch(url: string, method: string = 'GET', companyId: number): Promise<DispatchResult> {
  const req = { url, method, headers: {} } as unknown as IncomingMessage;
  let status = 200;
  let responseData = '';
  const res = {
    statusCode: 200,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(code: number) { status = code; },
    end(chunk?: unknown) { if (chunk) responseData = String(chunk); }
  } as unknown as ServerResponse;

  const parsed = new URL(url, 'http://127.0.0.1');
  const handled = await handleExecutiveRoutes(req, res, parsed.pathname, method, companyId);
  assert.ok(handled, `route must be handled: ${url}`);
  return { status, body: responseData ? (JSON.parse(responseData) as Record<string, unknown>) : {} };
}

db.prepare("DELETE FROM companies WHERE name = 'Exec Issue Co'").run();
const fixture = await FixtureService.applyScenario({
  company: { name: 'Exec Issue Co', level: 15, money: 1000000 }
});
const companyId = fixture.companyId;
executiveRepository.seedDefaults(companyId);
const employedExecs = db.prepare("SELECT * FROM executives WHERE company_id = ? AND status = 'employed'").all(companyId) as Array<{ id: number; name: string; position: string }>;
assert.ok(employedExecs.length > 0, 'must have employed executives');
const elena = employedExecs.find(e => e.name.includes('Elena')) || employedExecs[0];

// 1. Verify Issue #195: GET /api/v4/executives/:id/ returns complete executive detail DTO
const elenaRes = await dispatch(`/api/v4/executives/${elena.id}/`, 'GET', companyId);
assert.equal(elenaRes.status, 200);
const execData = elenaRes.body;

// Root fields required by frontend component
assert.equal(execData.id, elena.id);
assert.ok(Array.isArray(execData.trainings), 'trainings must be an array to prevent .filter() crash');
assert.ok(Array.isArray(execData.achievements), 'achievements must be an array to prevent reducer spread crash');
assert.ok(typeof execData.genome === 'string' && execData.genome.length > 0, 'genome must be present');
assert.ok(typeof execData.age === 'number' && !isNaN(execData.age), 'age must be a valid number');
assert.ok(typeof execData.position === 'string');
assert.ok(execData.skills && typeof execData.skills === 'object');

// Backward compatibility: must also carry .executive object
assert.ok(execData.executive && typeof execData.executive === 'object');
const innerExec = execData.executive as Record<string, unknown>;
assert.equal(innerExec.id, elena.id);

// 2. Verify Issue #196: Candidates list has no NaN
const candsRes = await dispatch('/api/v4/executives/candidates/', 'GET', companyId);
assert.equal(candsRes.status, 200);
const candsRaw = JSON.stringify(candsRes.body);
const candidates = (Array.isArray(candsRes.body) ? candsRes.body : candsRes.body.candidates) as Array<Record<string, unknown>>;
assert.ok(Array.isArray(candidates) && candidates.length > 0);
for (const cand of candidates) {
  assert.ok(typeof cand.expectedSalary === 'number' && !isNaN(cand.expectedSalary) && cand.expectedSalary > 0);
  assert.ok(typeof cand.salary === 'number' && !isNaN(cand.salary) && cand.salary > 0);
  assert.ok(typeof cand.age === 'number' && !isNaN(cand.age));
  assert.ok(typeof cand.totalSkill === 'number' && !isNaN(cand.totalSkill));
}

// 3. Verify Issue #196: Offers have valid datetime and no NaN
const offerId = 99196;
db.prepare('DELETE FROM executive_offers WHERE id = ?').run(offerId);
const nowIso = new Date().toISOString();
db.prepare(`
  INSERT INTO executive_offers (
    id, poacher_company_id, target_company_id, target_executive_id, slot_position, skill_position, agency, expected_salary, salary, agency_fee, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'coo', 'o', 1, 500, 600, 250, 'standing', ?, ?)
`).run(offerId, companyId, companyId, elena.id, nowIso, nowIso);

const rawOffer = db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as any;
const formattedOffer = formatOffer(rawOffer, elena as any);
const hostileOfferRes = await dispatch(
  `/api/v3/companies/executives/hostile-offers/${offerId}/`,
  'GET',
  companyId
);
assert.equal(hostileOfferRes.status, 200, 'Hostile-offer detail route resolves the imported query function');
assert.ok(hostileOfferRes.body.offer, 'Hostile-offer detail includes its offer DTO');
assert.ok(typeof formattedOffer.datetime === 'string', 'offer must have datetime for countdown');
const parsedTime = Date.parse(formattedOffer.datetime);
assert.ok(!isNaN(parsedTime), 'offer datetime must be parseable date');
assert.ok(!isNaN(formattedOffer.agency));
assert.ok(!isNaN(formattedOffer.expectedSalary));
assert.ok(!isNaN(formattedOffer.salary));
assert.ok(!isNaN(formattedOffer.agencyFee));
assert.ok(!JSON.stringify(formattedOffer).includes('NaN'));

// 4. Verify researchPoacher data has means and no NaN
const researchOffer = {
  ...rawOffer,
  research_poacher: JSON.stringify({
    marketSalary: 550,
    acceptingSalary: 525,
    employerCompanyValue: 600000,
    employerAcceptedOffersCount: 2,
    employerRejectedOffersCount: 4,
    employerAcceptedOffersMean: 1.25,
    employerRejectedOffersMean: 1.5
  })
};
const formattedResearch = formatOffer(researchOffer as any, elena as any);
assert.ok(formattedResearch.researchPoacher);
const rp = formattedResearch.researchPoacher as Record<string, number>;
assert.equal(rp.employerAcceptedOffersMean, 1.25);
assert.equal(rp.employerRejectedOffersMean, 1.5);
assert.ok(!isNaN(rp.employerAcceptedOffersMean));
assert.ok(!isNaN(rp.employerRejectedOffersMean));
assert.ok(!JSON.stringify(formattedResearch).includes('NaN'));

// 5. Verify POST fire shares the persisted employment-history transition.
const currentBalance = () => Number((db.prepare('SELECT money FROM companies WHERE company_id = ?')
  .get(companyId) as { money: number }).money);
const moneyBeforeFire = currentBalance();
const fireRes = await dispatch(`/api/v4/executives/${elena.id}/fire/`, 'POST', companyId);
assert.equal(fireRes.status, 200);
assert.equal((fireRes.body as { success: boolean }).success, true);
const moneyAfterFire = currentBalance();
assert.ok(moneyAfterFire < moneyBeforeFire, 'dismissal severance is applied with the transition');
assert.equal(
  (db.prepare(`SELECT COUNT(*) AS count FROM executive_employment_history
    WHERE executive_id = ? AND company_id = ? AND ended_at IS NOT NULL`).get(elena.id, companyId) as { count: number }).count,
  1,
  'the active employment-history row is closed exactly once'
);
assert.ok(!executiveRepository.listByCompany(companyId).some(executive => executive.id === elena.id));

const repeatedFire = await dispatch(`/api/v4/executives/${elena.id}/fire/`, 'POST', companyId);
assert.ok(repeatedFire.status >= 400, 'a repeated fire cannot severance-pay or add a second history entry');
assert.equal(currentBalance(), moneyAfterFire);
assert.equal(
  (db.prepare(`SELECT COUNT(*) AS count FROM executive_employment_history
    WHERE executive_id = ? AND company_id = ? AND ended_at IS NOT NULL`).get(elena.id, companyId) as { count: number }).count,
  1
);

// 6. Verify Former Executives endpoint is owner-scoped and returns the exit.
const formerRes = await dispatch(`/api/v2/companies/${companyId}/former-executives/`, 'GET', companyId);
assert.equal(formerRes.status, 200);
assert.ok(Array.isArray(formerRes.body.executives));
assert.ok((formerRes.body.executives as Array<{ id: number; status: string }>).some(
  executive => executive.id === elena.id && executive.status === 'former'
));
assert.ok(!JSON.stringify(formerRes.body).includes('NaN'));
assert.equal(
  (await dispatch(`/api/v2/companies/${companyId + 1}/former-executives/`, 'GET', companyId)).status,
  401,
  'foreign company former history is rejected'
);

// The legacy DELETE /api/v4/executives/:id/ route must share the same history transition.
const legacyDeleteTarget = employedExecs.find(executive => executive.id !== elena.id);
assert.ok(legacyDeleteTarget, 'fixture must include a second employed executive for legacy DELETE coverage');
const balanceBeforeLegacyDelete = currentBalance();
db.exec(`
  CREATE TRIGGER issue_205_abort_former_transition
  BEFORE UPDATE OF status ON executives
  WHEN OLD.id = ${legacyDeleteTarget.id} AND NEW.status = 'former'
  BEGIN SELECT RAISE(ABORT, 'issue 205 history transition rollback probe'); END;
`);
let failedLegacyDelete: DispatchResult;
try {
  failedLegacyDelete = await dispatch(`/api/v4/executives/${legacyDeleteTarget.id}/`, 'DELETE', companyId);
} finally {
  db.exec('DROP TRIGGER issue_205_abort_former_transition');
}
assert.ok(failedLegacyDelete!.status >= 400, 'failed departure persistence rejects the transition');
assert.equal(currentBalance(), balanceBeforeLegacyDelete, 'failed history transition rolls back severance');
assert.equal(
  (db.prepare("SELECT status FROM executives WHERE id = ? AND company_id = ?").get(legacyDeleteTarget.id, companyId) as { status: string }).status,
  'employed',
  'failed history transition leaves the executive employed'
);
assert.equal(
  (db.prepare(`SELECT COUNT(*) AS count FROM executive_employment_history
    WHERE executive_id = ? AND company_id = ? AND ended_at IS NULL`).get(legacyDeleteTarget.id, companyId) as { count: number }).count,
  1,
  'failed transition preserves its open employment history'
);
const legacyDelete = await dispatch(`/api/v4/executives/${legacyDeleteTarget.id}/`, 'DELETE', companyId);
assert.equal(legacyDelete.status, 200);
assert.equal((legacyDelete.body as { success: boolean }).success, true);
assert.equal(
  (db.prepare(`SELECT COUNT(*) AS count FROM executive_employment_history
    WHERE executive_id = ? AND company_id = ? AND ended_at IS NOT NULL`)
    .get(legacyDeleteTarget.id, companyId) as { count: number }).count,
  1,
  'legacy DELETE closes the employment history exactly once'
);
const legacyDeleteRepeat = await dispatch(`/api/v4/executives/${legacyDeleteTarget.id}/`, 'DELETE', companyId);
assert.ok(legacyDeleteRepeat.status >= 400, 'legacy DELETE repeat cannot apply severance twice');
assert.equal(
  (db.prepare(`SELECT COUNT(*) AS count FROM executive_employment_history
    WHERE executive_id = ? AND company_id = ? AND ended_at IS NOT NULL`)
    .get(legacyDeleteTarget.id, companyId) as { count: number }).count,
  1
);
const allFormerAfterLegacyDelete = await dispatch(`/api/v2/companies/${companyId}/former-executives/`, 'GET', companyId);
assert.equal(allFormerAfterLegacyDelete.status, 200);
assert.ok((allFormerAfterLegacyDelete.body.executives as Array<{ id: number }>).some(
  executive => executive.id === legacyDeleteTarget.id
));

console.log('PASS executive details (#195), candidate/offer DTOs (#196), and former history fire/read (#205)');
