import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3840');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
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

// Polls a separately-spawned OS process over real HTTP; the server's readiness
// is genuinely wall-clock-bound (fake timers cannot advance another process),
// so a real retry delay is required here (ts-no-test-timers exception).
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

  const dataDir = path.resolve('data', `test-run-issue-96-${Date.now()}`);
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
      process.stderr.write(`[server-3840] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `robotics_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Robotics ${label} ${Date.now()}`
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
  };
  const companyId = authData.companyPublicInfo?.id || authData.authCompany?.companyId || authData.authCompany?.id || 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId };
}

function insertBuilding(
  db: DatabaseSync,
  companyId: number,
  position: string,
  kind: string,
  size: number
): number {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, ?, 'Factory', 13800, 'production', ?)
  `).run(companyId, position, kind, size, now);
  return Number(result.lastInsertRowid);
}

function seedResource(
  db: DatabaseSync,
  companyId: number,
  kind: number,
  quality: number,
  amount: number
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, 10.0, ?)
    ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = excluded.amount
  `).run(companyId, kind, quality, amount, now);
}

function robotStock(db: DatabaseSync, companyId: number, quality: number): number {
  const row = db.prepare(
    'SELECT amount FROM warehouse WHERE company_id = ? AND kind = 114 AND quality = ?'
  ).get(companyId, quality) as { amount: number } | undefined;
  return row ? Number(row.amount) : 0;
}

interface RoboticsInfo {
  installed: boolean;
  installedRobots: number;
  installedQuality: number;
  requiredRobots: number;
  requiredQuality: number;
  lockedProduct: number | null;
  wageMultiplier: number;
}

async function getRobotics(cookie: string, buildingId: number): Promise<RoboticsInfo | null> {
  const res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(res.status, 200, 'Building details must return 200');
  const dto = (await res.json()) as { robotics?: RoboticsInfo | null };
  return dto.robotics ?? null;
}

// Decompiled robot requirements for a Factory ('Y', salaryModifier 1.2):
//   robotUnits  = max(1, ceil(raw + (raw - 4.5) * 1.2)), raw = 1.2 * 8694 / 940 = 11.099...  -> 20
//   count(size) = ceil(20 * size);  quality(size) = floor(size / 4)
const FACTORY_ROBOT_UNITS = 20;

async function runRoboticsVerification() {
  console.log('================================================================');
  console.log(' Starting Issue #96: Robotics & Specialization Verification');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('✔ Test server started successfully on port', TEST_PORT);

    const db = new DatabaseSync(server.dbPath);
    const { cookie, companyId } = await registerCompany('main');
    console.log(`✔ Registered test company (ID: ${companyId})`);

    db.prepare('UPDATE companies SET level = 20, money = 1000000 WHERE company_id = ?').run(companyId);

    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    // Test buildings: Factory 'Y' produces resources 16,17,18,43,45,67,69,76,144
    const buildingA = insertBuilding(db, companyId, 'r1', 'Y', 2); // size 2 -> 40 robots @ Q0
    const buildingB = insertBuilding(db, companyId, 'r2', 'Y', 4); // size 4 -> 80 robots @ Q1
    const buildingC = insertBuilding(db, companyId, 'r3', 'Y', 2); // size 2 -> uninstall flow
    console.log(`✔ Created factories #${buildingA} (size 2), #${buildingB} (size 4), #${buildingC} (size 2)`);

    // Initial robot stock: 30x Q0 + 30x Q1; production ingredients for kind 67
    seedResource(db, companyId, 114, 0, 30);
    seedResource(db, companyId, 114, 1, 30);
    seedResource(db, companyId, 17, 0, 50);
    seedResource(db, companyId, 19, 0, 50);
    // Upgrade materials (any surplus) for the post-uninstall upgrade test
    for (const kind of [101, 102, 108, 111]) {
      seedResource(db, companyId, kind, 0, 5000);
    }
    console.log('✔ Seeded warehouse: robots (114) Q0x30 + Q1x30, ingredients & materials');

    // -------------------------------------------------------------------------
    // TEST 1: Installation validation errors
    // -------------------------------------------------------------------------
    console.log('\n[1/6] Installation validation errors...');
    let res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/install-robots/`, {
      method: 'POST', headers, body: JSON.stringify({})
    });
    assert.equal(res.status, 400, 'Install without a product kind must be rejected with 400');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/install-robots/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 1 }) // kind 1 is produced in 'M', not 'Y'
    });
    assert.equal(res.status, 400, 'Install with a non-producible product must be rejected with 400');
    let err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'ROBOTICS_INVALID_PRODUCT', 'Invalid product must carry ROBOTICS_INVALID_PRODUCT code');

    // Insufficient robots: size-2 factory needs 40, only 30x Q0 available at Q0 floor
    db.prepare('DELETE FROM warehouse WHERE company_id = ? AND kind = 114 AND quality = 1').run(companyId);
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/install-robots/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 67 })
    });
    assert.equal(res.status, 400, 'Install with insufficient robots must be rejected with 400');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'INSUFFICIENT_INVENTORY', 'Insufficient robots must carry INSUFFICIENT_INVENTORY code');
    assert.equal(robotStock(db, companyId, 0), 30, 'Rejection must not consume any robots');
    console.log('  ✔ 400 on missing kind / invalid product / insufficient robots; warehouse untouched');

    // -------------------------------------------------------------------------
    // TEST 2: Successful installation — consumption, specialization, 0.97x wage
    // -------------------------------------------------------------------------
    console.log('\n[2/6] Successful installation on size-2 factory (40 robots @ Q>=0)...');
    seedResource(db, companyId, 114, 1, 30); // Q1 row was deleted in test 1; restore 30x Q1
    const requiredA = FACTORY_ROBOT_UNITS * 2; // 40
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/install-robots/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 67 })
    });
    assert.equal(res.status, 200, 'Install on factory A must return 200');
    const installData = (await res.json()) as {
      robotsInstalled: boolean;
      wageMultiplier: number;
      wageDiscount: number;
      installedRobots: number;
      requiredRobots: number;
      requiredQuality: number;
      lockedProduct: number;
      robotics: RoboticsInfo;
    };
    assert.equal(installData.robotsInstalled, true, 'Install must report robotsInstalled true');
    assert.equal(installData.requiredRobots, requiredA, `Required robot count must be ceil(20 * 2) = ${requiredA}`);
    assert.equal(installData.installedRobots, requiredA, 'Installed count must equal the required count');
    assert.equal(installData.requiredQuality, 0, 'Required quality for size 2 must be floor(2/4) = 0');
    assert.equal(installData.lockedProduct, 67, 'Building must be locked to product 67');
    assert.equal(installData.wageMultiplier, 0.97, 'Wage multiplier must be 0.97 (3% wage reduction)');
    assert.equal(installData.wageDiscount, 0.03, 'Wage discount must be 0.03');
    // Consumption: 40 robots drawn from 30x Q0 + 30x Q1, lowest quality first
    assert.equal(robotStock(db, companyId, 0), 0, 'All 30 Q0 robots must be consumed (30 -> 0)');
    assert.equal(robotStock(db, companyId, 1), 20, '10 Q1 robots must be consumed to reach 40 (30 -> 20)');

    const roboticsA = await getRobotics(cookie, buildingA);
    assert.ok(roboticsA, 'Building details must expose robotics state');
    assert.equal(roboticsA.installed, true, 'Building details must report installed robots');
    assert.equal(roboticsA.installedRobots, requiredA, 'Details must report the installed robot count');
    assert.equal(roboticsA.lockedProduct, 67, 'Details must report the specialization lock');
    assert.equal(roboticsA.wageMultiplier, 0.97, 'Details must report the 0.97x wage multiplier');
    console.log(`  ✔ Installed ${installData.installedRobots} robots (Q0 pool drained first), wage 0.97x, locked to 67`);

    // -------------------------------------------------------------------------
    // TEST 3: Specialization lock — only the locked product may be produced
    // -------------------------------------------------------------------------
    console.log('\n[3/6] Specialization lock on production...');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/queue/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 17, amount: 10 }) // producible in 'Y' but NOT locked
    });
    assert.equal(res.status, 400, 'Producing a non-locked product must be rejected with 400');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'ROBOTICS_SPECIALIZED', 'Rejection must carry ROBOTICS_SPECIALIZED code');
    assert.equal(robotStock(db, companyId, 1), 20, 'Rejected production must not consume ingredients');

    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/queue/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 67, amount: 10 }) // the locked product
    });
    assert.equal(res.status, 200, 'Producing the locked product must be accepted');
    console.log('  ✔ Kind 17 rejected with ROBOTICS_SPECIALIZED, locked kind 67 accepted');

    // -------------------------------------------------------------------------
    // TEST 4: Quality requirement — size-4 factory demands floor(4/4) = Q1 robots
    // -------------------------------------------------------------------------
    console.log('\n[4/6] Robot quality requirement floor(size/4)...');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingB}/install-robots/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 67 })
    });
    assert.equal(res.status, 400, 'Size-4 factory must demand Q1 robots; Q1 stock is empty after test 2');
    const requiredB = FACTORY_ROBOT_UNITS * 4; // 80
    seedResource(db, companyId, 114, 1, requiredB);
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingB}/install-robots/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 67 })
    });
    assert.equal(res.status, 200, 'Install with 80 Q1 robots must succeed on the size-4 factory');
    const installB = (await res.json()) as { installedRobots: number; requiredQuality: number };
    assert.equal(installB.installedRobots, requiredB, `Size-4 factory must install ${requiredB} robots`);
    assert.equal(installB.requiredQuality, 1, 'Required quality for size 4 must be floor(4/4) = 1');
    assert.equal(robotStock(db, companyId, 1), 0, 'All 80 Q1 robots must be consumed (80 -> 0)');
    console.log(`  ✔ Size-4 factory required Q1 robots and consumed ${installB.installedRobots} of them`);

    // -------------------------------------------------------------------------
    // TEST 5: Upgrade/downgrade lock (400 ROBOTICS_LOCKED)
    // -------------------------------------------------------------------------
    console.log('\n[5/6] Upgrade/downgrade lock while robots are installed...');
    // Building B (size 4, robotized): absolute upgrade to 5 and downgrade to 2
    for (const target of [5, 2]) {
      res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingB}/`, {
        method: 'PATCH', headers, body: JSON.stringify({ size: target })
      });
      assert.equal(res.status, 400, `Size change to ${target} must be rejected with 400 while robotized`);
      err = (await res.json()) as { error?: string; code?: string };
      assert.equal(err.code, 'ROBOTICS_LOCKED', `Size change to ${target} must carry ROBOTICS_LOCKED code`);
    }
    // Building A (size 2, robotized): relative downgrade via negative reqSize
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/`, {
      method: 'PATCH', headers, body: JSON.stringify({ size: -1 })
    });
    assert.equal(res.status, 400, 'Relative downgrade must be rejected with 400 while robotized');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'ROBOTICS_LOCKED', 'Downgrade must carry ROBOTICS_LOCKED code');
    const sizeB = db.prepare('SELECT size FROM buildings WHERE id = ?').get(buildingB) as { size: number };
    assert.equal(sizeB.size, 4, 'Rejected upgrade must not change the building size');
    const roboticsA2 = await getRobotics(cookie, buildingA);
    assert.equal(roboticsA2?.installed, true, 'Rejected size changes must not clear the robotization');
    console.log('  ✔ Upgrade (5), downgrade (2) and relative downgrade (-1) all 400 ROBOTICS_LOCKED');

    // -------------------------------------------------------------------------
    // TEST 6: Uninstall — 50% of robots returned at Q0, lock cleared
    // -------------------------------------------------------------------------
    console.log('\n[6/6] Uninstall returns 50% of robots at quality 0...');
    // Fresh install on building C (size 2 -> 40 robots), Q0-only stock
    seedResource(db, companyId, 114, 0, 40);
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingC}/install-robots/`, {
      method: 'POST', headers, body: JSON.stringify({ kind: 67 })
    });
    assert.equal(res.status, 200, 'Install on factory C must return 200');
    assert.equal(robotStock(db, companyId, 0), 0, 'Factory C install must consume the 40 Q0 robots');

    // Busy uninstall rejection: building A is producing kind 67 (unresolved queue)
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingA}/uninstall-robots/`, {
      method: 'POST', headers
    });
    assert.equal(res.status, 409, 'Uninstall while the building is busy producing must be rejected with 409');

    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingC}/uninstall-robots/`, {
      method: 'POST', headers
    });
    assert.equal(res.status, 200, 'Uninstall on factory C must return 200');
    const uninstallData = (await res.json()) as {
      robotsInstalled: boolean;
      wageMultiplier: number;
      returnedRobots: number;
      returnedQuality: number;
    };
    assert.equal(uninstallData.robotsInstalled, false, 'Uninstall must report robotsInstalled false');
    assert.equal(uninstallData.returnedRobots, 20, 'Uninstall must return 50% of 40 = 20 robots');
    assert.equal(uninstallData.returnedQuality, 0, 'Returned robots must be at quality 0');
    assert.equal(uninstallData.wageMultiplier, 1, 'Wage multiplier must return to 1 after uninstall');
    assert.equal(robotStock(db, companyId, 0), 20, 'Warehouse must hold the 20 returned Q0 robots (0 -> 20)');

    const roboticsC = await getRobotics(cookie, buildingC);
    assert.equal(roboticsC?.installed, false, 'Details must report no robots after uninstall');
    assert.equal(roboticsC?.lockedProduct, null, 'Specialization lock must be cleared after uninstall');

    // Lock removal re-enables structural work: upgrade building C from size 2 to 3
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingC}/`, {
      method: 'PATCH', headers, body: JSON.stringify({ size: 3 })
    });
    assert.equal(res.status, 200, 'Upgrade must succeed again after uninstalling robots');
    const sizeC = db.prepare('SELECT size FROM buildings WHERE id = ?').get(buildingC) as { size: number };
    assert.equal(sizeC.size, 3, 'Building size must be upgraded to 3 after unlock');
    console.log('  ✔ 20x Q0 robots returned, lock cleared, upgrade succeeds again');

    console.log('\n================================================================');
    console.log(' All Issue #96 Robotics Assertions PASSED with 0 ERRORS!');
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

runRoboticsVerification().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
