/**
 * Issue #93 Verification Test: Natural Resource Abundance (Mine 'M', Quarry 'Q', Oil Rig 'O')
 *
 * Requirements (decompiled abundance guide):
 * 1. Abundance Persistence:
 *    - `buildings` table gains `abundance` (REAL, default 100.0) and
 *      `original_abundance` (REAL, default 100.0).
 *    - Extractor buildings roll their initial abundance at construction time
 *      via clamp(Gaussian(0.85, 0.15), 0.5, 1.0) * 100 (range [50, 100]) and
 *      original_abundance starts equal to it. Non-extractors keep 100/100.
 * 2. Linear Production Output Scaling:
 *    - outputAmount = round(baseAmount * abundance / 100) for extractor
 *      buildings; the queue item persists the scaled output and the warehouse
 *      delivery matches it. Non-extractor buildings are never scaled.
 * 3. Abundance Daily Decay & Prospecting:
 *    - Each completed production cycle (production day) decays the deposit
 *      abundance by 0.032% (multiplicative), never touching original_abundance.
 *    - POST /api/v2/companies/buildings/:id/prospect/ re-rolls the deposit
 *      (fresh abundance + matching original abundance, ownership enforced).
 *    - GET /api/v2/companies/buildings/:id/abundance/ returns
 *      { abundance, originalAbundance }.
 *
 * Runs isolated test on port 3830.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// The harness imports server modules for unit-level invariant checks. The
// module graph initializes a database on import, so point the harness process
// at a throwaway DATA_DIR *before* any server import; the spawned API server
// below uses its own dedicated directory.
// ---------------------------------------------------------------------------
process.env.DATA_DIR = path.resolve('data', `test-run-issue-93-harness-${Date.now()}`);

const abundanceModule = await import('../server/game/buildings.ts');
const {
  ABUNDANCE_EXTRACTOR_KINDS,
  ABUNDANCE_DECAY_PER_CYCLE,
  isAbundanceExtractorKind,
  rollAbundancePercent,
  initialAbundanceForKind,
  scaleExtractorOutput,
  decayAbundance
} = abundanceModule as {
  ABUNDANCE_EXTRACTOR_KINDS: Record<string, true>;
  ABUNDANCE_DECAY_PER_CYCLE: number;
  isAbundanceExtractorKind(kind: string): boolean;
  rollAbundancePercent(): number;
  initialAbundanceForKind(kind: string): { abundance: number; originalAbundance: number };
  scaleExtractorOutput(baseAmount: number, abundance: number): number;
  decayAbundance(abundance: number, cycles?: number): number;
};

const TEST_PORT = Number(process.env.PORT || '3830');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function isPortAvailable(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const tester = net
    .createServer()
    .once('error', () => resolve(false))
    .once('listening', () => {
      tester.once('close', () => resolve(true)).close();
    })
    .listen(port, '127.0.0.1');
  return promise;
}

/**
 * Integration-test sleep helper. The polls below await conditions of a
 * spawned out-of-process API server (HTTP + its own SQLite clock), so fake
 * timers cannot drive them; each retry loop still awaits the real condition
 * with a hard deadline rather than a fixed "long enough" wait.
 */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
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
    await sleep(150);
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

  const dataDir = path.resolve('data', `test-run-issue-93-${Date.now()}`);
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
      process.stderr.write(`[server-3830] ${str}`);
    }
  });

  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `abundance_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Abundance ${label} ${Date.now()}`
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

function approxEqual(actual: number, expected: number, epsilon = 1e-6): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

async function constructBuilding(cookie: string, kind: string, position: string): Promise<{ id: number }> {
  const res = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ kind, position })
  });
  const body = await res.json() as { id?: number; building?: { id?: number }; error?: string };
  const id = body.id ?? body.building?.id ?? 0;
  assert.ok(res.status === 200 && id > 0, `Constructing ${kind} at ${position} should succeed (got ${res.status}: ${body.error ?? ''})`);
  return { id };
}

async function getAbundance(buildingId: number): Promise<{ abundance: number; originalAbundance: number }> {
  const res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/abundance/`);
  assert.equal(res.status, 200, `GET abundance for building ${buildingId} should return 200`);
  return await res.json() as { abundance: number; originalAbundance: number };
}

/** Start production, polling past the 10s construction/upgrade busy window. */
async function startProduction(cookie: string, buildingId: number, kind: number, amount: number): Promise<{ id: number; amount: number }> {
  const deadline = Date.now() + 30000;
  let lastStatus = 0;
  let lastError = '';
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind, amount })
    });
    lastStatus = res.status;
    const body = await res.json() as { id?: number; amount?: number; error?: string };
    if (res.status === 200 && typeof body.id === 'number') {
      return { id: body.id, amount: Number(body.amount) };
    }
    lastError = body.error ?? '';
    if (res.status === 400) {
      throw new Error(`Production start rejected: ${lastError}`);
    }
    // 409 = still under construction / busy: retry until the window lapses.
    await sleep(500);
  }
  throw new Error(`Production start did not succeed in time (last ${lastStatus}: ${lastError})`);
}

/** Collect a finished order, polling until its finish time lapses. */
async function collectProduction(cookie: string, queueId: number): Promise<void> {
  const deadline = Date.now() + 30000;
  let lastStatus = 0;
  let lastError = '';
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/v2/order/take/${queueId}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({})
    });
    lastStatus = res.status;
    if (res.status === 200) return;
    lastError = ((await res.json()) as { error?: string }).error ?? '';
    if (res.status === 409) {
      throw new Error(`Collect conflicted: ${lastError}`);
    }
    await sleep(300);
  }
  throw new Error(`Collect did not succeed in time (last ${lastStatus}: ${lastError})`);
}

function warehouseAmount(db: DatabaseSync, companyId: number, kind: number, quality = 0): number {
  const row = db.prepare(
    'SELECT amount FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?'
  ).get(companyId, kind, quality) as { amount: number } | undefined;
  return row ? Number(row.amount) : 0;
}

function setAbundance(db: DatabaseSync, buildingId: number, abundance: number, originalAbundance?: number): void {
  db.prepare('UPDATE buildings SET abundance = ?, original_abundance = ? WHERE id = ?')
    .run(abundance, originalAbundance ?? abundance, buildingId);
}

async function runTests() {
  console.log('================================================================');
  console.log(' Starting Issue #93: Natural Resource Abundance');
  let server: ServerInstance | null = null;
  let directDb: DatabaseSync | null = null;

  try {
    // =========================================================================
    // PART 1: Unit invariants of the abundance domain formulas
    // =========================================================================
    console.log('--- PART 1: Abundance formula invariants (roll / scaling / decay) ---');

    console.log('[1/5] Verifying extractor kind classification...');
    assert.deepEqual(Object.keys(ABUNDANCE_EXTRACTOR_KINDS).sort(), ['M', 'O', 'Q'], 'Extractor kinds are exactly M, Q, O');
    assert.equal(isAbundanceExtractorKind('M'), true, 'Mine is an extractor');
    assert.equal(isAbundanceExtractorKind('Q'), true, 'Quarry is an extractor');
    assert.equal(isAbundanceExtractorKind('O'), true, 'Oil rig is an extractor');
    assert.equal(isAbundanceExtractorKind('P'), false, 'Farm is not an extractor');
    assert.equal(isAbundanceExtractorKind('G'), false, 'Grocery store is not an extractor');
    assert.equal(isAbundanceExtractorKind('W'), false, 'Water reservoir is not an extractor');

    console.log('[2/5] Verifying clamped Gaussian roll bounds [50, 100]...');
    let interiorRolls = 0;
    for (let i = 0; i < 200; i++) {
      const roll = rollAbundancePercent();
      assert.ok(roll >= 50 && roll <= 100, `Roll ${roll} must be within [50, 100]`);
      if (roll > 50 && roll < 100) interiorRolls++;
    }
    assert.ok(interiorRolls > 0, 'At least one of 200 rolls must land strictly inside (50, 100)');

    console.log('[3/5] Verifying initial abundance per building kind...');
    const farmInit = initialAbundanceForKind('P');
    assert.deepEqual(farmInit, { abundance: 100, originalAbundance: 100 }, 'Non-extractors start at a fully rich 100/100 deposit');
    let rolledBelow100 = 0;
    for (let i = 0; i < 40; i++) {
      const mineInit = initialAbundanceForKind('M');
      assert.ok(mineInit.abundance >= 50 && mineInit.abundance <= 100, 'Mine roll must be within [50, 100]');
      assert.equal(mineInit.originalAbundance, mineInit.abundance, 'original_abundance starts equal to the rolled abundance');
      if (mineInit.abundance < 100) rolledBelow100++;
    }
    assert.ok(rolledBelow100 > 0, 'A fresh roll distribution must contain values below 100 (40 samples)');

    console.log('[4/5] Verifying linear output scaling formula...');
    assert.equal(scaleExtractorOutput(100, 100), 100, '100 units at 100% abundance yields 100');
    assert.equal(scaleExtractorOutput(100, 50), 50, '100 units at 50% abundance yields 50');
    assert.equal(scaleExtractorOutput(100, 75), 75, '100 units at 75% abundance yields 75');
    assert.equal(scaleExtractorOutput(20, 50), 10, '20 units at 50% abundance yields 10');
    assert.equal(scaleExtractorOutput(7, 55), 4, 'Non-trivial rounding: round(7 * 0.55) = 4');
    assert.equal(scaleExtractorOutput(33, 0), 0, 'Depleted deposit yields nothing');
    assert.equal(
      scaleExtractorOutput(200, 50),
      2 * scaleExtractorOutput(100, 50),
      'Output scales linearly in the base amount'
    );

    console.log('[5/5] Verifying 0.032% multiplicative decay per cycle...');
    assert.ok(approxEqual(decayAbundance(100), 100 * (1 - ABUNDANCE_DECAY_PER_CYCLE), 1e-9), 'One cycle decays 100 by 0.032%');
    assert.ok(approxEqual(decayAbundance(100), 99.968, 1e-9), '100 decays to 99.968 after one cycle');
    assert.ok(approxEqual(decayAbundance(50), 49.984, 1e-9), '50 decays to 49.984 after one cycle');
    const twiceDecayed = decayAbundance(decayAbundance(100));
    assert.ok(approxEqual(twiceDecayed, 100 * Math.pow(1 - ABUNDANCE_DECAY_PER_CYCLE, 2), 1e-9), 'Decay compounds per cycle');
    assert.ok(decayAbundance(100) < 100, 'Decay strictly decreases abundance');
    assert.equal(decayAbundance(0), 0, 'Decay never resurrects a depleted deposit');
    assert.equal(decayAbundance(-5), 0, 'Negative abundance is clamped to 0');

    console.log('  -> All abundance formula invariants passed.\n');

    // =========================================================================
    // PART 2: Migration, persistence & construction-time initialization
    // =========================================================================
    console.log('--- PART 2: Abundance persistence & construction initialization ---');

    console.log('[Setup] Launching isolated test server on port', TEST_PORT);
    server = await startTestServer();
    console.log('  -> Test server ready.');

    directDb = new DatabaseSync(server.dbPath);

    console.log('[1/4] Verifying abundance columns exist on the buildings table...');
    const buildingColumns = directDb.prepare('PRAGMA table_info(buildings)').all() as Array<{ name: string; type: string }>;
    const abundanceCol = buildingColumns.find((c) => c.name === 'abundance');
    const originalCol = buildingColumns.find((c) => c.name === 'original_abundance');
    assert.ok(abundanceCol, 'buildings.abundance column must exist');
    assert.ok(originalCol, 'buildings.original_abundance column must exist');
    assert.equal(abundanceCol.type.toUpperCase(), 'REAL', 'abundance must be REAL');
    assert.equal(originalCol.type.toUpperCase(), 'REAL', 'original_abundance must be REAL');

    const user = await registerCompany('player1');
    const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

    console.log('[2/4] Verifying starter non-extractor buildings default to 100/100...');
    const starterBuildings = directDb.prepare(
      'SELECT id, kind FROM buildings WHERE company_id = ? ORDER BY position ASC'
    ).all(user.companyId) as Array<{ id: number; kind: string }>;
    const grocery = starterBuildings.find((b) => b.kind === 'G');
    const farm = starterBuildings.find((b) => b.kind === 'P');
    assert.ok(grocery && farm, 'Starter Farm and Grocery store must exist');
    for (const building of starterBuildings) {
      const row = directDb.prepare('SELECT abundance, original_abundance FROM buildings WHERE id = ?')
        .get(building.id) as { abundance: number; original_abundance: number };
      assert.equal(Number(row.abundance), 100, `Starter ${building.kind} must default to abundance 100`);
      assert.equal(Number(row.original_abundance), 100, `Starter ${building.kind} must default to original_abundance 100`);
    }
    const groceryAbundance = await getAbundance(grocery.id);
    assert.deepEqual(groceryAbundance, { abundance: 100, originalAbundance: 100 }, 'GET abundance endpoint reports 100/100 for non-extractors');

    console.log('[3/4] Verifying extractor construction rolls a clamped abundance...');
    const mine = await constructBuilding(user.cookie, 'M', '2');
    const quarry = await constructBuilding(user.cookie, 'Q', '3');

    const mineAbundance = await getAbundance(mine.id);
    assert.ok(mineAbundance.abundance >= 50 && mineAbundance.abundance <= 100, 'Constructed Mine abundance must be within [50, 100]');
    assert.equal(mineAbundance.originalAbundance, mineAbundance.abundance, 'Mine original_abundance must equal the initial roll');
    const quarryAbundance = await getAbundance(quarry.id);
    assert.ok(quarryAbundance.abundance >= 50 && quarryAbundance.abundance <= 100, 'Constructed Quarry abundance must be within [50, 100]');
    assert.equal(quarryAbundance.originalAbundance, quarryAbundance.abundance, 'Quarry original_abundance must equal the initial roll');

    const mineRow = directDb.prepare('SELECT abundance, original_abundance FROM buildings WHERE id = ?').get(mine.id) as { abundance: number; original_abundance: number };
    assert.ok(approxEqual(Number(mineRow.abundance), mineAbundance.abundance, 1e-9), 'Persisted abundance matches the API response');
    assert.ok(approxEqual(Number(mineRow.original_abundance), mineAbundance.originalAbundance, 1e-9), 'Persisted original_abundance matches the API response');

    console.log('[4/4] Verifying abundance endpoint error handling...');
    const missingRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/999999999/abundance/`);
    assert.equal(missingRes.status, 404, 'GET abundance for an unknown building must return 404');

    console.log('  -> Abundance persistence & initialization passed.\n');

    // =========================================================================
    // PART 3: Linear production output scaling end-to-end
    // =========================================================================
    console.log('--- PART 3: Linear output scaling on a Mine (kind 14 minerals) ---');

    const waterBefore = warehouseAmount(directDb, user.companyId, 1);
    const powerBefore = warehouseAmount(directDb, user.companyId, 2);
    const tomatoesBefore = warehouseAmount(directDb, user.companyId, 66);

    // Scaling points: abundance -> expected output for a base order of 20.
    const scalingPoints: Array<{ abundance: number; expectedOutput: number }> = [
      { abundance: 50, expectedOutput: 10 },
      { abundance: 75, expectedOutput: 15 },
      { abundance: 100, expectedOutput: 20 },
      { abundance: 33.33, expectedOutput: Math.round(20 * 33.33 / 100) } // rounding point: 7
    ];

    for (const point of scalingPoints) {
      setAbundance(directDb, mine.id, point.abundance);
      const order = await startProduction(user.cookie, mine.id, 14, 20);
      assert.equal(order.amount, point.expectedOutput,
        `Queue item must persist the scaled output: round(20 * ${point.abundance} / 100) = ${point.expectedOutput}`);
      await collectProduction(user.cookie, order.id);
      const stored = directDb.prepare('SELECT amount FROM production_queues WHERE id = ?').get(order.id) as { amount: number };
      assert.equal(Number(stored.amount), point.expectedOutput, 'Persisted queue amount stays the scaled output');
    }

    const mineralsTotal = scalingPoints.reduce((sum, p) => sum + p.expectedOutput, 0);
    assert.equal(warehouseAmount(directDb, user.companyId, 14), mineralsTotal,
      `Warehouse must hold exactly the ${mineralsTotal} scaled minerals delivered across all cycles`);

    console.log('[Control] Verifying non-extractor output is never scaled...');
    setAbundance(directDb, farm.id, 50);
    const applesBefore = warehouseAmount(directDb, user.companyId, 3);
    const farmOrder = await startProduction(user.cookie, farm.id, 3, 20);
    assert.equal(farmOrder.amount, 20, 'Farm output must NOT be scaled by abundance');
    await collectProduction(user.cookie, farmOrder.id);
    assert.equal(warehouseAmount(directDb, user.companyId, 3), applesBefore + 20,
      'Farm delivers its full unscaled output of 20 apples');

    const waterAfter = warehouseAmount(directDb, user.companyId, 1);
    const powerAfter = warehouseAmount(directDb, user.companyId, 2);
    const tomatoesAfter = warehouseAmount(directDb, user.companyId, 66);
    assert.ok(waterBefore - waterAfter > 0 && powerBefore - powerAfter > 0, 'Extractor ingredients are consumed for the base order');
    assert.equal(tomatoesBefore - tomatoesAfter, 20, 'Farm control consumed its ingredients');

    console.log('  -> Linear output scaling passed.\n');

    // =========================================================================
    // PART 4: 0.032% abundance decay per completed production cycle
    // =========================================================================
    console.log('--- PART 4: Abundance decay per production cycle ---');

    setAbundance(directDb, mine.id, 100, 100);
    const firstOrder = await startProduction(user.cookie, mine.id, 14, 20);
    await collectProduction(user.cookie, firstOrder.id);
    let row = directDb.prepare('SELECT abundance, original_abundance FROM buildings WHERE id = ?').get(mine.id) as { abundance: number; original_abundance: number };
    assert.ok(approxEqual(Number(row.abundance), 100 * (1 - ABUNDANCE_DECAY_PER_CYCLE), 1e-9),
      'One completed cycle decays abundance 100 -> 99.968');
    assert.equal(Number(row.original_abundance), 100, 'Decay must not touch original_abundance');

    const secondOrder = await startProduction(user.cookie, mine.id, 14, 20);
    await collectProduction(user.cookie, secondOrder.id);
    row = directDb.prepare('SELECT abundance, original_abundance FROM buildings WHERE id = ?').get(mine.id) as { abundance: number; original_abundance: number };
    assert.ok(approxEqual(Number(row.abundance), 100 * Math.pow(1 - ABUNDANCE_DECAY_PER_CYCLE, 2), 1e-9),
      'Decay compounds across cycles (100 -> 99.968 -> 99.936...)');

    const farmRowBefore = directDb.prepare('SELECT abundance FROM buildings WHERE id = ?').get(farm.id) as { abundance: number };
    const farmOrder2 = await startProduction(user.cookie, farm.id, 3, 20);
    await collectProduction(user.cookie, farmOrder2.id);
    const farmRowAfter = directDb.prepare('SELECT abundance FROM buildings WHERE id = ?').get(farm.id) as { abundance: number };
    assert.ok(approxEqual(Number(farmRowAfter.abundance), Number(farmRowBefore.abundance), 1e-9),
      'Non-extractor abundance is never decayed by production cycles');

    console.log('  -> Abundance decay passed.\n');

    // =========================================================================
    // PART 5: Prospecting (re-roll) via the API
    // =========================================================================
    console.log('--- PART 5: Prospecting re-rolls the deposit ---');

    setAbundance(directDb, mine.id, 30, 30);
    const prospectRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${mine.id}/prospect/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
      body: JSON.stringify({})
    });
    assert.equal(prospectRes.status, 200, 'Prospecting must return 200');
    const prospectBody = await prospectRes.json() as { abundance: number; originalAbundance: number };
    assert.ok(prospectBody.abundance >= 50 && prospectBody.abundance <= 100, 'Re-rolled abundance must be within [50, 100]');
    assert.equal(prospectBody.originalAbundance, prospectBody.abundance, 'Prospecting resets original_abundance to the new roll');
    assert.notEqual(prospectBody.abundance, 30, 'Re-rolled abundance must differ from the forced 30% deposit');

    const afterProspect = await getAbundance(mine.id);
    assert.deepEqual(afterProspect, prospectBody, 'GET abundance must reflect the persisted re-roll');

    console.log('[Control] Verifying prospect ownership enforcement...');
    const other = await registerCompany('player2');
    const foreignRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${mine.id}/prospect/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
      body: JSON.stringify({})
    });
    assert.equal(foreignRes.status, 403, 'Prospecting another company\'s building must return 403');

    const missingProspectRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/999999999/prospect/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
      body: JSON.stringify({})
    });
    assert.equal(missingProspectRes.status, 404, 'Prospecting an unknown building must return 404');

    console.log('  -> Prospecting passed.\n');

    console.log('================================================================');
    console.log(' ALL ISSUE #93 TESTS PASSED');
    console.log('================================================================');
  } catch (err) {
    console.error('\n[FAILURE] Issue #93 verification failed:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      await sleep(500);
      if (!server.child.killed) server.child.kill('SIGKILL');
      try {
        if (process.env.KEEP_TEST_DATA !== '1') rmSync(server.dataDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
    try {
      const harnessDir = process.env.DATA_DIR;
      if (harnessDir && process.env.KEEP_TEST_DATA !== '1' && existsSync(harnessDir)) {
        rmSync(harnessDir, { recursive: true, force: true });
      }
    } catch { /* best effort */ }
    try { directDb?.close(); } catch { /* best effort */ }
  }
}

runTests().catch((err) => {
  console.error('[FATAL] Unhandled test error:', err);
  process.exitCode = 1;
});
