/**
 * Verification test suite for Issue #79: Government Orders subsystem
 *
 * Verifies:
 * 1. Standard government procurement projects for all 7 agencies (Fire Dept, NASA, Defense, EPA, Agriculture, Energy, Healthcare)
 * 2. Tier scaling and resourceMultiplicator calculation (T1-T10 based on company level)
 * 3. Multi-contractor bid submission (3-7 contractors validation, 10% security deposit transactional deduction)
 * 4. Contractor queries, resource allocation, and blocked company management
 * 5. Company applications and bids listing
 *
 * Run with Node 22:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-79-government.test.ts
 */

import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '3630';
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

interface ApiResult {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
}

function errorText(json: ApiResult['json']): string {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'error' in json) {
    return String(json.error);
  }
  return JSON.stringify(json);
}

async function api(
  cookie: string,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let json: Record<string, unknown> | unknown[] | null = null;
  try {
    json = (await response.json()) as Record<string, unknown> | unknown[];
  } catch {
    // Non-JSON response
  }
  return { status: response.status, json };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `gov_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Gov Co ${label} ${Date.now()}` })
  });

  assert.equal(response.status, 200, `Registration failed for ${label}: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie missing');

  const auth = await api(cookie as string, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(auth.status, 200);
  const companyId = (auth.json as { authCompany: { companyId: number } }).authCompany.companyId;
  return { cookie: cookie as string, companyId };
}

async function waitUntilReachable(url: string, timeoutMs: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const deadline = Date.now() + timeoutMs;
  const probe = async (): Promise<void> => {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {
        // Retry
      }
      await new Promise(res => setTimeout(res, 400));
    }
    reject(new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`));
  };
  void probe();
  return promise;
}

interface TestServer {
  child: ChildProcess;
  dataDir: string;
  port: number;
}

async function startTestServer(portNumber: number): Promise<TestServer> {
  const dataDir = path.resolve('data', `test-run-gov-${portNumber}-${Date.now()}`);
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(portNumber),
        SPEED_MULTIPLIER: '200',
        DATA_DIR: dataDir
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', chunk => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) {
      process.stderr.write(`[test-srv] ${text}`);
    }
  });

  await waitUntilReachable(`http://127.0.0.1:${portNumber}/version/`, 30000);
  return { child, dataDir, port: portNumber };
}

interface TestOutcome {
  name: string;
  ok: boolean;
  error?: unknown;
}

async function runGovernmentOrdersTests(): Promise<TestOutcome[]> {
  const results: TestOutcome[] = [];

  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ PASS: ${name}`);
    } catch (err: unknown) {
      results.push({ name, ok: false, error: err });
      console.error(`  ✗ FAIL: ${name}`);
      console.error(err instanceof Error ? err.message : err);
    }
  }

  // Setup test companies
  const companyMain = await registerCompany('main');
  const companySub1 = await registerCompany('sub1');
  const companySub2 = await registerCompany('sub2');
  const companySub3 = await registerCompany('sub3');
  const companyBlocked = await registerCompany('blocked');

  // Helper to get company money
  async function getMoney(cookie: string): Promise<number> {
    const auth = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
    const authObj = auth.json as { authCompany: { money: number } };
    return Number(authObj.authCompany.money);
  }

  // Helper to set company money and level directly via test cheat/update if available, or using internal db
  // Since we run against isolated test server, let's use account cheat or api if available, or check balance
  let currentMainMoney = await getMoney(companyMain.cookie);

  console.log('\n--- 1. Projects & Agencies Data ---');

  await test('GET /api/v3/government-orders/ returns standard projects for 7 agencies', async () => {
    const res = await api('', 'GET', '/api/v3/government-orders/');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    assert.ok(res.json && Array.isArray(res.json.governmentOrders), 'Expected governmentOrders array in response');

    const orders = (res.json as { governmentOrders: Array<{
      id: number;
      projectKey: string;
      agency: string;
      estimatedBaseValue: number;
      daysToFulfill: number;
      startDate?: string;
      created: string;
      deadline: string;
      governmentorderrequiredresourceSet: Array<{ kind: number; amountBase: number }>;
    }> }).governmentOrders;
    assert.ok(orders.length >= 7, `Expected at least 7 government projects, got ${orders.length}`);

    const agencies = orders.map(o => o.agency);
    assert.ok(agencies.includes('FIRE_DEPARTMENT'), 'Missing FIRE_DEPARTMENT');
    assert.ok(agencies.includes('SPACE_EXPLORATION_AGENCY'), 'Missing SPACE_EXPLORATION_AGENCY');
    assert.ok(agencies.includes('DEPARTMENT_OF_DEFENSE'), 'Missing DEPARTMENT_OF_DEFENSE');
    assert.ok(agencies.includes('ENVIRONMENTAL_PROTECTION_AGENCY'), 'Missing ENVIRONMENTAL_PROTECTION_AGENCY');
    assert.ok(agencies.includes('DEPARTMENT_OF_AGRICULTURE'), 'Missing DEPARTMENT_OF_AGRICULTURE');
    assert.ok(agencies.includes('ENERGY_DEPARTMENT'), 'Missing ENERGY_DEPARTMENT');
    assert.ok(agencies.includes('PUBLIC_HEALTH_DEPARTMENT'), 'Missing PUBLIC_HEALTH_DEPARTMENT');

    // Verify required resources in projects (e.g. kind 3 Apples, kind 12 Diesel/Gasoline, kind 18 Steel/Power, kind 100 Aerospace Research)
    const allResources = orders.flatMap(o => o.governmentorderrequiredresourceSet || []);
    const resourceKinds = allResources.map(r => r.kind);
    assert.ok(resourceKinds.includes(3), 'Missing resource kind 3 (Apples)');
    assert.ok(resourceKinds.includes(12), 'Missing resource kind 12 (Diesel/Gasoline)');
    assert.ok(resourceKinds.includes(18), 'Missing resource kind 18 (Steel/Aluminium)');
    assert.ok(resourceKinds.includes(100), 'Missing resource kind 100 (Aerospace Research)');

    // Verify project deadlines and dates
    for (const project of orders) {
      assert.ok(project.id > 0, 'Project ID must be positive number');
      assert.ok(project.projectKey, 'Project must have projectKey');
      assert.ok(project.estimatedBaseValue > 0, 'Project must have estimatedBaseValue');
      assert.ok(project.daysToFulfill > 0, 'Project must have daysToFulfill');
      assert.ok(project.startDate || project.created, 'Project must have start date');
      assert.ok(project.deadline, 'Project must have deadline');
    }
  });

  await test('GET /api/v3/government-orders/realm/0/ returns projects with realm compatibility', async () => {
    const res = await api('', 'GET', '/api/v3/government-orders/realm/0/');
    assert.equal(res.status, 200);
    assert.ok(res.json && Array.isArray(res.json.governmentOrders));
    assert.ok(res.json.governmentOrders.length >= 7);
  });

  console.log('\n--- 2. Tier System & Scaling ---');

  await test('GET /api/v3/government-orders/tier/ returns company tier and resourceMultiplicator', async () => {
    const res = await api(companyMain.cookie, 'GET', '/api/v3/government-orders/tier/');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    assert.ok(res.json.tier, 'Expected tier object');
    assert.equal(typeof res.json.tier.tierIndex, 'number', 'tierIndex must be number');
    assert.equal(typeof res.json.tier.resourceMultiplicator, 'number', 'resourceMultiplicator must be number');

    // Fresh company (level 1) should be T1 with multiplier 1.0
    assert.equal(res.json.tier.tierIndex, 1, 'Level 1 company should be Tier 1');
    assert.equal(res.json.tier.resourceMultiplicator, 1.0, 'Tier 1 resourceMultiplicator should be 1.0');
  });

  console.log('\n--- 3. Multi-Contractor Bid Submission & Security Deposit ---');

  let fireProject: { id: number; estimatedBaseValue: number; agency: string };
  const listRes = await api('', 'GET', '/api/v3/government-orders/');
  const govList = (listRes.json as { governmentOrders: Array<{ id: number; estimatedBaseValue: number; agency: string }> }).governmentOrders;
  const foundProject = govList.find(o => o.agency === 'FIRE_DEPARTMENT');
  assert.ok(foundProject, 'Fire department project not found');
  fireProject = foundProject;

  await test('POST /api/v3/government-orders/bids/ validates contractor count (3 to 7)', async () => {
    // Test < 3 contractors (e.g. 2)
    const tooFew = await api(companyMain.cookie, 'POST', '/api/v3/government-orders/bids/', {
      templateId: fireProject.id,
      maxContractorCount: 2
    });
    assert.equal(tooFew.status, 400, 'Expected 400 for maxContractorCount < 3');
    assert.match(errorText(tooFew.json), /between 3 and 7/i);

    // Test > 7 contractors (e.g. 8)
    const tooMany = await api(companyMain.cookie, 'POST', '/api/v3/government-orders/bids/', {
      templateId: fireProject.id,
      maxContractorCount: 8
    });
    assert.equal(tooMany.status, 400, 'Expected 400 for maxContractorCount > 7');
    assert.match(errorText(tooMany.json), /between 3 and 7/i);
  });

  let createdBidSecret = '';
  let createdBidId = 0;

  await test('POST /api/v3/government-orders/bids/ creates bid and deducts 10% deposit', async () => {
    const moneyBefore = await getMoney(companyMain.cookie);
    // Estimated value is 260,000, 10% security deposit = 26,000
    const expectedDeposit = Math.floor(fireProject.estimatedBaseValue * 1.0 * 0.1); // 26000

    const createRes = await api(companyMain.cookie, 'POST', '/api/v3/government-orders/bids/', {
      templateId: fireProject.id,
      maxContractorCount: 5,
      isPublic: true,
      minimumRequiredTierIndex: 1,
      resourcePriceBreakdown: {
        '12': 42.0,
        '48': 210.0,
        '18': 105.0
      },
      note: 'Municipal fleet logistics bid'
    });

    assert.equal(createRes.status, 201, `Bid creation failed: ${errorText(createRes.json)}`);
    assert.ok(createRes.json.secret, 'Bid secret must be generated');
    assert.ok(createRes.json.governmentorderbidderSet, 'Bidder set must be present');
    assert.equal(createRes.json.governmentorderbidderSet.length, 1, 'Creator should be first contractor');

    const creatorBidder = createRes.json.governmentorderbidderSet[0];
    assert.equal(creatorBidder.companyId, companyMain.companyId);
    assert.equal(creatorBidder.isMainContractor, true);
    assert.equal(creatorBidder.depositPaid, expectedDeposit, `Deposit paid should be $${expectedDeposit}`);

    createdBidSecret = createRes.json.secret;
    createdBidId = createRes.json.id;

    // Verify 10% deposit was deducted from company balance
    const moneyAfter = await getMoney(companyMain.cookie);
    assert.equal(moneyAfter, moneyBefore - expectedDeposit, `Money balance should be reduced by deposit ($${expectedDeposit})`);
  });

  console.log('\n--- 4. Bid Details & Contractor Participation ---');

  await test('GET /api/v3/government-orders/bids/:id/ returns bid details with status and contractors', async () => {
    const getRes = await api('', 'GET', `/api/v3/government-orders/bids/${createdBidSecret}/`);
    assert.equal(getRes.status, 200, `Get bid failed: ${errorText(getRes.json)}`);
    assert.equal(getRes.json.secret, createdBidSecret);
    assert.equal(getRes.json.templateId, fireProject.id);
    assert.equal(getRes.json.maxContractorCount, 5);
    assert.equal(getRes.json.status, 'OPEN');
    assert.ok(Array.isArray(getRes.json.governmentorderbidderSet));
  });

  await test('POST & GET /api/v3/government-orders/bids/:id/contractors/ manages multi-contractor joining', async () => {
    // Subcontractor 1 joins
    const join1 = await api(companySub1.cookie, 'POST', `/api/v3/government-orders/bids/${createdBidSecret}/contractors/`);
    assert.equal(join1.status, 200, `Sub1 join failed: ${errorText(join1.json)}`);

    // Subcontractor 2 joins
    const join2 = await api(companySub2.cookie, 'POST', `/api/v3/government-orders/bids/${createdBidSecret}/contractors/`);
    assert.equal(join2.status, 200, `Sub2 join failed: ${errorText(join2.json)}`);

    // Subcontractor 3 joins
    const join3 = await api(companySub3.cookie, 'POST', `/api/v3/government-orders/bids/${createdBidSecret}/contractors/`);
    assert.equal(join3.status, 200, `Sub3 join failed: ${errorText(join3.json)}`);

    // Query contractors list via GET /contractors/
    const contractorsRes = await api('', 'GET', `/api/v3/government-orders/bids/${createdBidSecret}/contractors/`);
    assert.equal(contractorsRes.status, 200, `Get contractors failed: ${errorText(contractorsRes.json)}`);

    const contractors = Array.isArray(contractorsRes.json) ? contractorsRes.json : contractorsRes.json.contractors;
    assert.ok(Array.isArray(contractors), 'Contractors must be an array');
    assert.equal(contractors.length, 4, 'Should have 4 participating contractors (Main + 3 Subs)');

    const companyIds = (contractors as Array<{ companyId: number }>).map(c => c.companyId);
    assert.ok(companyIds.includes(companySub1.companyId), 'Sub1 company missing from contractors');
    assert.ok(companyIds.includes(companySub2.companyId), 'Sub2 company missing from contractors');
    assert.ok(companyIds.includes(companySub3.companyId), 'Sub3 company missing from contractors');

    // Verify allocated share and computed resource distribution
    for (const c of contractors) {
      assert.ok(c.allocatedShare > 0, 'Allocated share must be > 0');
      assert.ok(c.computedResourcesNeeded, 'Computed resources must be allocated');
    }
  });

  console.log('\n--- 5. Blocked Companies Query & Management ---');

  await test('Block, query, and unblock company operations', async () => {
    // Block companyBlocked
    const blockRes = await api(companyMain.cookie, 'POST', `/api/v3/government-orders/bids/${createdBidSecret}/blocked-companies/`, {
      companyId: companyBlocked.companyId
    });
    assert.equal(blockRes.status, 200, `Block company failed: ${errorText(blockRes.json)}`);

    // Query blocked companies
    const blockedList = await api('', 'GET', `/api/v3/government-orders/bids/${createdBidSecret}/blocked-companies/`);
    assert.equal(blockedList.status, 200);
    assert.ok(blockedList.json.blockedCompanies.includes(companyBlocked.companyId), 'companyBlocked should be in blocked list');

    // Blocked company cannot join
    const blockedJoin = await api(companyBlocked.cookie, 'POST', `/api/v3/government-orders/bids/${createdBidSecret}/contractors/`);
    assert.equal(blockedJoin.status, 400, 'Blocked company must be rejected from joining');
    assert.match(errorText(blockedJoin.json), /blocked/i);

    // Unblock companyBlocked
    const unblockRes = await api(companyMain.cookie, 'DELETE', `/api/v3/government-orders/bids/${createdBidSecret}/blocked-companies/${companyBlocked.companyId}/`);
    assert.equal(unblockRes.status, 200);

    // Verify no longer in blocked list
    const unblockedList = await api('', 'GET', `/api/v3/government-orders/bids/${createdBidSecret}/blocked-companies/`);
    assert.equal(unblockedList.status, 200);
    assert.ok(!unblockedList.json.blockedCompanies.includes(companyBlocked.companyId), 'companyBlocked should not be in blocked list');
  });

  console.log('\n--- 6. Company Submitted Bids & Applications ---');

  await test('GET /api/v3/government-orders/company/:id/ and .../bids/ return company data', async () => {
    // Query companyMain bids
    const mainBidsRes = await api('', 'GET', `/api/v3/government-orders/company/${companyMain.companyId}/bids/`);
    assert.equal(mainBidsRes.status, 200);
    assert.ok(Array.isArray(mainBidsRes.json.bids), 'Expected bids array');
    assert.ok((mainBidsRes.json as { bids: Array<{ secret: string }> }).bids.some(b => b.secret === createdBidSecret), 'Main bids should include created bid');

    // Query companySub1 applications
    const sub1AppsRes = await api('', 'GET', `/api/v3/government-orders/company/${companySub1.companyId}/`);
    assert.equal(sub1AppsRes.status, 200);
    assert.ok(Array.isArray(sub1AppsRes.json.applications), 'Expected applications array');
    assert.ok((sub1AppsRes.json as { applications: Array<{ secret: string }> }).applications.some(b => b.secret === createdBidSecret), 'Sub1 applications should include joined bid');
  });

  console.log('\n--- 7. Direct Multi-Contractor Bid Submission ---');

  await test('POST /api/v3/government-orders/bids/ supports initial contractor array (3-7 contractors)', async () => {
    const multiBidRes = await api(companyMain.cookie, 'POST', '/api/v3/government-orders/bids/', {
      templateId: fireProject.id,
      maxContractorCount: 5,
      contractors: [companyMain.companyId, companySub1.companyId, companySub2.companyId],
      isPublic: true,
      minimumRequiredTierIndex: 1,
      note: 'Pre-assembled contractor consortium'
    });

    assert.equal(multiBidRes.status, 201, `Direct multi-contractor bid failed: ${errorText(multiBidRes.json)}`);
    assert.equal(multiBidRes.json.governmentorderbidderSet.length, 3, 'Bid should have 3 initial contractors');
  });

  console.log('\n--- 8. Single Project Detail & Bid Editing/Deletion Lifecycle ---');

  await test('GET /api/v3/government-orders/realm/:templateId/ returns specific template details', async () => {
    const detailRes = await api('', 'GET', `/api/v3/government-orders/realm/${fireProject.id}/`);
    assert.equal(detailRes.status, 200);
    const detailObj = detailRes.json as { id: number; projectKey: string; agency: string };
    assert.equal(detailObj.id, fireProject.id);
    assert.equal(detailObj.agency, 'FIRE_DEPARTMENT');
  });

  await test('PATCH /api/v3/government-orders/bids/:id/ updates bid parameters', async () => {
    const patchRes = await api(companyMain.cookie, 'PATCH', `/api/v3/government-orders/bids/${createdBidSecret}/`, {
      note: 'Updated note for municipal bid',
      maxContractorCount: 6
    });
    assert.equal(patchRes.status, 200, `Patch bid failed: ${errorText(patchRes.json)}`);
    const patchObj = patchRes.json as { note: string; maxContractorCount: number };
    assert.equal(patchObj.note, 'Updated note for municipal bid');
    assert.equal(patchObj.maxContractorCount, 6);
  });

  await test('DELETE /api/v3/government-orders/bids/:id/ cancels bid and refunds security deposits', async () => {
    const moneyBefore = await getMoney(companyMain.cookie);
    const deleteRes = await api(companyMain.cookie, 'DELETE', `/api/v3/government-orders/bids/${createdBidSecret}/`);
    assert.equal(deleteRes.status, 200, `Delete bid failed: ${errorText(deleteRes.json)}`);

    const moneyAfter = await getMoney(companyMain.cookie);
    const expectedDeposit = Math.floor(fireProject.estimatedBaseValue * 1.0 * 0.1); // 26000
    assert.equal(moneyAfter, moneyBefore + expectedDeposit, `Main contractor deposit ($${expectedDeposit}) must be refunded`);

    // Verify bid is no longer found
    const getRes = await api('', 'GET', `/api/v3/government-orders/bids/${createdBidSecret}/`);
    assert.equal(getRes.status, 404, 'Deleted bid must return 404');
  });

  return results;
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log(` Starting Issue #79 Government Orders Verification on Port ${PORT}`);
  console.log('================================================================');

  const server = await startTestServer(Number(PORT));
  let results: TestOutcome[] = [];

  try {
    results = await runGovernmentOrdersTests();
  } finally {
    server.child.kill('SIGTERM');
    try {
      rmSync(server.dataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  const failures = results.filter(r => !r.ok);
  console.log('\n================================================================');
  console.log(` Summary: ${results.length - failures.length} passed, ${failures.length} failed`);
  console.log('================================================================');

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in test execution:', err);
  process.exit(1);
});
