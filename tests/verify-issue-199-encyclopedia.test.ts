/**
 * Issue #199 regression: encyclopedia retail history, resource details,
 * production events, supporter listings, and explicit unavailable modifiers.
 *
 * Runs a real isolated HTTP server with a temporary DATA_DIR. The database is
 * used only to create deterministic persisted fixtures and to verify the
 * mutations caused by the HTTP collect path.
 *
 * Run with Node 22 or newer:
 *   node --experimental-strip-types tests/verify-issue-199-encyclopedia.test.ts
 */
import assert from 'node:assert/strict';
import { withTestServer } from './support/test-server.ts';

const REALM_ID = 0;
const APPLES = 3;

async function runIssue199Verification(): Promise<void> {
  await withTestServer(async server => {
    const BASE_URL = server.baseUrl;
    const db = server.db;
    const user = await server.registerCompany('encyclopedia');
    const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

    // [1] A real completed v2 retail order records persisted sales history,
    // which is then visible in the 28-day encyclopedia chart.
    const grocery = db.prepare(
      "SELECT id FROM buildings WHERE company_id = ? AND kind = 'G' ORDER BY id LIMIT 1"
    ).get(user.companyId) as { id: number } | undefined;
    assert.ok(grocery, 'registered company must have a starter grocery store');
    server.setStock(user.companyId, APPLES, 25, 1.5);

    const createOrder = await fetch(`${BASE_URL}/api/v2/sales-orders/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ building: grocery.id, resource: APPLES, quality: 0, units: 7, sellingPrice: 1.5 })
    });
    const createOrderBody = await createOrder.text();
    assert.equal(createOrder.status, 200, `v2 retail order must be created: ${createOrderBody}`);
    const created = JSON.parse(createOrderBody) as { id?: number; salesOrder?: { id?: number } };
    const orderId = created.id || created.salesOrder?.id || 0;
    assert.ok(orderId > 0, 'v2 retail order response must expose an id');
    // Mark the order complete using a wall-clock-relative timestamp, then use
    // the public v2 collect operation rather than calling the use case directly.
    const finishedAt = new Date(Date.now() - 24 * 60 * 60 * 1000 + 1000).toISOString();
    db.prepare('UPDATE retail_orders SET finished_at = ? WHERE id = ?').run(finishedAt, orderId);
    const collect = await fetch(`${BASE_URL}/api/v2/sales-orders/${orderId}/`, {
      method: 'PUT',
      headers,
      body: '{}'
    });
    const collectBodyText = await collect.text();
    assert.equal(collect.status, 200, `completed retail order must collect: ${collectBodyText}`);
    const collectBody = JSON.parse(collectBodyText) as {
      success?: boolean;
      resource?: { kind: number; quality: number; units: number };
      revenue?: number;
    };
    assert.equal(collectBody.success, true, 'retail collect must succeed');
    assert.deepEqual(collectBody.resource, { kind: APPLES, quality: 0, units: -7 });
    assert.equal(typeof collectBody.revenue, 'number');

    const history = db.prepare(`
      SELECT realm_id, company_id, resource_kind, quality, units, unit_price, revenue, sold_at
      FROM retail_sales_history WHERE company_id = ? ORDER BY id DESC LIMIT 1
    `).get(user.companyId) as {
      realm_id: number; company_id: number; resource_kind: number; quality: number;
      units: number; unit_price: number; revenue: number; sold_at: string;
    } | undefined;
    assert.ok(history, 'collect must persist a retail_sales_history row');
    assert.equal(history.realm_id, REALM_ID);
    assert.equal(history.company_id, user.companyId);
    assert.equal(history.resource_kind, APPLES);
    assert.equal(history.quality, 0);
    assert.equal(history.units, 7);
    assert.equal(typeof history.unit_price, 'number');
    assert.equal(typeof history.revenue, 'number');
    assert.ok(Number.isFinite(Date.parse(history.sold_at)), 'sold_at must be a valid timestamp');

    const retailResponse = await fetch(`${BASE_URL}/api/v4/${REALM_ID}/resources-retail-info/`);
    assert.equal(retailResponse.status, 200);
    const retailInfo = (await retailResponse.json()) as Array<{
      dbLetter: number;
      retailData: Array<{
        date: string;
        demand: number;
        amountSold: number;
        amountSoldRestaurant: number;
      }>;
    }>;
    assert.equal(retailInfo.length, 57, 'retail encyclopedia must expose 57 resources');
    const applesRetail = retailInfo.find(resource => resource.dbLetter === APPLES);
    assert.ok(applesRetail, 'retail encyclopedia must include Apples');
    assert.equal(applesRetail.retailData.length, 28, 'Apples must expose 28 dated retail rows');
    assert.ok(applesRetail.retailData.every(row =>
      typeof row.date === 'string' && Number.isFinite(Date.parse(row.date)) &&
      typeof row.demand === 'number' && Number.isFinite(row.demand) &&
      typeof row.amountSold === 'number' && Number.isFinite(row.amountSold) &&
      typeof row.amountSoldRestaurant === 'number' && Number.isFinite(row.amountSoldRestaurant)
    ), 'retail rows must contain dated numeric demand and sales fields');
    const yesterdayRow = applesRetail.retailData.find(row => row.date === new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    assert.ok(yesterdayRow, 'retail history must include the latest completed UTC date');
    assert.equal(yesterdayRow.amountSold, 7, 'retail history must include the collected sale');

    // [2] Resource details preserve canonical client-facing Apples fields and
    // unknown resources fail with the official API_NOT_FOUND contract.
    const detailResponse = await fetch(`${BASE_URL}/api/v4/${REALM_ID}/encyclopedia/resources/${APPLES}/`);
    assert.equal(detailResponse.status, 200);
    const applesDetail = (await detailResponse.json()) as Record<string, unknown>;
    assert.deepEqual({
      dbLetter: applesDetail.dbLetter,
      name: applesDetail.name,
      producedAt: applesDetail.producedAt,
      producedFrom: applesDetail.producedFrom,
      producedPerHourRaw: applesDetail.producedPerHourRaw,
      image: applesDetail.image,
      transportation: applesDetail.transportation,
      isExchangeTradable: applesDetail.isExchangeTradable,
      unitsSoldAnHour: applesDetail.unitsSoldAnHour,
      decay: applesDetail.decay,
      quality: applesDetail.quality
    }, {
      dbLetter: APPLES,
      name: 'Apples',
      producedAt: 'P',
      producedFrom: { '2': 3, '66': 1 },
      producedPerHourRaw: 250,
      image: 'images/resources/apples.png',
      transportation: 1,
      isExchangeTradable: true,
      unitsSoldAnHour: 110,
      decay: 0,
      quality: 0
    });

    const grapesDetail = await fetch(`${BASE_URL}/api/v4/${REALM_ID}/encyclopedia/resources/5/`);
    assert.equal(grapesDetail.status, 200);
    assert.equal((await grapesDetail.json() as { name?: string }).name, 'Grapes');

    const unknownDetail = await fetch(`${BASE_URL}/api/v4/${REALM_ID}/encyclopedia/resources/999999/`);
    assert.equal(unknownDetail.status, 404);
    const unknownBody = (await unknownDetail.json()) as { code?: string };
    assert.equal(unknownBody.code, 'API_NOT_FOUND');

    // [3] One active persisted event is returned through both exact wrappers.
    const eventSince = new Date(Date.now() - 60_000).toISOString();
    const eventUntil = new Date(Date.now() + 60 * 60_000).toISOString();
    const event = {
      id: 199001,
      realm: REALM_ID,
      kind: APPLES,
      speedModifier: 17,
      since: eventSince,
      until: eventUntil
    };
    db.prepare(`
      INSERT INTO encyclopedia_resource_events (id, realm_id, kind, speed_modifier, since, until)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.id, event.realm, event.kind, event.speedModifier, event.since, event.until);

    const eventsResponse = await fetch(`${BASE_URL}/api/v3/encyclopedia/events/${REALM_ID}/`);
    assert.equal(eventsResponse.status, 200);
    assert.deepEqual(await eventsResponse.json(), { events: [event] });

    const modifiersResponse = await fetch(`${BASE_URL}/api/v2/production-modifiers/${REALM_ID}/`);
    assert.equal(modifiersResponse.status, 200);
    assert.deepEqual(await modifiersResponse.json(), { resourceProductionModifiers: [event] });

    // [4] Supporters are backed by persisted certificates and include every
    // official listing field, rather than an empty/generic response.
    const supporterStartedAt = new Date(Date.now() - 30_000).toISOString();
    db.prepare(
      'UPDATE companies SET supporter_certificates = 1, supporter_started_at = ? WHERE company_id = ?'
    ).run(supporterStartedAt, user.companyId);
    const supportersResponse = await fetch(`${BASE_URL}/api/v3/encyclopedia/supporters/${REALM_ID}/`);
    assert.equal(supportersResponse.status, 200);
    const supportersBody = (await supportersResponse.json()) as { supporters?: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(supportersBody.supporters));
    const supporter = supportersBody.supporters.find(entry => entry.id === user.companyId);
    assert.ok(supporter, 'certificate-backed company must appear in supporters');
    for (const field of ['id', 'company', 'realmId', 'logo', 'level', 'levelName', 'note', 'rank', 'rating', 'dateJoined']) {
      assert.ok(Object.hasOwn(supporter, field), `supporter entry must include official field ${field}`);
    }
    assert.equal(supporter.realmId, REALM_ID);
    assert.equal(supporter.dateJoined, supporterStartedAt);
    assert.equal(typeof supporter.company, 'string');
    assert.equal(typeof supporter.levelName, 'string');
    assert.equal(typeof supporter.rank, 'number');

    // [5] Deliberately unavailable modifier APIs are explicit 501 stubs.
    for (const endpoint of [
      `/api/v2/industry-modifiers/${REALM_ID}/`,
      `/api/v2/realm-modifiers/${REALM_ID}/`
    ]) {
      const response = await fetch(`${BASE_URL}${endpoint}`);
      assert.equal(response.status, 501, `${endpoint} must return 501`);
      assert.equal(response.headers.get('x-backend-stub'), 'true', `${endpoint} must identify the backend stub`);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, 'BACKEND_UNAVAILABLE');
    }
  });
}

runIssue199Verification().catch(error => {
  console.error('Issue #199 encyclopedia verification failed:', error);
  process.exit(1);
});
