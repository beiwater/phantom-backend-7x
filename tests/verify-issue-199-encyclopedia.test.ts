/**
 * Issue #199 regression: encyclopedia retail history, resource details,
 * production events, supporter listings, and explicit unavailable modifiers.
 *
 * Runs a real isolated HTTP server with a temporary DATA_DIR. The database is
 * used only to create deterministic persisted fixtures and to verify the
 * mutations caused by the HTTP collect path.
 *
 * Run with Node 22:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-199-encyclopedia.test.ts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3999');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const REALM_ID = 0;
const APPLES = 3;

function isPortAvailable(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const tester = net.createServer()
    .once('error', () => resolve(false))
    .once('listening', () => {
      tester.once('close', () => resolve(true)).close();
    })
    .listen(port, '127.0.0.1');
  return promise;
}

// This polls the separately spawned server using wall-clock time. The server
// has its own process and cannot be advanced by a parent test clock.
async function waitUntilReachable(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404 || response.status === 200) return;
    } catch {
      // The child may still be starting; retry below.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ServerInstance {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
}

async function startTestServer(): Promise<ServerInstance> {
  assert.ok(await isPortAvailable(TEST_PORT), `Port ${TEST_PORT} is not available for testing`);

  const dataDir = path.resolve('data', `test-run-issue-199-${RUN_ID}`);
  const nodeBinary = existsSync('/opt/magnate/.node22/bin/node')
    ? '/opt/magnate/.node22/bin/node'
    : process.execPath;
  const child = spawn(
    nodeBinary,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATA_DIR: dataDir
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', chunk => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) process.stderr.write(`[server-${TEST_PORT}] ${text}`);
  });
  await waitUntilReachable(`${BASE_URL}/version/`);
  return { child, dataDir, dbPath: path.join(dataDir, 'simcompanies.sqlite') };
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>(resolve => child.once('exit', () => resolve())),
    sleep(timeoutMs)
  ]);
}

async function stopTestServer(server: ServerInstance): Promise<void> {
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill('SIGTERM');
    await waitForChildExit(server.child, 5000);
    if (server.child.exitCode === null && server.child.signalCode === null) {
      server.child.kill('SIGKILL');
      await waitForChildExit(server.child, 2000);
    }
  }
  // The child is fully stopped before its temporary database is removed.
  if (existsSync(server.dataDir)) rmSync(server.dataDir, { recursive: true, force: true });
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const unique = `${RUN_ID}-${label}`;
  const response = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `issue199_${unique}@domain.local`,
      password: 'Password123!',
      company: `Issue 199 ${label} ${unique}`
    })
  });
  assert.equal(response.status, 200, 'company registration must return 200');
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(value => value.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'registration must return a session cookie');

  const authResponse = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(authResponse.status, 200, 'auth-data must return 200');
  const auth = (await authResponse.json()) as { authCompany?: { companyId?: number; id?: number } };
  const companyId = auth.authCompany?.companyId || auth.authCompany?.id || 0;
  assert.ok(companyId > 0, 'registration must expose a company id');
  return { cookie, companyId };
}

async function runIssue199Verification(): Promise<void> {
  let server: ServerInstance | null = null;
  let db: DatabaseSync | null = null;
  try {
    server = await startTestServer();
    db = new DatabaseSync(server.dbPath);
    const user = await registerCompany('encyclopedia');
    const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

    // [1] A real completed v2 retail order records persisted sales history,
    // which is then visible in the 28-day encyclopedia chart.
    const grocery = db.prepare(
      "SELECT id FROM buildings WHERE company_id = ? AND kind = 'G' ORDER BY id LIMIT 1"
    ).get(user.companyId) as { id: number } | undefined;
    assert.ok(grocery, 'registered company must have a starter grocery store');
    const now = new Date();
    const nowIso = now.toISOString();
    const applesStock = db.prepare(
      'SELECT id FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 0 ORDER BY id LIMIT 1'
    ).get(user.companyId, APPLES) as { id: number } | undefined;
    if (applesStock) {
      db.prepare('UPDATE warehouse SET amount = amount + 25, updated_at = ? WHERE id = ?').run(nowIso, applesStock.id);
    } else {
      db.prepare(`
        INSERT INTO warehouse
          (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
        VALUES (?, ?, 0, 25, 0, 0, 0, 0, 1.5, ?)
      `).run(user.companyId, APPLES, nowIso);
    }

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
  } finally {
    db?.close();
    if (server) await stopTestServer(server);
  }
}

runIssue199Verification().catch(error => {
  console.error('Issue #199 encyclopedia verification failed:', error);
  process.exit(1);
});
