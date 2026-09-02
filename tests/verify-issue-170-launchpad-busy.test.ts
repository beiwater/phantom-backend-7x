/**
 * Issue #170: Launch Pad L1 launch via the original client contract.
 *
 * The original frontend models a rocket launch as a production order of
 * Aerospace Research (kind 100) submitted to the generic busy/queue
 * endpoints — 400 units = Sub-Orbital Rocket (91), 2800 units = BFR (94).
 * It never calls the auxiliary /api/v1/launch-pad/ endpoints.
 *
 * Verifies:
 *  1. POST /api/v1/busy/:id/ {kind:100, amount:400} on a level-1 pad is
 *     accepted (no QUEUE_DURATION_LIMIT rejection) and consumes 1 rocket
 *     + 400 research.
 *  2. The launch appears in the building queue GET as a kind-100 item.
 *  3. Cancelling a pending launch refunds rocket + research.
 *  4. Collecting a finished launch (POST /api/v2/order/take/:buildingId/)
 *     resolves it exactly once — logs rocket_launches, produces no
 *     research resource, and clears the pad.
 *  5. BFR (amount 2800) is rejected on a level-1 pad (min level 3).
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = 3641;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        server.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

async function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`);
}

interface ServerInstance {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
}

async function startTestServer(): Promise<ServerInstance> {
  const portAvailable = await isPortAvailable(TEST_PORT);
  assert.ok(portAvailable, `Port ${TEST_PORT} is not available for testing`);

  const dataDir = path.resolve('data', `test-run-issue-170-${Date.now()}`);
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
        DATA_DIR: dataDir,
        SPEED_MULTIPLIER: '100'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3641] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(): Promise<{ cookie: string; companyId: number }> {
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `lp170_${Date.now()}@test.local`, password: 'test-password-1' })
  });
  assert.equal(res.status, 200, 'Company registration must succeed');
  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');

  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  const authData = (await authRes.json()) as {
    companyPublicInfo?: { id: number };
    authCompany?: { companyId?: number; id?: number };
  };
  const companyId = authData.companyPublicInfo?.id || authData.authCompany?.companyId || authData.authCompany?.id || 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId };
}

interface QueueItemDTO {
  id: number;
  kind: number;
  quality: number;
  amount: number;
  duration: number;
  started: string;
  finishes: string;
}

async function runVerification() {
  console.log('================================================================');
  console.log(' Issue #170: Launch Pad busy-contract verification');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    const db = new DatabaseSync(server.dbPath);

    const { cookie, companyId } = await registerCompany();
    console.log(`✔ Registered test company (ID: ${companyId})`);

    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    const now = new Date().toISOString();
    const insertBuilding = db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, 'r1', 'l', 1, 'Launch Pad', 124200, 'research', ?)
    `).run(companyId, now);
    const buildingId = Number(insertBuilding.lastInsertRowid);

    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 91, 0, 10, 0, 0, 0, 0, 1000.0, ?)
    `).run(companyId, now);
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 100, 0, 50000, 0, 0, 0, 0, 10.0, ?)
    `).run(companyId, now);
    console.log(`✔ Created L1 Launch Pad #${buildingId} + stocked rockets/research`);

    // ---- 1. busy POST with the original launch contract (amount 400) ----
    const busyRes = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 100, amount: 400, limitQuality: null })
    });
    const busyBody = (await busyRes.json()) as { error?: string; message?: string; building?: { busy?: unknown } };
    assert.equal(busyRes.status, 200, `busy launch must be accepted, got ${busyRes.status}: ${JSON.stringify(busyBody)}`);
    assert.ok(busyBody.building?.busy, 'busy response must carry the launch busy object');
    console.log('  ✔ POST /api/v1/busy/:id/ {kind:100, amount:400} accepted — no queue-duration rejection');

    const rocketAfter = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 91').get(companyId) as { amount: number };
    const researchAfter = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100').get(companyId) as { amount: number };
    assert.equal(rocketAfter.amount, 9, '1 rocket must be consumed');
    assert.equal(researchAfter.amount, 49600, '400 research must be consumed');
    console.log('  ✔ Inventory: 1 rocket + 400 research consumed');

    // ---- 2. launch visible in queue GET ----
    const queueRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers });
    assert.equal(queueRes.status, 200);
    const queue = (await queueRes.json()) as QueueItemDTO[];
    assert.equal(queue.length, 1, 'queue must list the launch order');
    assert.equal(queue[0].kind, 100);
    assert.equal(queue[0].amount, 400);
    const launchId = queue[0].id;
    console.log(`  ✔ Queue GET lists launch order #${launchId} (kind 100, amount 400)`);

    // ---- 3. cancel pending launch refunds rocket + research ----
    const cancelRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/${launchId}/`, {
      method: 'DELETE',
      headers
    });
    assert.equal(cancelRes.status, 200, 'pending launch cancel must return 200');
    const rocketAfterCancel = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 91').get(companyId) as { amount: number };
    const researchAfterCancel = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100').get(companyId) as { amount: number };
    assert.equal(rocketAfterCancel.amount, 10, 'rocket refunded on cancel');
    assert.equal(researchAfterCancel.amount, 50000, 'research refunded on cancel');
    console.log('  ✔ Cancelling the pending launch refunds rocket + research');

    // ---- 4. finished launch resolves via order/take exactly once ----
    const busy2Res = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 100, amount: 400, limitQuality: null })
    });
    assert.equal(busy2Res.status, 200, 'second launch must be accepted');
    const queue2 = (await (await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers })).json()) as QueueItemDTO[];
    assert.equal(queue2.length, 1);
    // Fast-forward the launch into the past, as the scheduler would after 128h.
    db.prepare("UPDATE production_queues SET finishes_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), queue2[0].id);

    const takeRes = await fetch(`${BASE_URL}/api/v2/order/take/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    const takeBody = (await takeRes.json()) as { message?: string; resourceTransactions?: Array<{ amount: number }> };
    assert.equal(takeRes.status, 200, `collect must succeed, got ${takeRes.status}: ${JSON.stringify(takeBody)}`);
    assert.ok(takeBody.message, 'collect response must carry the launch outcome message');
    assert.equal(takeBody.resourceTransactions?.length, 0, 'launch collect must produce no resource');
    const launches = db.prepare('SELECT COUNT(*) AS n FROM rocket_launches WHERE company_id = ?').get(companyId) as { n: number };
    assert.equal(launches.n, 1, 'launch must be logged in rocket_launches');
    const researchFinal = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100').get(companyId) as { amount: number };
    assert.equal(researchFinal.amount, 49600, 'no research output may be produced by a launch collect');

    // Idempotency: second take must fail.
    const take2Res = await fetch(`${BASE_URL}/api/v2/order/take/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    assert.notEqual(take2Res.status, 200, 'double collect of the same launch must be rejected');
    const launchesAfter = db.prepare('SELECT COUNT(*) AS n FROM rocket_launches WHERE company_id = ?').get(companyId) as { n: number };
    assert.equal(launchesAfter.n, 1, 'no duplicate launch log entry');
    console.log(`  ✔ Collect resolves the launch once ("${takeBody.message}"), no research output, idempotent`);

    // ---- 5. BFR on level-1 pad rejected ----
    const busyBfr = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 100, amount: 2800, limitQuality: null })
    });
    assert.equal(busyBfr.status, 400, 'BFR (2800) on L1 pad must be rejected');
    console.log('  ✔ BFR launch (amount 2800) rejected on level-1 pad');

    console.log('================================================================');
    console.log(' All Issue #170 assertions PASSED');
    console.log('================================================================');
  } finally {
    server?.child.kill();
    await new Promise((r) => setTimeout(r, 300));
    if (server) {
      try { rmSync(server.dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

runVerification().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
