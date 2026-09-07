import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3905');
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

  const dataDir = path.resolve('data', `test-run-ach16-${Date.now()}`);
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
      process.stderr.write(`[server-3905] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `ach16_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Achiever16 ${label} ${Date.now()}`
    })
  });
  assert.equal(res.status, 200, `Registration should return 200 for ${label}`);

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

async function run16AchievementsTest(): Promise<void> {
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    const company = await registerCompany('player');
    const cookie = company.cookie;

    console.log('\n[1/4] Verify 16 canonical achievements returned by GET /api/v2/companies/me/achievements/');
    const res = await fetch(`${BASE_URL}/api/v2/companies/me/achievements/`, {
      headers: { Cookie: cookie }
    });
    assert.equal(res.status, 200);
    const achievements = (await res.json()) as Array<{
      label: string;
      type: string | null;
      stars: number;
      starsMax: number;
      rewards?: number[];
      reward?: number;
      simBoosts: number;
      image: string | null;
      action: string | null;
      id: string | null;
      progress: { percent: number; label: string } | null;
    }>;

    assert.equal(achievements.length, 16, 'Exact 16 achievements required matching HAR capture');

    const expectedLabels = [
      '每日生产零售',
      '完成教程',
      '施工商',
      '雇主',
      '零售商',
      '供应商',
      '收购商',
      '创业者',
      '科学家',
      '建筑师',
      '董事长',
      '导师',
      '勘探专家',
      '万事通',
      '官僚',
      '势如破竹'
    ];

    for (let i = 0; i < expectedLabels.length; i++) {
      assert.equal(achievements[i].label, expectedLabels[i], `Item ${i} label must match canonical order`);
      assert.ok(achievements[i].starsMax > 0, `Item ${i} (${expectedLabels[i]}) starsMax must be positive`);
    }

    console.log('\n[2/4] Verify achievement images are accessible via static asset fetcher');
    const imagesToTest = [
      'images/achievements/Tutorial Finished.png',
      'images/achievements/Builder.png',
      'images/achievements/Supplier.png',
      'images/achievements/Start-up.png',
      'images/achievements/Architect.png'
    ];

    for (const imgPath of imagesToTest) {
      const imgRes = await fetch(`${BASE_URL}/${imgPath}`);
      assert.equal(imgRes.status, 200, `${imgPath} must be served with 200`);
      assert.equal(imgRes.headers.get('content-type'), 'image/png');
      const buf = await imgRes.arrayBuffer();
      assert.ok(buf.byteLength > 1000, `${imgPath} must have non-empty image content`);

      // Test with /static/ prefix
      const staticRes = await fetch(`${BASE_URL}/static/${imgPath}`);
      assert.equal(staticRes.status, 200, `/static/${imgPath} must also be served with 200`);
    }

    console.log('\n[3/4] Verify progress evaluation and claim flow for a new achievement');
    const db = new DatabaseSync(server.dbPath);

    // Simulate 1 retail sale for company
    db.prepare(`
      INSERT INTO retail_sales_history (realm_id, company_id, resource_kind, quality, units, unit_price, revenue, sold_at)
      VALUES (0, ?, 1, 0, 10, 50, 500, datetime('now'))
    `).run(company.companyId);

    // Verify retail-seller is now pending
    const pendingRes = await fetch(`${BASE_URL}/api/v2/no-cache/companies/me/achievements/`, {
      headers: { Cookie: cookie }
    });
    assert.equal(pendingRes.status, 200);
    const pendingList = (await pendingRes.json()) as Array<{ id: string; available: number; progress: number }>;
    const retailPending = pendingList.find(a => a.id === 'retail-seller');
    assert.ok(retailPending, 'retail-seller must be pending after retail sale');
    assert.equal(retailPending.available, 1, 'retail-seller available must be 1');
    assert.equal(retailPending.progress, 1, 'retail-seller progress must be 1');

    // Claim retail-seller
    const claimRes = await fetch(`${BASE_URL}/api/v2/no-cache/companies/achievements/retail-seller/`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
    assert.equal(claimRes.status, 200, 'claim retail-seller must succeed');
    const claimBody = (await claimRes.json()) as { success: boolean; reward: number; sim_boosts: number };
    assert.equal(claimBody.success, true);
    assert.equal(claimBody.reward, 50000, 'retail-seller reward must be awarded');
    assert.equal(claimBody.sim_boosts, 5, 'retail-seller SimBoosts must be awarded');

    // Duplicate claim rejected
    const dupRes = await fetch(`${BASE_URL}/api/v2/no-cache/companies/achievements/retail-seller/`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
    assert.equal(dupRes.status, 400);

    // Verify overview now shows retail-seller completed
    const updatedOverviewRes = await fetch(`${BASE_URL}/api/v2/companies/me/achievements/`, {
      headers: { Cookie: cookie }
    });
    const updatedOverview = (await updatedOverviewRes.json()) as Array<{ id: string; stars: number; progress: { percent: number; label: string } }>;
    const retailOverview = updatedOverview.find(a => a.id === 'retail-seller');
    assert.ok(retailOverview);
    assert.equal(retailOverview.stars, 5, 'retail-seller stars must be starsMax (5)');
    assert.equal(retailOverview.progress.percent, 100);
    assert.equal(retailOverview.progress.label, '已达成');

    console.log('\n[4/4] Verify display case placement of the new achievement');
    const placeRes = await fetch(`${BASE_URL}/api/v2/companies/me/display-case/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ slot: 5, achievement_id: 'retail-seller' })
    });
    assert.equal(placeRes.status, 200, 'placing claimed retail-seller into display case must succeed');
    const placeBody = (await placeRes.json()) as { displayCase: Array<{ slot: number; itemKind: string; achievement?: { id: string } }> };
    const placedItem = placeBody.displayCase.find(i => i.slot === 5);
    assert.ok(placedItem);
    assert.equal(placedItem.itemKind, 'achievement');
    assert.equal(placedItem.achievement?.id, 'retail-seller');

    db.close();
    console.log('\n================================================================');
    console.log(' All 16 Achievements Verification Tests PASSED with 0 ERRORS!');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      if (existsSync(server.dataDir)) {
        try {
          rmSync(server.dataDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  }
}

run16AchievementsTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
