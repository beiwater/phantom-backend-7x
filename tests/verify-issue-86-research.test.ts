/**
 * Issue #86 Verification Test: Canonical Research & Patent System
 *
 * Requirements:
 * 1. Canonical cumulative patent-to-quality thresholds:
 *    [12, 62, 562, 2562, 7562, 17562, 27562, 37562, 47562, 57562, 107562, 157562]
 *    - 0-11 patents -> Q0
 *    - 12-61 patents -> Q1
 *    - 62-561 patents -> Q2
 *    - 562-2561 patents -> Q3
 *    - etc.
 * 2. Discipline-to-Resource Mapping:
 *    - Power (1) -> Energy (2)
 *    - Water (2) -> Mining (3)
 *    - Leather (46) -> Breeding (5)
 *    - Rocket Fuel (83) -> Energy (2)
 * 3. CTO Science Skill Multiplier:
 *    - points * (1 + ctoScience / 100)
 *
 * Isolated test on port 3740.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

import {
  CUMULATIVE_PATENT_THRESHOLDS,
  getQualityFromPatents,
  getPatentsNeededForNextQuality,
  getDisciplineForResource,
  calculatePatentsFromPoints,
  RESOURCE_TO_DISCIPLINE,
  DISCIPLINES,
  RESEARCH_RESOURCE_BY_DISCIPLINE
} from '../server/domain/research/research-rules.ts';

const TEST_PORT = Number(process.env.PORT || '3740');
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
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const deadline = Date.now() + timeoutMs;
  const probe = async (): Promise<void> => {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url);
        if (r.ok || r.status === 200 || r.status === 404) {
          return resolve();
        }
      } catch {
        // Retry
      }
      await new Promise((res) => setTimeout(res, 200));
    }
    reject(new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`));
  };
  void probe();
  return promise;
}

interface ServerInstance {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
}

async function startTestServer(): Promise<ServerInstance> {
  const portAvailable = await isPortAvailable(TEST_PORT);
  assert.ok(portAvailable, `Port ${TEST_PORT} is not available for testing`);

  const dataDir = path.resolve('data', `test-run-issue-86-${Date.now()}`);
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATA_DIR: dataDir,
        ADMIN_PASSWORD: 'testadminpassword123',
        SPEED_MULTIPLIER: '100'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  child.stdout?.on('data', (chunk) => {
    const str = chunk.toString();
    process.stdout.write(`[server-3740:out] ${str}`);
  });

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3740:err] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `research_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Research ${label} ${Date.now()}`
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

async function runIssue86Verification() {
  console.log('================================================================');
  console.log(' Starting Issue #86: Research Quality, Discipline Mapping & CTO Boost');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // SECTION 1: Domain Unit Invariant Checks
  // ---------------------------------------------------------------------------
  console.log('[1/4] Verifying Domain Rules & Cumulative Quality Thresholds...');

  // Cumulative patent thresholds
  const expectedThresholds = [12, 62, 562, 2562, 7562, 17562, 27562, 37562, 47562, 57562, 107562, 157562];
  assert.deepEqual([...CUMULATIVE_PATENT_THRESHOLDS], expectedThresholds, 'Cumulative patent thresholds must match canonical array');

  // Quality calculation checks
  assert.equal(getQualityFromPatents(0), 0, '0 patents -> Q0');
  assert.equal(getQualityFromPatents(11), 0, '11 patents -> Q0');
  assert.equal(getQualityFromPatents(12), 1, '12 patents -> Q1');
  assert.equal(getQualityFromPatents(61), 1, '61 patents -> Q1');
  assert.equal(getQualityFromPatents(62), 2, '62 patents -> Q2');
  assert.equal(getQualityFromPatents(561), 2, '561 patents -> Q2');
  assert.equal(getQualityFromPatents(562), 3, '562 patents -> Q3');
  assert.equal(getQualityFromPatents(2561), 3, '2561 patents -> Q3');
  assert.equal(getQualityFromPatents(2562), 4, '2562 patents -> Q4');
  assert.equal(getQualityFromPatents(7562), 5, '7562 patents -> Q5');
  assert.equal(getQualityFromPatents(17562), 6, '17562 patents -> Q6');
  assert.equal(getQualityFromPatents(27562), 7, '27562 patents -> Q7');
  assert.equal(getQualityFromPatents(37562), 8, '37562 patents -> Q8');
  assert.equal(getQualityFromPatents(47562), 9, '47562 patents -> Q9');
  assert.equal(getQualityFromPatents(57562), 10, '57562 patents -> Q10');
  assert.equal(getQualityFromPatents(107562), 11, '107562 patents -> Q11');
  assert.equal(getQualityFromPatents(157562), 12, '157562 patents -> Q12');
  assert.equal(getQualityFromPatents(200000), 12, '200000 patents -> Q12 (capped at 12)');

  // Patents needed for next quality
  assert.equal(getPatentsNeededForNextQuality(0), 12, 'Q0 requires 12 patents for Q1');
  assert.equal(getPatentsNeededForNextQuality(1), 62, 'Q1 requires 62 cumulative patents for Q2');
  assert.equal(getPatentsNeededForNextQuality(2), 562, 'Q2 requires 562 cumulative patents for Q3');
  assert.equal(getPatentsNeededForNextQuality(11), 157562, 'Q11 requires 157562 cumulative patents for Q12');
  assert.equal(getPatentsNeededForNextQuality(12), 157562, 'Q12 max quality stays at 157562');

  console.log('  ✔ All cumulative patent-to-quality threshold assertions passed');

  // ---------------------------------------------------------------------------
  // SECTION 2: Discipline-to-Resource Mapping Checks
  // ---------------------------------------------------------------------------
  console.log('\n[2/4] Verifying Discipline-to-Resource Mapping...');

  // Mandatory mappings:
  // - Power (1) -> Energy (2)
  // - Water (2) -> Mining (3)
  // - Leather (46) -> Breeding (5)
  // - Rocket Fuel (83) -> Energy (2)
  assert.equal(getDisciplineForResource(1), 2, 'Power (1) must map to Energy (2)');
  assert.equal(getDisciplineForResource(2), 3, 'Water (2) must map to Mining (3)');
  assert.equal(getDisciplineForResource(46), 5, 'Leather (46) must map to Breeding (5)');
  assert.equal(getDisciplineForResource(83), 2, 'Rocket Fuel (83) must map to Energy (2)');

  // Broader canonical discipline mapping checks
  assert.equal(getDisciplineForResource(3), 1, 'Apples (3) -> Plant (1)');
  assert.equal(getDisciplineForResource(20), 4, 'Processors (20) -> Electronics (4)');
  assert.equal(getDisciplineForResource(18), 6, 'Aluminium (18) -> Chemistry (6)');
  assert.equal(getDisciplineForResource(24), 7, 'Smart Phones (24) -> Software (7)');
  assert.equal(getDisciplineForResource(51), 8, 'Car Body (51) -> Automotive (8)');
  assert.equal(getDisciplineForResource(77), 9, 'Fuselage (77) -> Aerospace (9)');
  assert.equal(getDisciplineForResource(76), 10, 'Carbon Composite (76) -> Materials (10)');
  assert.equal(getDisciplineForResource(41), 11, 'Fabric (41) -> Fashion (11)');
  assert.equal(getDisciplineForResource(121), 12, 'Bread (121) -> Recipes (12)');

  console.log('  ✔ Discipline-to-resource mapping verified (Power->Energy, Water->Mining, Leather->Breeding, Rocket Fuel->Energy)');

  // ---------------------------------------------------------------------------
  // SECTION 3: CTO Science Skill Multiplier Checks
  // ---------------------------------------------------------------------------
  console.log('\n[3/4] Verifying CTO Science Skill Multiplier Calculation...');

  // Base calculation without CTO: 50 points per patent
  assert.equal(calculatePatentsFromPoints(0, 0), 0);
  assert.equal(calculatePatentsFromPoints(49, 0), 0);
  assert.equal(calculatePatentsFromPoints(50, 0), 1);
  assert.equal(calculatePatentsFromPoints(99, 0), 1);
  assert.equal(calculatePatentsFromPoints(100, 0), 2);

  // CTO with Science skill = 20: effectivePoints = points * (1 + 20/100) = points * 1.20
  // 42 points * 1.20 = 50.4 -> 1 patent (sub-50 points yields a patent due to CTO boost!)
  assert.equal(calculatePatentsFromPoints(42, 20), 1, '42 points with 20% CTO science boost must yield 1 patent');
  assert.equal(calculatePatentsFromPoints(100, 20), 2, '100 points with 20% CTO science boost = 120 effective = 2 patents');
  assert.equal(calculatePatentsFromPoints(250, 20), 6, '250 points with 20% CTO science boost = 300 effective = 6 patents (vs 5 without CTO)');

  // CTO with Science skill = 50: effectivePoints = points * 1.50
  assert.equal(calculatePatentsFromPoints(100, 50), 3, '100 points with 50% CTO science boost = 150 effective = 3 patents');

  // CTO with Science skill = 100: effectivePoints = points * 2.00
  assert.equal(calculatePatentsFromPoints(100, 100), 4, '100 points with 100% CTO science boost = 200 effective = 4 patents');

  console.log('  ✔ CTO science skill boost formula [points * (1 + ctoScience / 100)] verified');

  // ---------------------------------------------------------------------------
  // SECTION 4: End-to-End HTTP API Integration Tests (Port 3740)
  // ---------------------------------------------------------------------------
  console.log('\n[4/4] Starting Server & Testing HTTP Research Endpoints on Port 3740...');

  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log(`  ✔ Test server started on port ${TEST_PORT}`);

    const db = new DatabaseSync(server.dbPath);

    // Register test company
    const user = await registerCompany('issue86');
    const headers = { 'Content-Type': 'application/json', Cookie: user.cookie };

    // Upgrade user to level 15 so research and executives are both unlocked
    db.prepare('UPDATE companies SET level = 15, money = 1000000 WHERE company_id = ?').run(user.companyId);

    // 4A: Check resource-ability endpoints for discipline mapping
    // Power (1) -> Energy (2)
    const powerRes = await fetch(`${BASE_URL}/api/v2/companies/me/resource-ability/1/`, { headers });
    assert.equal(powerRes.status, 200);
    const powerData = (await powerRes.json()) as { kind: number; quality: number; patents: number; patentsNeeded: number };
    assert.equal(powerData.kind, 1);
    assert.equal(powerData.quality, 0);
    assert.equal(powerData.patentsNeeded, 12, 'Initial patentsNeeded must be 12');

    // Water (2) -> Mining (3)
    const waterRes = await fetch(`${BASE_URL}/api/v2/companies/me/resource-ability/2/`, { headers });
    assert.equal(waterRes.status, 200);
    const waterData = (await waterRes.json()) as { kind: number; quality: number; patents: number; patentsNeeded: number };
    assert.equal(waterData.kind, 2);
    assert.equal(waterData.quality, 0);

    // Leather (46) -> Breeding (5)
    const leatherRes = await fetch(`${BASE_URL}/api/v2/companies/me/resource-ability/46/`, { headers });
    assert.equal(leatherRes.status, 200);
    const leatherData = (await leatherRes.json()) as { kind: number; quality: number; patents: number };
    assert.equal(leatherData.kind, 46);

    // Rocket Fuel (83) -> Energy (2)
    const fuelRes = await fetch(`${BASE_URL}/api/v2/companies/me/resource-ability/83/`, { headers });
    assert.equal(fuelRes.status, 200);
    const fuelData = (await fuelRes.json()) as { kind: number; quality: number; patents: number };
    assert.equal(fuelData.kind, 83);
    console.log('  ✔ Resource ability endpoints returned valid discipline mappings');

    // 4B: Test Quality Thresholds in Database & API response
    // Set 12 patents in Energy (discipline 2) -> Power (1) must become Q1
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO research (company_id, discipline, points, patents)
      VALUES (?, 2, 600, 12)
    `).run(user.companyId);

    const powerQ1Res = await fetch(`${BASE_URL}/api/v2/companies/me/resource-ability/1/`, { headers });
    assert.equal(powerQ1Res.status, 200);
    const powerQ1Data = (await powerQ1Res.json()) as { quality: number; patents: number; patentsNeeded: number };
    assert.equal(powerQ1Data.quality, 1, '12 patents must reflect Quality 1');
    assert.equal(powerQ1Data.patents, 12);
    assert.equal(powerQ1Data.patentsNeeded, 62, 'Next tier after Q1 requires 62 patents');
    console.log('  ✔ 12 patents correctly evaluated as Quality 1 (patentsNeeded = 62)');

    // Update to 62 patents in Energy -> Power (1) must become Q2
    db.prepare(`
      UPDATE research SET patents = 62 WHERE company_id = ? AND discipline = 2
    `).run(user.companyId);

    const powerQ2Res = await fetch(`${BASE_URL}/api/v2/companies/me/resource-ability/1/`, { headers });
    assert.equal(powerQ2Res.status, 200);
    const powerQ2Data = (await powerQ2Res.json()) as { quality: number; patents: number; patentsNeeded: number };
    assert.equal(powerQ2Data.quality, 2, '62 patents must reflect Quality 2');
    assert.equal(powerQ2Data.patents, 62);
    assert.equal(powerQ2Data.patentsNeeded, 562, 'Next tier after Q2 requires 562 patents');
    console.log('  ✔ 62 patents correctly evaluated as Quality 2 (patentsNeeded = 562)');

    // 4C: Test Research Application with CTO Science Skill
    // Set up CTO executive with science skill = 20
    db.prepare(`
      UPDATE executives
      SET position = 'cto', skill_science = 20, status = 'employed'
      WHERE company_id = ? AND LOWER(position) = 'cto'
    `).run(user.companyId);

    // Stock Plant Research (resource 29) in warehouse: 1,000 units
    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 29, 0, 1000, 0, 0, 0, 0, 10.0, ?)
    `).run(user.companyId, now);

    // Apply 42 points to Plant Research (discipline 1)
    // 42 points with 20% CTO science skill: 42 * 1.20 = 50.4 -> awards 1 patent!
    const applyRes = await fetch(`${BASE_URL}/api/v3/players/research/apply/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ discipline: 1, points: 42 })
    });
    assert.equal(applyRes.status, 200, 'Applying research with CTO should succeed');
    const applyData = (await applyRes.json()) as {
      research: Record<string, { discipline: number; points: number; patents: number; qualityCap: number }>;
    };

    assert.equal(applyData.research['1'].points, 42);
    assert.equal(applyData.research['1'].patents, 1, '42 points + 20% CTO science boost must award 1 patent');
    console.log('  ✔ Research application with CTO science skill yielded 1 patent from 42 points (boost confirmed)');

    // Clean up db
    db.close();
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      try {
        if (existsSync(server.dataDir)) {
          rmSync(server.dataDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup failure
      }
    }
  }

  console.log('\n================================================================');
  console.log(' ✅ ISSUE #86 RESEARCH VERIFICATION PASSED WITH 0 ERRORS');
  console.log('================================================================\n');
}

runIssue86Verification().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
