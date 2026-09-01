/**
 * Verification test for Issue #87:
 * Executive Skills & Training Pricing & Transaction Safety
 *
 * Requirements:
 * 1. Remove || 5 coercion on executive skills; retain legitimate 0 values.
 * 2. Training cost: update trainExecutive cost to canonical $30,000.
 * 3. Cash ledger: charge training cost to cash ledger category 'h' (training costs) instead of 'g'.
 * 4. Transaction safety: in hireExecutive, perform slot capacity check inside runInTransaction
 *    to prevent concurrency race conditions.
 *
 * Run with:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-87-executives.test.ts
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = process.env.PORT || '3750';
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface ApiResult {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
}

interface ExecutiveDto {
  id: number;
  name: string;
  avatar: string;
  position: string;
  skills: {
    management: number;
    accounting: number;
    science: number;
    communication: number;
  };
  salary: number;
  status: string;
  trainingFinishAt: string | null;
  totalSkill: number;
}

interface CashLedgerEntryDto {
  id: number;
  datetime: string;
  money: number;
  category: string;
  description: string;
  descriptionKey: string;
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
  const email = `exec87_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Company87_${label}_${Date.now()}` })
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    // Brief polling delay for server startup check
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 200);
    await promise;
  }
  throw new Error(`Server at ${url} not ready within ${timeoutMs}ms`);
}

async function runTests(dataDir: string): Promise<void> {
  console.log('\n================================================================');
  console.log(' Starting Issue #87 Executive Subsystem Verification');
  console.log('================================================================\n');

  const user = await register('testUser');
  console.log(`Registered test company ID: ${user.companyId}`);

  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  const database = new DatabaseSync(dbPath);

  // -------------------------------------------------------------------------
  // Part 1: 0-Skill Retention Test
  // -------------------------------------------------------------------------
  console.log('--- [1/4] Testing 0-Skill Retention without || 5 Coercion ---');

  // Insert an employed executive with all skills = 0
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO executives (
      company_id, name, avatar, position,
      skill_management, skill_accounting, skill_science, skill_communication,
      salary, status, created_at
    ) VALUES (?, ?, 'images/avatars/male_01.png', 'coo', 0, 0, 0, 0, 300, 'employed', ?)
  `).run(user.companyId, 'Zero Skill Master', now);

  // Insert a candidate with mixed 0 and non-zero skills
  database.prepare(`
    INSERT INTO executives (
      company_id, name, avatar, position,
      skill_management, skill_accounting, skill_science, skill_communication,
      salary, status, created_at
    ) VALUES (?, ?, 'images/avatars/female_02.png', 'unassigned', 0, 7, 0, 3, 280, 'candidate', ?)
  `).run(user.companyId, 'Mixed Candidate', now);

  // Fetch executives list
  const execsRes = await api(user.cookie, 'GET', '/api/v4/executives/');
  assert.equal(execsRes.status, 200);
  const execsList = (Array.isArray(execsRes.json) ? execsRes.json : (execsRes.json as { executives?: ExecutiveDto[] })?.executives ?? []) as ExecutiveDto[];
  const zeroExec = execsList.find(e => e.name === 'Zero Skill Master');
  assert.ok(zeroExec, 'Zero Skill Master executive found in list');
  assert.equal(zeroExec.skills.management, 0, 'Management skill should be exactly 0 (not 5)');
  assert.equal(zeroExec.skills.accounting, 0, 'Accounting skill should be exactly 0 (not 5)');
  assert.equal(zeroExec.skills.science, 0, 'Science skill should be exactly 0 (not 5)');
  assert.equal(zeroExec.skills.communication, 0, 'Communication skill should be exactly 0 (not 5)');
  assert.equal(zeroExec.totalSkill, 0, 'totalSkill should be 0 (not 20)');
  console.log('  -> Employed executive with 0 skills returned exact 0s and totalSkill=0');

  // Fetch single executive details
  const singleExecRes = await api(user.cookie, 'GET', `/api/v4/executives/${zeroExec.id}/`);
  assert.equal(singleExecRes.status, 200);
  const singleExec = (singleExecRes.json as { executive: ExecutiveDto }).executive;
  assert.equal(singleExec.skills.management, 0);
  assert.equal(singleExec.skills.accounting, 0);
  assert.equal(singleExec.skills.science, 0);
  assert.equal(singleExec.skills.communication, 0);
  assert.equal(singleExec.totalSkill, 0);
  console.log('  -> Single executive GET /api/v4/executives/:id/ retained 0 skills correctly');

  // Fetch candidates list
  const candRes = await api(user.cookie, 'GET', '/api/v4/executives/candidates/');
  assert.equal(candRes.status, 200);
  const candsList = (Array.isArray(candRes.json) ? candRes.json : (candRes.json as { candidates?: ExecutiveDto[] })?.candidates ?? []) as ExecutiveDto[];
  const mixedCand = candsList.find(c => c.name === 'Mixed Candidate');
  assert.ok(mixedCand, 'Mixed Candidate found in candidates list');
  assert.equal(mixedCand.skills.management, 0, 'Candidate management skill should be 0');
  assert.equal(mixedCand.skills.accounting, 7, 'Candidate accounting skill should be 7');
  assert.equal(mixedCand.skills.science, 0, 'Candidate science skill should be 0');
  assert.equal(mixedCand.skills.communication, 3, 'Candidate communication skill should be 3');
  assert.equal(mixedCand.totalSkill, 10, 'Candidate totalSkill should be 10 (0+7+0+3)');
  console.log('  -> Candidate with mixed skills correctly retained 0s and computed totalSkill=10');

  // -------------------------------------------------------------------------
  // Part 2: Canonical $30,000 Training Cost & Cash Ledger Category 'h'
  // -------------------------------------------------------------------------
  console.log('\n--- [2/4] Testing Canonical $30,000 Training Cost & Cash Ledger Category "h" ---');

  // Give the company ample money for training
  database.prepare('UPDATE companies SET money = 100000 WHERE company_id = ?').run(user.companyId);
  const compBefore = await getAuthCompany(user.cookie);
  assert.equal(compBefore.money, 100000);

  // Train the zeroExec (all skills 0 -> all skills 1)
  const trainRes = await api(user.cookie, 'POST', `/api/v4/executives/${zeroExec.id}/train/`);
  assert.equal(trainRes.status, 200, `Training failed: ${errorText(trainRes.json)}`);
  const trainJson = trainRes.json as { cost: number; executive: ExecutiveDto };
  assert.equal(trainJson.cost, 30000, 'Training cost must be canonical $30,000');
  assert.equal(trainJson.executive.skills.management, 1, 'Management skill incremented to 1');
  assert.equal(trainJson.executive.skills.accounting, 1, 'Accounting skill incremented to 1');
  assert.equal(trainJson.executive.skills.science, 1, 'Science skill incremented to 1');
  assert.equal(trainJson.executive.skills.communication, 1, 'Communication skill incremented to 1');
  assert.equal(trainJson.executive.totalSkill, 4, 'totalSkill incremented to 4');
  console.log('  -> Training cost is canonical $30,000 and incremented all skills from 0 to 1');

  // Verify company money balance decreased by exactly $30,000
  const compAfter = await getAuthCompany(user.cookie);
  assert.equal(compAfter.money, 70000, 'Company money decreased by exactly $30,000 ($100k -> $70k)');
  console.log('  -> Company balance correctly decremented to $70,000');

  // Verify cash ledger entry via API and direct DB inspection
  const cashflowRes = await api(user.cookie, 'GET', `/api/v2/companies/${user.companyId}/cashflow/recent/`);
  assert.equal(cashflowRes.status, 200);
  const cashflowData = ((cashflowRes.json as { data?: CashLedgerEntryDto[] })?.data ?? []) as CashLedgerEntryDto[];
  assert.ok(cashflowData.length > 0, 'Cashflow entries present');
  const latestEntry = cashflowData[0];
  assert.equal(latestEntry.category, 'h', 'Cashflow category for executive training must be "h"');
  assert.equal(latestEntry.money, -30000, 'Cashflow amount must be -$30,000');
  console.log('  -> Cash ledger category is "h" with amount -$30,000');

  // Direct database verification
  const dbLedgerRow = database.prepare(`
    SELECT * FROM cash_ledger WHERE company_id = ? ORDER BY id DESC LIMIT 1
  `).get(user.companyId) as { category: string; amount: number };
  assert.equal(dbLedgerRow.category, 'h', 'DB cash_ledger category must be "h"');
  assert.equal(dbLedgerRow.amount, -30000, 'DB cash_ledger amount must be -30000');
  console.log('  -> Database cash_ledger row confirmed: category "h", amount -30000');

  // -------------------------------------------------------------------------
  // Part 3: Insufficient Funds Rejection
  // -------------------------------------------------------------------------
  console.log('\n--- [3/4] Testing Insufficient Funds on Training (< $30,000) ---');
  database.prepare('UPDATE companies SET money = 29999 WHERE company_id = ?').run(user.companyId);

  const failTrainRes = await api(user.cookie, 'POST', `/api/v4/executives/${zeroExec.id}/train/`);
  assert.equal(failTrainRes.status, 400, 'Training must fail when money < 30000');
  const failTrainError = errorText(failTrainRes.json);
  assert.match(failTrainError, /not enough money/i, 'Error message indicates insufficient money');

  const compNoChange = await getAuthCompany(user.cookie);
  assert.equal(compNoChange.money, 29999, 'Money balance remains untouched on failed training');
  console.log('  -> Insufficient funds ($29,999 < $30,000) correctly rejected with 400');

  // -------------------------------------------------------------------------
  // Part 4: Executive Slot Capacity Limit & Concurrency Race Protection
  // -------------------------------------------------------------------------
  console.log('\n--- [4/4] Testing Slot Capacity Limits & Transactional Concurrency Protection ---');

  // Restore funds and reset executives to a known state:
  // Clean employed executives and candidates for user.companyId
  database.prepare('DELETE FROM executives WHERE company_id = ?').run(user.companyId);
  database.prepare('UPDATE companies SET extra_executive_slots = 0, simboosts = 100 WHERE company_id = ?').run(user.companyId);

  // Insert 3 employed executives (base limit is 4 slots, so 3 employed = 1 slot left)
  for (let i = 1; i <= 3; i++) {
    database.prepare(`
      INSERT INTO executives (
        company_id, name, avatar, position,
        skill_management, skill_accounting, skill_science, skill_communication,
        salary, status, created_at
      ) VALUES (?, ?, 'images/avatars/male_01.png', 'unassigned', 5, 5, 5, 5, 300, 'employed', ?)
    `).run(user.companyId, `Employed Exec ${i}`, now);
  }

  // Insert 5 candidates
  const candidateIds: number[] = [];
  for (let i = 1; i <= 5; i++) {
    const res = database.prepare(`
      INSERT INTO executives (
        company_id, name, avatar, position,
        skill_management, skill_accounting, skill_science, skill_communication,
        salary, status, created_at
      ) VALUES (?, ?, 'images/avatars/male_02.png', 'unassigned', 6, 6, 6, 6, 320, 'candidate', ?)
    `).run(user.companyId, `Candidate ${i}`, now);
    candidateIds.push(Number(res.lastInsertRowid));
  }

  // Verify employed count is 3
  const countBefore = (database.prepare("SELECT COUNT(*) AS count FROM executives WHERE company_id = ? AND status = 'employed'").get(user.companyId) as { count: number }).count;
  assert.equal(countBefore, 3, 'Currently 3 employed executives');

  // Concurrency test: Fire 5 concurrent hire requests for different candidates when only 1 slot is available!
  console.log('  Testing concurrent hire race condition across 5 parallel requests...');
  const hirePromises = candidateIds.map(candId =>
    api(user.cookie, 'POST', '/api/v4/executives/hire/', { candidateId: candId, position: 'unassigned' })
  );

  const hireResults = await Promise.all(hirePromises);
  const successCount = hireResults.filter(r => r.status === 200).length;
  const failureCount = hireResults.filter(r => r.status === 400).length;

  assert.equal(successCount, 1, `Exactly 1 concurrent hire must succeed (actual: ${successCount})`);
  assert.equal(failureCount, 4, `Exactly 4 concurrent hires must be rejected (actual: ${failureCount})`);

  // Verify DB employed count is strictly 4 (capacity limit)
  const countAfterRace = (database.prepare("SELECT COUNT(*) AS count FROM executives WHERE company_id = ? AND status = 'employed'").get(user.companyId) as { count: number }).count;
  assert.equal(countAfterRace, 4, 'Employed count must be strictly 4 (slot limit enforced atomically)');
  console.log('  -> Concurrency race condition prevented: exactly 1 hired, 4 rejected, total employed = 4');

  // Attempt 5th hire when at 4/4 slots -> must fail with slot limit message
  const remainingCandidate = database.prepare("SELECT id FROM executives WHERE company_id = ? AND status = 'candidate' LIMIT 1").get(user.companyId) as { id: number } | undefined;
  assert.ok(remainingCandidate, 'Remaining candidate available');

  const overLimitRes = await api(user.cookie, 'POST', '/api/v4/executives/hire/', { candidateId: remainingCandidate.id });
  assert.equal(overLimitRes.status, 400);
  assert.match(errorText(overLimitRes.json), /slot limit reached \(4\/4\)/i);
  console.log('  -> Hiring at 4/4 slots rejected with slot limit reached (4/4)');

  // Unlock extra slot with SimBoosts
  console.log('  Unlocking extra executive slot with SimBoosts...');
  const unlockRes = await api(user.cookie, 'POST', '/api/v2/companies/me/executive-slots/');
  assert.equal(unlockRes.status, 200, `Slot unlock failed: ${errorText(unlockRes.json)}`);

  // Now 5th hire must succeed
  const fifthHireRes = await api(user.cookie, 'POST', '/api/v4/executives/hire/', { candidateId: remainingCandidate.id });
  assert.equal(fifthHireRes.status, 200, `5th hire after unlock failed: ${errorText(fifthHireRes.json)}`);

  const countAfterUnlock = (database.prepare("SELECT COUNT(*) AS count FROM executives WHERE company_id = ? AND status = 'employed'").get(user.companyId) as { count: number }).count;
  assert.equal(countAfterUnlock, 5, 'Employed count is now 5');
  console.log('  -> 5th executive successfully hired after slot unlock');

  console.log('\n================================================================');
  console.log(' ✅ ISSUE #87 EXECUTIVES VERIFICATION PASSED ALL CHECKS (0 errors)');
  console.log('================================================================\n');
}

async function main(): Promise<void> {
  const dataDir = path.resolve('data', `test-run-i87-${Date.now()}`);
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
        INITIAL_LEVEL: '15' // Level 15 unlocks executives capability
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
    await runTests(dataDir);
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
  console.error('\n❌ Test crashed with error:', err);
  process.exit(1);
});
