import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { executiveRepository } from '../server/repositories/executive-repository.ts';
import { handleExecutiveRoutes } from '../server/routes/executive-routes.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function invokeOfferRoute(companyId: number, body: Record<string, unknown>): Promise<RouteResponse> {
  const request = { headers: {}, method: 'POST' } as unknown as IncomingMessage;
  setPreparsedBody(request, body);

  let status = 0;
  let responseBody = '';
  const headers = new Map<string, unknown>();
  const response = {
    setHeader(name: string, value: unknown) { headers.set(name.toLowerCase(), value); },
    getHeader(name: string) { return headers.get(name.toLowerCase()); },
    writeHead(nextStatus: number) { status = nextStatus; },
    end(value?: string) { responseBody = value || ''; }
  } as unknown as ServerResponse;

  const handled = await handleExecutiveRoutes(
    request,
    response,
    '/api/v2/companies/executives/my-offers/',
    'POST',
    companyId
  );
  assert.equal(handled, true);
  return { status, body: JSON.parse(responseBody) as Record<string, unknown> };
}

const { companyId } = await FixtureService.applyScenario({
  companyName: 'Issue 187 executive offer flow',
  money: 1_000_000,
  level: 30
});
executiveRepository.seedDefaults(companyId);
const candidates = executiveRepository.listCandidates(companyId);
assert.equal(candidates.length, 3);

const requestBody = {
  targetExecutiveId: candidates[0].id,
  agency: 3,
  slotPosition: 'coo',
  skillPosition: 'o'
};
const first = await invokeOfferRoute(companyId, requestBody);
assert.equal(first.status, 200);
assert.equal(first.body.success, true);
assert.equal(first.body.offerId, first.body.id);
assert.equal(first.body.status, 'f');
const firstOfferId = Number(first.body.offerId);
const moneyAfterFirst = Number((db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money);

// A browser retry returns the same offer and does not charge the agency twice.
const retry = await invokeOfferRoute(companyId, requestBody);
assert.equal(retry.status, 200);
assert.equal(retry.body.offerId, firstOfferId);
assert.equal(retry.body.status, 'f');
assert.equal(retry.body.idempotent, true);
assert.equal(Number((db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money), moneyAfterFirst);
assert.equal(
  Number((db.prepare('SELECT COUNT(*) AS count FROM executive_offers WHERE poacher_company_id = ? AND target_executive_id = ?').get(companyId, candidates[0].id) as { count: number }).count),
  1
);

// Insufficient funds is reported before any offer row or cash mutation survives.
db.prepare('UPDATE companies SET money = 0 WHERE company_id = ?').run(companyId);
const insufficient = await invokeOfferRoute(companyId, {
  targetExecutiveId: candidates[1].id,
  agency: 4,
  slotPosition: 'cfo',
  skillPosition: 'f'
});
assert.equal(insufficient.status, 400);
assert.match(String(insufficient.body.error), /insufficient funds/i);
assert.equal(
  Number((db.prepare('SELECT COUNT(*) AS count FROM executive_offers WHERE target_executive_id = ?').get(candidates[1].id) as { count: number }).count),
  0
);
assert.equal(Number((db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money), 0);

// A candidate that was consumed elsewhere returns an explicit business error.
db.prepare("UPDATE executives SET status = 'employed' WHERE id = ?").run(candidates[2].id);
const expired = await invokeOfferRoute(companyId, {
  targetExecutiveId: candidates[2].id,
  agency: 1,
  slotPosition: 'cto',
  skillPosition: 't'
});
assert.equal(expired.status, 400);
assert.match(String(expired.body.error), /no longer available/i);
assert.equal(
  Number((db.prepare('SELECT COUNT(*) AS count FROM executive_offers WHERE target_executive_id = ?').get(candidates[2].id) as { count: number }).count),
  0
);

console.log('PASS executive offer route: stable id/status, atomic failures, candidate expiry, and duplicate-click idempotency (#187)');
