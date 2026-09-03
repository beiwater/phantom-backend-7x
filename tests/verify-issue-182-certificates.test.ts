import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/connection.ts';
import {
  getCertificateCatalog,
  getCertificateDetail,
  getCompanyCertificates,
  getLatestCertificates,
  getRarestCertificates,
  grantCycleCertificates
} from '../server/game/certificates.ts';
import '../server/routes/achievement-routes.ts';
import { globalRouteRegistry } from '../server/http/route-registry.ts';

const company = db.prepare('SELECT company_id, realm_id FROM companies ORDER BY company_id LIMIT 1').get() as {
  company_id: number;
  realm_id: number;
};
const realmId = Number(company.realm_id);
const companyId = Number(company.company_id);
const cycleStart = new Date('2037-02-01T00:00:00.000Z');
const cycleEnd = new Date('2037-03-01T00:00:00.000Z');
const building = db.prepare('SELECT id FROM buildings WHERE company_id = ? ORDER BY id LIMIT 1').get(companyId) as { id: number } | undefined;

// Isolate this cycle while retaining the catalog and the rest of the realm.
db.prepare('DELETE FROM certificates WHERE realm_id = ?').run(realmId);
db.prepare('DELETE FROM production_queues WHERE company_id = ? AND started_at >= ? AND started_at < ?')
  .run(companyId, cycleStart.toISOString(), cycleEnd.toISOString());
db.prepare('DELETE FROM retail_orders WHERE company_id = ? AND created_at >= ? AND created_at < ?')
  .run(companyId, cycleStart.toISOString(), cycleEnd.toISOString());

const buildingId = building?.id ?? 0;
db.prepare(`
  INSERT INTO production_queues (
    building_id, company_id, kind, quality, cost, amount, duration_seconds,
    started_at, finishes_at, resolved, economy_phase, economy_source,
    production_modifier, production_output_multiplier
  ) VALUES (?, ?, 3, 0, 2, 500, 3600, ?, ?, 1, 1, 'test', 0, 1)
`).run(
  buildingId,
  companyId,
  cycleStart.toISOString(),
  new Date(cycleStart.getTime() + 3600 * 1000).toISOString()
);
db.prepare(`
  INSERT INTO retail_orders (
    building_id, company_id, resource_kind, quality, units, unit_price,
    cost, finished_at, created_at, economy_phase, economy_source
  ) VALUES (?, ?, 3, 0, 250, 4, 1000, ?, ?, 1, 'test')
`).run(
  buildingId,
  companyId,
  new Date(cycleStart.getTime() + 3600 * 1000).toISOString(),
  new Date(cycleStart.getTime() + 1800 * 1000).toISOString()
);

const catalog = getCertificateCatalog();
assert.ok(catalog.length >= 30);
assert.ok(catalog.some(kind => kind.kind === 29 && kind.name === 'King Midas'));
assert.ok(catalog.some(kind => kind.kind === 39 && kind.awardRule === 'retail'));
assert.ok(catalog.some(kind => kind.kind === 41 && kind.awardRule === 'production'));

const firstGrant = grantCycleCertificates(realmId, cycleStart, cycleEnd);
assert.ok(firstGrant.issued.length >= 3, 'cycle activity should issue overall, production, and retail certificates');
const countAfterFirst = (db.prepare('SELECT COUNT(*) AS count FROM certificates WHERE realm_id = ?').get(realmId) as { count: number }).count;
const secondGrant = grantCycleCertificates(realmId, cycleStart, cycleEnd);
const countAfterSecond = (db.prepare('SELECT COUNT(*) AS count FROM certificates WHERE realm_id = ?').get(realmId) as { count: number }).count;
assert.equal(countAfterSecond, countAfterFirst, 'replaying a cycle must not duplicate awards');
assert.equal(secondGrant.issued.length, firstGrant.issued.length);

const latest = getLatestCertificates(realmId);
const rarest = getRarestCertificates(realmId);
const companyCertificates = getCompanyCertificates(companyId);
assert.ok(latest.length >= firstGrant.issued.length);
assert.ok(rarest.length >= firstGrant.issued.length);
assert.ok(companyCertificates.length >= firstGrant.issued.length);
const productionAward = firstGrant.issued.find(award => award.kind === 41 && award.resourceKind === 3);
assert.ok(productionAward);
const detail = getCertificateDetail(realmId, 41, productionAward!.id, 3);
assert.equal(detail?.certificate.kind, 41);
assert.equal(detail?.certificate.id, productionAward!.id);
assert.equal(detail?.certificate.resourceKind, 3);
assert.equal((detail?.certificate.quantity as number) > 0, true);
assert.equal(getCertificateDetail(realmId, 99999, '-', '-'), null);
assert.equal(getCertificateDetail(realmId, 41, 999999999, 3), null);

async function dispatch(pathname: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const req = new EventEmitter() as IncomingMessage;
  Object.assign(req, { url: pathname, method: 'GET', headers: {}, resume: () => req });
  const response = { status: 0, body: '' };
  const res = {
    setHeader() {},
    writeHead(status: number) { response.status = status; },
    end(body?: unknown) { response.body = body === undefined ? '' : String(body); },
    getHeader() { return undefined; }
  } as unknown as ServerResponse;
  assert.equal(await globalRouteRegistry.dispatch(req, res, pathname, 'GET', null), true);
  return { status: response.status, payload: JSON.parse(response.body) as Record<string, unknown> };
}

const latestApi = await dispatch(`/api/v2/certificates-explorer/${realmId}/latest/`);
assert.equal(latestApi.status, 200);
assert.ok((latestApi.payload.latestCertificates as unknown[]).length >= firstGrant.issued.length);
const detailApi = await dispatch(`/api/v2/certificates-explorer/${realmId}/certificate/41/${productionAward!.id}/3/`);
assert.equal(detailApi.status, 200);
assert.equal((detailApi.payload.certificate as { id: number }).id, productionAward!.id);
const missingApi = await dispatch(`/api/v2/certificates-explorer/${realmId}/certificate/41/999999999/3/`);
assert.equal(missingApi.status, 404);
console.log('PASS certificate catalog, idempotent cycle grants, company data, and details (#182)');
