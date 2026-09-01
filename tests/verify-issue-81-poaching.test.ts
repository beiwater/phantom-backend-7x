/**
 * Verification test for Issue #81: Executive Poaching & Headhunter Agencies Subsystem
 *
 * Requirements:
 * 1. Agency Search & Poaching Tiers:
 *    - In-House (IN_HOUSE): 0x fee
 *    - Staffing Agency (STAFFING_AGENCY): 0.5x expected salary fee
 *    - Good Agency (GOOD_AGENCY): 2x expected salary fee
 *    - Top Talent Agency (TOP_TALENT_AGENCY): 5x expected salary fee
 *    - Dismissal severance = executive.salary * 3
 *    - Research employer costs 5 SimBoosts
 *
 * 2. Endpoints:
 *    - POST /api/v2/companies/executives/my-offers/
 *    - PATCH /api/v2/companies/executives/my-offers/:id/
 *    - GET /api/v3/companies/executives/hostile-offers/
 *    - POST /api/v3/companies/executives/hostile-offers/:id/counter/
 *
 * Run with:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-81-poaching.test.ts
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '3650';
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface ApiResult {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
}

function errorText(json: ApiResult['json']): string {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'error' in json) {
    return String((json as { error: unknown }).error);
  }
  return JSON.stringify(json);
}

async function api(
  cookie: string,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<ApiResult> {
  const response = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: ApiResult['json'] = null;
  try {
    json = await response.json();
  } catch {
    // empty response
  }
  return { status: response.status, json };
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `poach_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Company_${label}_${Date.now()}` })
  });
  assert.equal(response.status, 200, `Registration failed: ${response.status}`);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie missing');

  const auth = await api(cookie as string, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(auth.status, 200);
  const authJson = auth.json as { authCompany: { companyId: number } };
  const companyId = authJson.authCompany.companyId;
  return { cookie: cookie as string, companyId };
}

async function getAuthCompany(cookie: string): Promise<{ money: number; simBoosts: number; level: number }> {
  const r = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(r.status, 200);
  const auth = r.json as { authCompany: { money: number; simBoosts: number; level: number } };
  return auth.authCompany;
}

async function waitUntilReady(url: string, timeoutMs: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const deadline = Date.now() + timeoutMs;
  const probe = async () => {
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // wait for server readiness
      }
      const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
      setTimeout(delayResolve, 150);
      await delayPromise;
    }
    reject(new Error(`Server at ${url} failed to start within ${timeoutMs}ms`));
  };
  void probe();
  return promise;
}

async function runTests(): Promise<void> {
  console.log('================================================================');
  console.log(' Starting Issue #81: Executive Poaching Subsystem Verification');
  console.log('================================================================\n');

  // 1. Setup two players: Poacher (User 1) and Target Employer (User 2)
  console.log('[Setup] Registering Poacher and Target Employer companies...');
  const poacher = await register('poacher');
  const employer = await register('employer');

  // Initialize and seed default executives for both companies
  const poacherExecsRes = await api(poacher.cookie, 'GET', '/api/v4/executives/');
  assert.equal(poacherExecsRes.status, 200);

  const employerExecsRes = await api(employer.cookie, 'GET', '/api/v4/executives/');
  assert.equal(employerExecsRes.status, 200);
  const employerExecsData = employerExecsRes.json as { executives: Array<{ id: number; name: string; salary: number; position: string }> };
  assert.ok(employerExecsData.executives.length > 0, 'Employer must have default executives');

  const targetExec = employerExecsData.executives[0];
  console.log(`  -> Poacher Company ID: ${poacher.companyId}`);
  console.log(`  -> Employer Company ID: ${employer.companyId}`);
  console.log(`  -> Target Executive: ${targetExec.name} (ID: ${targetExec.id}, Salary: $${targetExec.salary})`);

  // -------------------------------------------------------------
  // Test 1: Agency Search Fee Calculations (0x, 0.5x, 2x, 5x)
  // -------------------------------------------------------------
  console.log('\n[Test 1] Verifying Agency Search Fee Calculations...');

  // 1a. In-House (IN_HOUSE / 1): 0x fee
  const poacherBefore1 = await getAuthCompany(poacher.cookie);
  const inHouseRes = await api(poacher.cookie, 'POST', '/api/v2/companies/executives/my-offers/', {
    slotPosition: 'coo',
    agency: 1, // IN_HOUSE
    targetExecutiveId: targetExec.id,
    expectedSalary: targetExec.salary
  });
  assert.equal(inHouseRes.status, 200, `IN_HOUSE search failed: ${errorText(inHouseRes.json)}`);
  const inHouseOffer = inHouseRes.json as { id: number; agencyFee: number; status: string; agency: number };
  assert.equal(inHouseOffer.agencyFee, 0, 'In-house agency fee must be 0');
  assert.equal(inHouseOffer.status, 'f', 'Initial status must be ru.FOUND (f)');
  const poacherAfter1 = await getAuthCompany(poacher.cookie);
  assert.equal(poacherAfter1.money, poacherBefore1.money, '0x fee should not deduct any money');
  console.log('  -> IN_HOUSE (0x): Fee = $0, Money deduction = $0 (PASS)');

  // 1b. Staffing Agency (STAFFING_AGENCY / 2): 0.5x expected salary fee
  const poacherBefore2 = await getAuthCompany(poacher.cookie);
  const staffingRes = await api(poacher.cookie, 'POST', '/api/v2/companies/executives/my-offers/', {
    slotPosition: 'cfo',
    agency: 2, // STAFFING_AGENCY
    targetExecutiveId: targetExec.id,
    expectedSalary: targetExec.salary
  });
  assert.equal(staffingRes.status, 200, `STAFFING_AGENCY search failed: ${errorText(staffingRes.json)}`);
  const staffingOffer = staffingRes.json as { id: number; agencyFee: number; status: string; agency: number };
  const expectedFee2 = Math.round(targetExec.salary * 0.5);
  assert.equal(staffingOffer.agencyFee, expectedFee2, `Staffing fee should be 0.5x ($${expectedFee2})`);
  const poacherAfter2 = await getAuthCompany(poacher.cookie);
  assert.equal(poacherAfter2.money, poacherBefore2.money - expectedFee2, '0.5x fee accurately deducted from balance');
  console.log(`  -> STAFFING_AGENCY (0.5x): Fee = $${expectedFee2}, Deducted accurately (PASS)`);

  // 1c. Good Agency (GOOD_AGENCY / 3): 2.0x expected salary fee
  const poacherBefore3 = await getAuthCompany(poacher.cookie);
  const goodAgencyRes = await api(poacher.cookie, 'POST', '/api/v2/companies/executives/my-offers/', {
    slotPosition: 'cto',
    agency: 'GOOD_AGENCY', // string name support
    targetExecutiveId: targetExec.id,
    expectedSalary: targetExec.salary
  });
  assert.equal(goodAgencyRes.status, 200, `GOOD_AGENCY search failed: ${errorText(goodAgencyRes.json)}`);
  const goodOffer = goodAgencyRes.json as { id: number; agencyFee: number; status: string; agency: number };
  const expectedFee3 = Math.round(targetExec.salary * 2.0);
  assert.equal(goodOffer.agencyFee, expectedFee3, `Good agency fee should be 2x ($${expectedFee3})`);
  const poacherAfter3 = await getAuthCompany(poacher.cookie);
  assert.equal(poacherAfter3.money, poacherBefore3.money - expectedFee3, '2.0x fee accurately deducted from balance');
  console.log(`  -> GOOD_AGENCY (2.0x): Fee = $${expectedFee3}, Deducted accurately (PASS)`);

  // 1d. Top Talent Agency (TOP_TALENT_AGENCY / 4): 5.0x expected salary fee
  const poacherBefore4 = await getAuthCompany(poacher.cookie);
  const topAgencyRes = await api(poacher.cookie, 'POST', '/api/v2/companies/executives/my-offers/', {
    slotPosition: 'coo',
    agency: 4, // TOP_TALENT_AGENCY
    targetExecutiveId: targetExec.id,
    expectedSalary: targetExec.salary
  });
  assert.equal(topAgencyRes.status, 200, `TOP_TALENT_AGENCY search failed: ${errorText(topAgencyRes.json)}`);
  const topOffer = topAgencyRes.json as { id: number; agencyFee: number; status: string; agency: number };
  const expectedFee4 = Math.round(targetExec.salary * 5.0);
  assert.equal(topOffer.agencyFee, expectedFee4, `Top talent fee should be 5x ($${expectedFee4})`);
  const poacherAfter4 = await getAuthCompany(poacher.cookie);
  assert.equal(poacherAfter4.money, poacherBefore4.money - expectedFee4, '5.0x fee accurately deducted from balance');
  console.log(`  -> TOP_TALENT_AGENCY (5.0x): Fee = $${expectedFee4}, Deducted accurately (PASS)`);

  // -------------------------------------------------------------
  // Test 2: Offer Extension and Target Employer View
  // -------------------------------------------------------------
  console.log('\n[Test 2] Verifying Hostile Offer Extension & Employer Notifications...');

  const activeOfferId = staffingOffer.id;
  const offeredSalary = Math.round(targetExec.salary * 1.5);

  // Extend formal offer
  const extendRes = await api(poacher.cookie, 'PATCH', `/api/v2/companies/executives/my-offers/${activeOfferId}/`, {
    executive: true,
    salary: offeredSalary
  });
  assert.equal(extendRes.status, 200, `Extend offer failed: ${errorText(extendRes.json)}`);
  const extendedOffer = extendRes.json as { id: number; status: string; salary: number; extended?: string };
  assert.equal(extendedOffer.status, 's', 'Status must transition to ru.STANDING (s)');
  assert.equal(extendedOffer.salary, offeredSalary, 'Offered salary must be stored');
  console.log(`  -> Offer #${activeOfferId} extended with salary $${offeredSalary}, status set to 's'`);

  // Target employer views incoming hostile offers via GET /api/v3/companies/executives/hostile-offers/
  const employerHostileRes = await api(employer.cookie, 'GET', '/api/v3/companies/executives/hostile-offers/');
  assert.equal(employerHostileRes.status, 200, `GET hostile-offers failed: ${errorText(employerHostileRes.json)}`);
  const hostileData = employerHostileRes.json as { offers: Array<{ id: number; executiveId: number; salary: number; status: string }> };
  assert.ok(hostileData.offers.length > 0, 'Target employer must receive hostile offers');

  const incomingOffer = hostileData.offers.find(o => o.id === activeOfferId);
  assert.ok(incomingOffer, `Hostile offer #${activeOfferId} must appear in target employer incoming list`);
  assert.equal(incomingOffer.executiveId, targetExec.id);
  assert.equal(incomingOffer.salary, offeredSalary);
  assert.equal(incomingOffer.status, 's');
  console.log('  -> Target employer successfully received and viewed hostile offer (PASS)');

  // -------------------------------------------------------------
  // Test 3: Research Employer & Poacher (5 SimBoosts)
  // -------------------------------------------------------------
  console.log('\n[Test 3] Verifying Research Employer & Poacher (5 SimBoosts each)...');

  // 3a. Poacher researches target employer
  const poacherSBBefore = (await getAuthCompany(poacher.cookie)).simBoosts;
  const researchEmpRes = await api(poacher.cookie, 'PUT', `/api/v2/companies/executives/my-offers/${activeOfferId}/`);
  assert.equal(researchEmpRes.status, 200, `Research employer failed: ${errorText(researchEmpRes.json)}`);
  const researchEmpData = researchEmpRes.json as { simboostsDelta: number; researchPoacher: Record<string, unknown> };
  assert.equal(researchEmpData.simboostsDelta, -5, 'SimBoosts delta must be -5');
  assert.ok(researchEmpData.researchPoacher, 'Research poacher data must be returned');
  const poacherSBAfter = (await getAuthCompany(poacher.cookie)).simBoosts;
  assert.equal(poacherSBAfter, poacherSBBefore - 5, '5 SimBoosts deducted from poacher');
  console.log('  -> Research Employer: 5 SimBoosts debited, research data populated (PASS)');

  // 3b. Employer researches poacher
  const employerSBBefore = (await getAuthCompany(employer.cookie)).simBoosts;
  const researchPoacherRes = await api(employer.cookie, 'PUT', `/api/v3/companies/executives/hostile-offers/${activeOfferId}/`);
  assert.equal(researchPoacherRes.status, 200, `Research poacher failed: ${errorText(researchPoacherRes.json)}`);
  const researchPoacherData = researchPoacherRes.json as { simboostsDelta: number; researchEmployer: Record<string, unknown> };
  assert.equal(researchPoacherData.simboostsDelta, -5, 'SimBoosts delta must be -5');
  assert.ok(researchPoacherData.researchEmployer, 'Research employer data must be returned');
  const employerSBAfter = (await getAuthCompany(employer.cookie)).simBoosts;
  assert.equal(employerSBAfter, employerSBBefore - 5, '5 SimBoosts deducted from employer');
  console.log('  -> Research Poacher: 5 SimBoosts debited, research data populated (PASS)');

  // -------------------------------------------------------------
  // Test 4: Offer Status Transitions (ru.OUTDATED, ru.REFUSED)
  // -------------------------------------------------------------
  console.log('\n[Test 4] Verifying Status Transitions (ru.OUTDATED, ru.REFUSED)...');

  // Set to ru.OUTDATED
  const outdatedRes = await api(poacher.cookie, 'PATCH', `/api/v2/companies/executives/my-offers/${inHouseOffer.id}/`, {
    status: 'ru.OUTDATED'
  });
  assert.equal(outdatedRes.status, 200);
  assert.equal((outdatedRes.json as { status: string }).status, 'o', 'Status must normalize to "o" (ru.OUTDATED)');

  // Set to ru.REFUSED
  const refusedRes = await api(poacher.cookie, 'PATCH', `/api/v2/companies/executives/my-offers/${goodOffer.id}/`, {
    status: 'ru.REFUSED'
  });
  assert.equal(refusedRes.status, 200);
  assert.equal((refusedRes.json as { status: string }).status, 'r', 'Status must normalize to "r" (ru.REFUSED)');
  console.log('  -> ru.OUTDATED and ru.REFUSED status updates verified (PASS)');

  // -------------------------------------------------------------
  // Test 5: Target Employer Counter-Offer (Raise Salary & Retain Executive)
  // -------------------------------------------------------------
  console.log('\n[Test 5] Verifying Target Employer Counter-Offer with Higher Salary...');

  const counterSalary = Math.round(offeredSalary * 1.1); // Match & beat the offer
  const counterRes = await api(employer.cookie, 'POST', `/api/v3/companies/executives/hostile-offers/${activeOfferId}/counter/`, {
    action: 'counter',
    salary: counterSalary
  });
  assert.equal(counterRes.status, 200, `Counter offer failed: ${errorText(counterRes.json)}`);
  const counterData = counterRes.json as {
    success: boolean;
    retained: boolean;
    executive: { id: number; salary: number };
    offer: { status: string };
  };
  assert.equal(counterData.success, true);
  assert.equal(counterData.retained, true, 'Executive must be retained');
  assert.equal(counterData.executive.salary, counterSalary, `Executive salary must be raised to $${counterSalary}`);
  assert.equal(counterData.offer.status, 'r', 'Offer status must become ru.REFUSED (r)');

  // Verify executive is still at employer company with new salary
  const employerExecsCheck = await api(employer.cookie, 'GET', '/api/v4/executives/');
  const retainedExec = (employerExecsCheck.json as { executives: Array<{ id: number; salary: number }> })
    .executives.find(e => e.id === targetExec.id);
  assert.ok(retainedExec, 'Executive must remain employed at target employer');
  assert.equal(retainedExec.salary, counterSalary, 'Salary update must persist');
  console.log(`  -> Counter-offer succeeded: Executive retained with new salary $${counterSalary} (PASS)`);

  // -------------------------------------------------------------
  // Test 6: Accept Departure / Let Go to Competitor (0 Severance)
  // -------------------------------------------------------------
  console.log('\n[Test 6] Verifying Accept Departure (Let Go to Competitor, 0 Severance)...');

  // Create another target executive at employer
  const employerExec2 = (employerExecsData.executives[1]) || targetExec;

  // Poacher creates new offer for employerExec2
  const poach2Res = await api(poacher.cookie, 'POST', '/api/v2/companies/executives/my-offers/', {
    slotPosition: 'cfo',
    agency: 2,
    targetExecutiveId: employerExec2.id,
    expectedSalary: employerExec2.salary
  });
  assert.equal(poach2Res.status, 200);
  const poach2Offer = poach2Res.json as { id: number };

  // Extend offer
  await api(poacher.cookie, 'PATCH', `/api/v2/companies/executives/my-offers/${poach2Offer.id}/`, {
    executive: true,
    salary: 800
  });

  // Employer accepts departure via POST .../counter/ with action: 'accept'
  const empMoneyBeforeAccept = (await getAuthCompany(employer.cookie)).money;
  const acceptRes = await api(employer.cookie, 'POST', `/api/v3/companies/executives/hostile-offers/${poach2Offer.id}/counter/`, {
    action: 'accept'
  });
  assert.equal(acceptRes.status, 200, `Accept departure failed: ${errorText(acceptRes.json)}`);
  const acceptData = acceptRes.json as { success: boolean; stayed: boolean; moneyDelta: number; offer: { status: string } };
  assert.equal(acceptData.success, true);
  assert.equal(acceptData.stayed, false, 'Executive must leave company');
  assert.equal(acceptData.moneyDelta, 0, 'Departure severance must be 0');
  assert.equal(acceptData.offer.status, 'a', 'Offer status must become ru.ACCEPTED (a)');

  const empMoneyAfterAccept = (await getAuthCompany(employer.cookie)).money;
  assert.equal(empMoneyAfterAccept, empMoneyBeforeAccept, 'No severance paid on executive departure');

  // Verify executive moved to poacher company
  const poacherExecsAfter = await api(poacher.cookie, 'GET', '/api/v4/executives/');
  const movedExec = (poacherExecsAfter.json as { executives: Array<{ id: number }> })
    .executives.find(e => e.id === employerExec2.id);
  assert.ok(movedExec, 'Transferred executive must now belong to poacher company');
  console.log('  -> Executive departed with 0 severance and joined poacher company (PASS)');

  // -------------------------------------------------------------
  // Test 7: Dismissal Severance (executive.salary * 3)
  // -------------------------------------------------------------
  console.log('\n[Test 7] Verifying Dismissal Severance (executive.salary * 3)...');

  const poacherExecsForFire = (await api(poacher.cookie, 'GET', '/api/v4/executives/')).json as {
    executives: Array<{ id: number; salary: number }>;
  };
  assert.ok(poacherExecsForFire.executives.length > 0, 'Poacher has executives to fire');
  const execToFire = poacherExecsForFire.executives[0];
  const expectedSeverance = Math.round(execToFire.salary * 3);

  const poacherMoneyBeforeFire = (await getAuthCompany(poacher.cookie)).money;
  const fireRes = await api(poacher.cookie, 'DELETE', `/api/v4/executives/${execToFire.id}/`);
  assert.equal(fireRes.status, 200, `Fire executive failed: ${errorText(fireRes.json)}`);
  const fireData = fireRes.json as { success: boolean; severance: number; moneyDelta: number };
  assert.equal(fireData.success, true);
  assert.equal(fireData.severance, expectedSeverance, `Severance must equal salary * 3 ($${expectedSeverance})`);

  const poacherMoneyAfterFire = (await getAuthCompany(poacher.cookie)).money;
  assert.equal(poacherMoneyAfterFire, poacherMoneyBeforeFire - expectedSeverance, 'Severance deducted from company balance');
  console.log(`  -> Fired executive (salary $${execToFire.salary}): Severance $${expectedSeverance} accurately deducted (PASS)`);

  console.log('\n================================================================');
  console.log(' ALL ISSUE #81 EXECUTIVE POACHING TESTS PASSED (0 ERRORS)');
  console.log('================================================================');
}

async function main(): Promise<void> {
  const dataDir = path.resolve('data', `test-run-i81-${Date.now()}`);
  console.log(`Starting test server on port ${PORT} with DATA_DIR=${dataDir}...`);

  const child: ChildProcess = spawn(
    '/opt/magnate/.node22/bin/node',
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(PORT),
        SPEED_MULTIPLIER: '200',
        DATA_DIR: dataDir,
        INITIAL_LEVEL: '15' // Grant level 15 by default for capability unlock
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  child.stdout?.on('data', chunk => {
    process.stdout.write(`[server:out] ${chunk}`);
  });
  child.stderr?.on('data', chunk => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) {
      process.stderr.write(`[server:err] ${text}`);
    }
  });
  try {
    await waitUntilReady(`${BASE_URL}/version/`, 60000);
    await runTests();
  } finally {
    child.kill('SIGTERM');
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  }
}

main().catch(err => {
  console.error('\nTest crashed with error:', err);
  process.exit(1);
});
