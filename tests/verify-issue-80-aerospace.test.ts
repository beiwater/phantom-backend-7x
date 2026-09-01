import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3640');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port, '127.0.0.1');
  });
}

async function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return;
      }
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

  const dataDir = path.resolve('data', `test-run-issue-80-${Date.now()}`);
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
      process.stderr.write(`[server-3640] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number; playerId: number }> {
  const email = `aerospace_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Aero ${label} ${Date.now()}`
    })
  });
  assert.equal(res.status, 200, 'Registration should return 200');

  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.find((v) => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie must be returned');

  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authRes.status, 200, 'Auth data should return 200');
  const authData = (await authRes.json()) as {
    companyPublicInfo?: { id: number };
    authCompany?: { companyId?: number; id?: number };
    player?: { id: number };
    authPlayer?: { playerId?: number; id?: number };
  };

  const companyId = authData.companyPublicInfo?.id || authData.authCompany?.companyId || authData.authCompany?.id || 0;
  const playerId = authData.player?.id || authData.authPlayer?.playerId || authData.authPlayer?.id || 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId, playerId };
}

async function runAerospaceVerification() {
  console.log('================================================================');
  console.log(' Starting Issue #80: Aerospace Launch Pad & Queue Verification');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('✔ Test server started successfully on port', TEST_PORT);

    const db = new DatabaseSync(server.dbPath);
    // Register test company
    const { cookie, companyId } = await registerCompany('aero_test');
    console.log(`✔ Registered test company (ID: ${companyId})`);

    // Set company level to 20 so no capability gates interfere
    db.prepare('UPDATE companies SET level = 20 WHERE company_id = ?').run(companyId);

    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookie
    };

    // Construct a Launch Pad building at position 'r1' with size (level) 1
    const now = new Date().toISOString();
    const insertBuilding = db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, 'r1', 'l', 1, 'Launch Pad', 124200, 'research', ?)
    `).run(companyId, now);
    const buildingId = Number(insertBuilding.lastInsertRowid);
    console.log(`✔ Created Launch Pad building #${buildingId} (kind 'l', level 1)`);

    // Fund warehouse with rockets and research:
    // - Sub-Orbital Rocket (kind 91, Q0): 50 units
    // - BFR / Heavy Rocket (kind 94, Q0): 50 units
    // - Aerospace Research (kind 100, Q0): 50,000 units
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 91, 0, 50, 0, 0, 0, 0, 1000.0, ?)
    `).run(companyId, now);

    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 94, 0, 50, 0, 0, 0, 0, 5000.0, ?)
    `).run(companyId, now);

    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 100, 0, 50000, 0, 0, 0, 0, 10.0, ?)
    `).run(companyId, now);
    console.log('✔ Stocked warehouse with rockets (91, 94) and Aerospace Research (100)');

    // -------------------------------------------------------------------------
    // TEST 1: Launch Pad Level Requirements - Sub-Orbital Rocket on Level 1
    // -------------------------------------------------------------------------
    console.log('\n[1/7] Testing Sub-Orbital Rocket (91) on Level 1 Launch Pad...');
    const queueSorRes = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rocketKind: 91, quality: 0 })
    });
    const sorData = (await queueSorRes.json()) as {
      id: number;
      finishes: string;
      rocketKind: number;
      status: string;
      duration: number;
    };
    if (queueSorRes.status !== 200 || !sorData.id) {
      console.error('queueSorRes returned:', queueSorRes.status, sorData);
    }
    assert.equal(queueSorRes.status, 200, 'SOR queue on level 1 launch pad must return 200');
    assert.ok(sorData.id > 0, 'Must return a positive launch ID');
    assert.equal(sorData.rocketKind, 91, 'Rocket kind must be 91');
    assert.equal(sorData.status, 'QUEUED', 'Launch status must be QUEUED');
    assert.ok(sorData.finishes, 'Must return finish timestamp');
    // At level 1 with 0% modifier: duration = 128 hours = 460,800 seconds
    assert.equal(sorData.duration, 460800, 'Level 1 launch duration must be 460,800s (128 hours)');

    // Check inventory deductions:
    const stock91After = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 91 AND quality = 0').get(companyId) as { amount: number };
    const stock100After = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100 AND quality = 0').get(companyId) as { amount: number };
    assert.equal(stock91After.amount, 49, '1 Sub-Orbital Rocket must be deducted (50 -> 49)');
    assert.equal(stock100After.amount, 49600, '400 Aerospace Research units must be deducted (50000 -> 49600)');
    console.log('  ✔ SOR successfully queued: 1 rocket & 400 research consumed, status QUEUED');

    // -------------------------------------------------------------------------
    // TEST 2: Launch Pad Level Requirements - BFR (94) requires Level >= 3 (Rejected on Level 1)
    // -------------------------------------------------------------------------
    console.log('\n[2/7] Testing BFR (94) level requirement rejection on Level 1 Launch Pad...');
    const queueBfrLvl1Res = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rocketKind: 94, quality: 0 })
    });
    assert.equal(queueBfrLvl1Res.status, 400, 'BFR launch on level 1 launch pad must be rejected with 400');
    const bfrLvl1Err = await queueBfrLvl1Res.json();
    assert.match(JSON.stringify(bfrLvl1Err), /level 3/i, 'Error message must specify level 3 requirement');

    // Inventory must remain unchanged
    const stock94AfterReject = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 94 AND quality = 0').get(companyId) as { amount: number };
    const stock100AfterReject = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100 AND quality = 0').get(companyId) as { amount: number };
    assert.equal(stock94AfterReject.amount, 50, 'BFR stock must not be deducted on rejection');
    assert.equal(stock100AfterReject.amount, 49600, 'Research stock must not be deducted on rejection');
    console.log('  ✔ BFR rejected on level 1 pad with 400; inventory preserved');

    // -------------------------------------------------------------------------
    // TEST 3: BFR (94) on Upgraded Level 3 Launch Pad & 2,800 Research Consumption
    // -------------------------------------------------------------------------
    console.log('\n[3/7] Testing BFR (94) on Level 3 Launch Pad with 2,800 research consumption...');
    // Upgrade Launch Pad to level 3
    db.prepare('UPDATE buildings SET size = 3 WHERE id = ?').run(buildingId);

    const queueBfrLvl3Res = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rocketKind: 94, quality: 0 })
    });
    assert.equal(queueBfrLvl3Res.status, 200, 'BFR launch on level 3 launch pad must return 200');
    const bfrData = (await queueBfrLvl3Res.json()) as {
      id: number;
      finishes: string;
      rocketKind: number;
      status: string;
      duration: number;
    };
    assert.equal(bfrData.rocketKind, 94, 'Rocket kind must be 94');
    assert.equal(bfrData.status, 'QUEUED', 'Launch status must be QUEUED');
    // At level 3: duration = 128h / 2^(3-1) = 128h / 4 = 32 hours = 115,200 seconds
    assert.equal(bfrData.duration, 115200, 'Level 3 launch duration must be 115,200s (32 hours)');

    const stock94AfterLvl3 = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 94 AND quality = 0').get(companyId) as { amount: number };
    const stock100AfterLvl3 = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100 AND quality = 0').get(companyId) as { amount: number };
    assert.equal(stock94AfterLvl3.amount, 49, '1 BFR rocket must be deducted (50 -> 49)');
    assert.equal(stock100AfterLvl3.amount, 49600 - 2800, '2,800 Aerospace Research units must be deducted (49600 -> 46800)');
    console.log('  ✔ BFR successfully queued: 1 BFR & 2,800 research consumed, duration 32h');

    // -------------------------------------------------------------------------
    // TEST 4: Insufficient Research & Rocket Inventory Rejections
    // -------------------------------------------------------------------------
    console.log('\n[4/7] Testing inventory shortage rejections (insufficient rockets / research)...');
    // Deplete research temporarily to 100 units (< 400 needed)
    db.prepare('UPDATE warehouse SET amount = 100 WHERE company_id = ? AND kind = 100 AND quality = 0').run(companyId);
    const failResearchRes = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rocketKind: 91, quality: 0 })
    });
    assert.equal(failResearchRes.status, 400, 'Launch with insufficient research must fail with 400');
    assert.match(JSON.stringify(await failResearchRes.json()), /insufficient aerospace research/i);

    // Restore research and deplete rocket stock
    db.prepare('UPDATE warehouse SET amount = 40000 WHERE company_id = ? AND kind = 100 AND quality = 0').run(companyId);
    db.prepare('UPDATE warehouse SET amount = 0 WHERE company_id = ? AND kind = 91 AND quality = 0').run(companyId);
    const failRocketRes = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rocketKind: 91, quality: 0 })
    });
    assert.equal(failRocketRes.status, 400, 'Launch with 0 rocket inventory must fail with 400');
    assert.match(JSON.stringify(await failRocketRes.json()), /insufficient rocket inventory/i);

    // Restore rocket stock
    db.prepare('UPDATE warehouse SET amount = 40 WHERE company_id = ? AND kind = 91 AND quality = 0').run(companyId);
    console.log('  ✔ Shortage validations pass: 400 error on insufficient research and missing rocket stock');

    // -------------------------------------------------------------------------
    // TEST 5: Queue Limit (Maximum 30 Queued Launches)
    // -------------------------------------------------------------------------
    console.log('\n[5/7] Testing queue capacity limit of 30 queued launches...');
    // Currently we have 2 queued launches (from test 1 and test 3).
    // Let's queue 28 more launches to reach 30.
    for (let i = 3; i <= 30; i++) {
      const qRes = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rocketKind: 91, quality: 0 })
      });
      assert.equal(qRes.status, 200, `Queueing launch #${i} must succeed`);
    }

    // Now queue has exactly 30 launches. Attempting 31st launch must be rejected with 400.
    const queueOverflowRes = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rocketKind: 91, quality: 0 })
    });
    assert.equal(queueOverflowRes.status, 400, 'Attempting 31st queued launch must fail with 400 (queue full)');
    const overflowErr = await queueOverflowRes.json();
    assert.match(JSON.stringify(overflowErr), /queue is full|maximum 30/i, 'Error message must indicate queue limit reached');
    console.log('  ✔ Queue limit (30) enforced: 31st launch rejected with 400');

    // -------------------------------------------------------------------------
    // TEST 6: GET /api/v2/launch-queue/ - Retrieve Active Launch Queue
    // -------------------------------------------------------------------------
    console.log('\n[6/7] Testing GET /api/v2/launch-queue/ active launch queue retrieval...');
    const queueListRes = await fetch(`${BASE_URL}/api/v2/launch-queue/`, {
      headers
    });
    assert.equal(queueListRes.status, 200, 'GET /api/v2/launch-queue/ must return 200');
    const queueList = (await queueListRes.json()) as Array<{
      id: number;
      buildingId: number;
      rocketKind: number;
      status: string;
      finishes: string;
    }>;
    assert.equal(queueList.length, 30, 'Launch queue must contain exactly 30 active items');
    assert.equal(queueList[0].buildingId, buildingId);
    assert.equal(queueList[0].status, 'QUEUED');
    console.log('  ✔ GET /api/v2/launch-queue/ returned 30 queued launches with valid schema');

    // -------------------------------------------------------------------------
    // TEST 7: DELETE /api/v1/launch-pad/:id/launch/:launchId/ - Launch Cancellation & Refund
    // -------------------------------------------------------------------------
    console.log('\n[7/7] Testing launch cancellation and automatic resource refund...');
    const targetToCancel = queueList[queueList.length - 1];
    const stockSorBeforeCancel = (db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 91 AND quality = 0').get(companyId) as { amount: number }).amount;
    const stock100BeforeCancel = (db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100 AND quality = 0').get(companyId) as { amount: number }).amount;

    const cancelRes = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/${targetToCancel.id}/`, {
      method: 'DELETE',
      headers
    });
    assert.equal(cancelRes.status, 200, 'DELETE /api/v1/launch-pad/:id/launch/:launchId/ must return 200');
    const cancelData = (await cancelRes.json()) as { success: boolean; status: string; refunded: { rocketKind: number; researchPoints: number } };
    assert.equal(cancelData.success, true);
    assert.equal(cancelData.status, 'CANCELLED');

    // Verify refund in warehouse
    const stockSorAfterCancel = (db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 91 AND quality = 0').get(companyId) as { amount: number }).amount;
    const stock100AfterCancel = (db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100 AND quality = 0').get(companyId) as { amount: number }).amount;
    assert.equal(stockSorAfterCancel, stockSorBeforeCancel + 1, '1 rocket must be refunded to warehouse');
    assert.equal(stock100AfterCancel, stock100BeforeCancel + 400, '400 research points must be refunded to warehouse');

    // Verify active queue count decreased to 29
    const queueAfterCancelRes = await fetch(`${BASE_URL}/api/v2/launch-queue/`, { headers });
    const queueAfterCancel = (await queueAfterCancelRes.json()) as unknown[];
    assert.equal(queueAfterCancel.length, 29, 'Active queue count must be 29 after 1 cancellation');

    // Now queueing a 30th launch should succeed again!
    const reQueueRes = await fetch(`${BASE_URL}/api/v1/launch-pad/${buildingId}/launch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rocketKind: 91, quality: 0 })
    });
    assert.equal(reQueueRes.status, 200, 'Queueing a 30th launch after cancellation must succeed');
    console.log('  ✔ Launch cancellation refunded rocket + research items; queue capacity restored to 30');

    // -------------------------------------------------------------------------
    // BONUS: Verify Rocket Launches Statistics Endpoints
    // -------------------------------------------------------------------------
    console.log('\n[Bonus] Testing rocket launches stats endpoints...');
    const statsMeRes = await fetch(`${BASE_URL}/api/v3/rocket-launches/0/me/`, { headers });
    assert.equal(statsMeRes.status, 200);
    const statsMe = (await statsMeRes.json()) as { launches: Record<string, number>; crashes: Record<string, number> };
    assert.ok(statsMe.launches !== undefined && statsMe.crashes !== undefined);

    const statsAllRes = await fetch(`${BASE_URL}/api/v3/rocket-launches/0/all/`);
    assert.equal(statsAllRes.status, 200);
    const statsAll = (await statsAllRes.json()) as { launches: Record<string, number>; crashes: Record<string, number> };
    assert.ok(statsAll.launches !== undefined && statsAll.crashes !== undefined);

    const statsV1Res = await fetch(`${BASE_URL}/api/v1/aerospace-launches/`);
    assert.equal(statsV1Res.status, 200);
    console.log('  ✔ Rocket launch statistics endpoints verified');

    console.log('\n================================================================');
    console.log(' All Issue #80 Aerospace Assertions PASSED with 0 ERRORS!');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      if (existsSync(server.dataDir)) {
        try {
          rmSync(server.dataDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup error
        }
      }
    }
  }
}

runAerospaceVerification().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
