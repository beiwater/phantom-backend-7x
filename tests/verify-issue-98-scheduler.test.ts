/**
 * Verification test for Issue #98:
 * Daily UTC timetable engine with restart-safe catch-up.
 *
 * Timetable under test (all UTC):
 *   00:00  bond interest deduction + accounting overhead charge per company
 *   04:00  executive daily salary debit (cash ledger category 'e')
 *   13:00  Wednesday Government Orders publication; Monday award fulfillment
 *   15:00  Friday economy phase roll (Recession/Normal/Boom)
 *   23:30  daily retail market saturation recalculation
 *
 * Reliability under test:
 *   - scheduler_state persistence (restarts never double-fire an occurrence)
 *   - boot catch-up: a task whose scheduled time passed but has not run for
 *     that occurrence fires exactly once, then the next occurrence is scheduled
 *   - GET /api/v2/scheduler/state/ (admin) observability + admin gating
 *
 * Run with:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-98-scheduler.test.ts
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 3870;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const NODE_BIN = '/opt/magnate/.node22/bin/node';
const SERVER_CWD = path.resolve(import.meta.dirname ?? '.', '..');

const DAY_MS = 24 * 60 * 60 * 1000;

interface ApiResult {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
}

interface LedgerRowView {
  amount: number;
  description: string;
}

interface SchedulerTaskView {
  name: string;
  hourUtc: number;
  minuteUtc: number;
  daysOfWeek: number[] | null;
  nextOccurrenceUtc: string | null;
  lastRunUtc: string | null;
  lastScheduledForUtc: string | null;
  lastStatus: string | null;
  lastError: string | null;
  runs: number;
}

interface SchedulerStateView {
  running: boolean;
  tasks: SchedulerTaskView[];
  economyPhase: { realmId: number; state: number; stateName: string; updatedAt: string | null };
}

interface SchedulerRunResultView {
  task: string;
  occurrence: string | null;
  outcome: string;
  error?: string;
}

interface SchedulerTickView {
  report: { ranAt: string; results: SchedulerRunResultView[] };
  state: SchedulerStateView;
}

let dbh: DatabaseSync;
let child: ChildProcess;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Assert two monetary values agree to the cent. */
function approx(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) < 0.005,
    `${label}: expected ${expected}, got ${actual}`
  );
}

function hasRow(rows: LedgerRowView[], amount: number): boolean {
  return rows.some(row => Math.abs(row.amount - amount) < 0.005);
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

async function register(label: string): Promise<{ cookie: string; companyId: number; email: string }> {
  const email = `sched98_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Company98_${label}_${Date.now()}` })
  });
  assert.equal(response.status, 200, `Registration failed: ${response.status}`);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie missing');

  const auth = await api(cookie as string, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(auth.status, 200);
  const authJson = auth.json as { authCompany: { companyId: number } };
  return { cookie: cookie as string, companyId: authJson.authCompany.companyId, email };
}

function money(companyId: number): number {
  const row = dbh.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as {
    money: number;
  } | undefined;
  assert.ok(row, `Company ${companyId} missing`);
  return Number(row.money);
}

function setMoney(companyId: number, value: number): void {
  dbh.prepare('UPDATE companies SET money = ? WHERE company_id = ?').run(value, companyId);
}

function ledgerRows(companyId: number, category: string): LedgerRowView[] {
  return dbh.prepare(
    'SELECT amount, description FROM cash_ledger WHERE company_id = ? AND category = ? ORDER BY id ASC'
  ).all(companyId, category) as LedgerRowView[];
}

/**
 * Poll the server until it serves requests. Integration test against a real
 * spawned server process: there is no in-process clock to fake here, so a
 * short retry loop is the deterministic-available option.
 */
async function waitUntilReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 200);
    await promise;
  }
  throw new Error(`Server did not become ready at ${url}`);
}

function spawnServer(dataDir: string): ChildProcess {
  const proc = spawn(
    NODE_BIN,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: SERVER_CWD,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        INITIAL_LEVEL: '20' // unlocks bonds + government orders capabilities
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  proc.stdout?.on('data', chunk => {
    process.stdout.write(`[server:out] ${chunk}`);
  });
  proc.stderr?.on('data', chunk => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) {
      process.stderr.write(`[server:err] ${text}`);
    }
  });
  return proc;
}

async function stopServer(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) return;
  const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()));
  proc.kill('SIGTERM');
  const timeout = setTimeout(() => proc.kill('SIGKILL'), 8000);
  await exited;
  clearTimeout(timeout);
}

async function tick(
  adminCookie: string,
  nowIso: string,
  tasks?: string[]
): Promise<SchedulerTickView> {
  const res = await api(adminCookie, 'POST', '/api/v2/scheduler/tick/', tasks ? { now: nowIso, tasks } : { now: nowIso });
  assert.equal(res.status, 200, `Scheduler tick failed: ${errorText(res.json)}`);
  return res.json as SchedulerTickView;
}

function outcomeOf(tick: SchedulerTickView, task: string): SchedulerRunResultView {
  const result = tick.report.results.find(entry => entry.task === task);
  assert.ok(result, `Task ${task} missing from tick report`);
  return result;
}

function taskState(state: SchedulerStateView, name: string): SchedulerTaskView {
  const entry = state.tasks.find(task => task.name === name);
  assert.ok(entry, `Task ${name} missing from scheduler state`);
  return entry;
}

/** Latest daily occurrence at or before `now` for a task scheduled at hour:minute UTC. */
function latestDailyOccurrence(hour: number, minute: number, now: Date): Date {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const occ = dayStart + hour * 3600000 + minute * 60000;
  return new Date(occ <= now.getTime() ? occ : occ - DAY_MS);
}

/** Next given weekday (0=Sunday..6=Saturday) strictly after `from` (UTC). */
function nextWeekday(dayOfWeek: number, from: Date): Date {
  const dayStart = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let add = (dayOfWeek - dayStart.getUTCDay() + 7) % 7;
  if (add === 0) add = 7;
  dayStart.setUTCDate(dayStart.getUTCDate() + add);
  return dayStart;
}

async function runTests(dataDir: string): Promise<void> {
  const now0 = new Date();
  const tomorrow = new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), now0.getUTCDate() + 1));

  // --- 1. Admin gating of the observability endpoint -------------------------
  console.log('  Registering admin + companies...');
  const admin = await register('admin');
  dbh.prepare('UPDATE players SET is_admin = 1 WHERE email = ?').run(admin.email);

  const companyA = await register('a');
  const companyB = await register('b');
  const companyC = await register('c');

  const anonState = await fetch(`${BASE_URL}/api/v2/scheduler/state/`);
  assert.equal(anonState.status, 401, 'Unauthenticated scheduler state must be 401');

  const forbiddenState = await api(companyA.cookie, 'GET', '/api/v2/scheduler/state/');
  assert.equal(forbiddenState.status, 403, 'Non-admin scheduler state must be 403');

  const forbiddenTick = await api(companyA.cookie, 'POST', '/api/v2/scheduler/tick/', { now: tomorrow.toISOString() });
  assert.equal(forbiddenTick.status, 403, 'Non-admin scheduler tick must be 403');

  const badTick = await api(admin.cookie, 'POST', '/api/v2/scheduler/tick/', { now: 'not-a-date' });
  assert.equal(badTick.status, 400, 'Invalid simulated now must be 400');
  const unknownTaskTick = await api(admin.cookie, 'POST', '/api/v2/scheduler/tick/', { now: tomorrow.toISOString(), tasks: ['does_not_exist'] });
  assert.equal(unknownTaskTick.status, 400, 'Unknown task name must be 400');

  const stateRes = await api(admin.cookie, 'GET', '/api/v2/scheduler/state/');
  assert.equal(stateRes.status, 200, `Admin scheduler state failed: ${errorText(stateRes.json)}`);
  const stateJson = stateRes.json as SchedulerStateView;
  assert.equal(stateJson.tasks.length, 6, 'Timetable must expose 6 scheduled tasks');
  const scheduleExpectations: Array<[string, number, number, number[] | null]> = [
    ['bond_interest_and_admin_overhead', 0, 0, null],
    ['executive_salaries', 4, 0, null],
    ['government_orders_award', 13, 0, [1]],
    ['government_orders_publish', 13, 0, [3]],
    ['economy_phase_roll', 15, 0, [5]],
    ['retail_saturation_refresh', 23, 30, null]
  ];
  for (const [name, hour, minute, days] of scheduleExpectations) {
    const entry = taskState(stateJson, name);
    assert.equal(entry.hourUtc, hour, `${name} hourUtc`);
    assert.equal(entry.minuteUtc, minute, `${name} minuteUtc`);
    assert.deepEqual(entry.daysOfWeek, days, `${name} daysOfWeek`);
    assert.equal(entry.lastStatus, 'ok', `${name} boot catch-up status`);
  }
  assert.equal(stateJson.running, true, 'Scheduler must report running');
  console.log('  -> Admin-only observability endpoint verified (401/403/200 + 6-task timetable)');

  // --- 2. Fixture: buildings, salaries, bonds --------------------------------
  const nowIso = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    dbh.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, ?, 'P', 1, ?, 0, 'production', ?)
    `).run(companyA.companyId, `pos98_${i}`, `Overhead plant ${i}`, nowIso);
  }

  const employedSalaryTotal = (companyId: number): number => round2(
    (dbh.prepare(`
      SELECT COALESCE(SUM(salary), 0) AS total FROM executives
      WHERE company_id = ? AND status = 'employed'
    `).get(companyId) as { total: number }).total
  );
  const salaryA = employedSalaryTotal(companyA.companyId);
  const salaryB = employedSalaryTotal(companyB.companyId);
  assert.ok(salaryA > 0, 'Company A must have employed executives (seeded defaults)');
  assert.ok(salaryB > 0, 'Company B must have employed executives (seeded defaults)');

  // Expected daily accounting overhead per decompiled formulas_admin.md, using
  // the server's linear AO model: AO = 1 + (count-1)*0.035, cost =
  // size*100*(AO-1), COO accounting skill reduces it linearly. Every newly
  // registered company already owns 2 seeded buildings (farm + grocery), so the
  // expectation is derived from the live DB rather than assumed counts.
  const dailyOverheadFor = (companyId: number): number => {
    const stats = dbh.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buildings WHERE company_id = ?) AS building_count,
        (SELECT COALESCE(SUM(size), 0) FROM buildings WHERE company_id = ?) AS total_size,
        (SELECT COALESCE(MAX(COALESCE(skill_accounting, 0)), 0) FROM executives
           WHERE company_id = ? AND status = 'employed' AND position = 'coo') AS coo_skill
    `).get(companyId, companyId, companyId) as {
      building_count: number; total_size: number; coo_skill: number;
    };
    assert.ok(Number(stats.building_count) >= 1, `Company ${companyId} fixture: buildings present`);
    const ao = 1 + Math.max(0, Number(stats.building_count) - 1) * 0.035;
    const effectiveAo = ao - (ao - 1) * Number(stats.coo_skill) / 100;
    return round2(Number(stats.total_size) * 100 * (effectiveAo - 1));
  };
  const expectedOverheadA = dailyOverheadFor(companyA.companyId);
  const expectedOverheadB = dailyOverheadFor(companyB.companyId);
  assert.ok(expectedOverheadA > 0 && expectedOverheadB > 0, 'Expected overheads must be positive');
  // Fund the companies so the bond purchases below can clear; exact baselines
  // are re-set after the purchases to keep the money math clean.
  setMoney(companyA.companyId, 1000000);
  setMoney(companyB.companyId, 1000000);
  setMoney(companyC.companyId, 1000000);

  // Bond fixtures: A issues a bond that B holds (paid interest path);
  // C issues a bond that B holds, then C is drained to $0 (default path).
  const issueRes = await api(companyA.cookie, 'POST', '/api/v2/bonds/sell/', { amount: 100000, interest: 0.1 });
  assert.equal(issueRes.status, 200, `Bond issue failed: ${errorText(issueRes.json)}`);
  const issueJson = issueRes.json as { bond?: { id?: number }; id?: number };
  const bondAId = Number(issueJson.bond?.id ?? issueJson.id);
  assert.ok(bondAId > 0, 'Issued bond must have an id');

  const buyARes = await api(companyB.cookie, 'POST', `/api/v2/bonds/${bondAId}/buy/`, {});
  assert.equal(buyARes.status, 200, `Bond buy (A) failed: ${errorText(buyARes.json)}`);

  const issueCRes = await api(companyC.cookie, 'POST', '/api/v2/bonds/sell/', { amount: 50000, interest: 0.1 });
  assert.equal(issueCRes.status, 200, `Bond issue (C) failed: ${errorText(issueCRes.json)}`);
  const issueCJson = issueCRes.json as { bond?: { id?: number }; id?: number };
  const bondCId = Number(issueCJson.bond?.id ?? issueCJson.id);
  const buyCRes = await api(companyB.cookie, 'POST', `/api/v2/bonds/${bondCId}/buy/`, {});
  assert.equal(buyCRes.status, 200, `Bond buy (C) failed: ${errorText(buyCRes.json)}`);

  setMoney(companyA.companyId, 1000000);
  setMoney(companyB.companyId, 1000000);
  setMoney(companyC.companyId, 0);
  const bondInterestA = round2(100000 * 0.1);
  assert.equal(bondInterestA, 10000, 'Bond interest fixture sanity');

  // --- 3. Simulated clock: tomorrow 00:05 UTC (bond interest + overhead) -----
  // Determinism warm-up: drain all catch-up tasks due up to today 04:05 so
  // the simulated sequence below starts from a clean scheduler state
  // regardless of the wall-clock hour the suite runs at (e.g. an 01:00 UTC
  // boot has not yet reached today's 04:00 salary occurrence). Runs BEFORE
  // the money baselines below are set, so any catch-up debits are wiped.
  await tick(
    admin.cookie,
    new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 4, 5)).toISOString(),
    ['bond_interest_and_admin_overhead', 'executive_salaries']
  );

  setMoney(companyA.companyId, 1000000);
  setMoney(companyB.companyId, 1000000);
  setMoney(companyC.companyId, 0);

  console.log('  Simulating tomorrow 00:05 UTC (bond interest + accounting overhead)...');
  const tick1 = await tick(admin.cookie, new Date(tomorrow.getTime() + 5 * 60000).toISOString());
  const bondOutcome = outcomeOf(tick1, 'bond_interest_and_admin_overhead');
  assert.equal(bondOutcome.outcome, 'ran', 'Bond interest task must fire at 00:00');
  assert.equal(bondOutcome.occurrence, `${tomorrow.toISOString().slice(0, 10)}T00:00:00.000Z`, 'Bond occurrence must be tomorrow 00:00 UTC');

  approx(money(companyA.companyId), 1000000 - bondInterestA - expectedOverheadA, 'Company A money after 00:00 tick');
  approx(money(companyB.companyId), 1000000 + bondInterestA - expectedOverheadB, 'Company B money after 00:00 tick');
  assert.equal(money(companyC.companyId), 0, 'Broke issuer C cannot be driven negative');

  const interestRowsA = ledgerRows(companyA.companyId, 'i').filter(row => row.description === 'Bond interest payment');
  assert.ok(hasRow(interestRowsA, -bondInterestA), 'A must have a -10000 category i interest row');
  const interestRowsB = ledgerRows(companyB.companyId, 'i').filter(row => row.description === 'Bond interest collected');
  assert.ok(hasRow(interestRowsB, bondInterestA), 'B must have a +10000 category i interest row');
  const overheadRowsA = ledgerRows(companyA.companyId, 'a');
  assert.ok(hasRow(overheadRowsA, -expectedOverheadA), 'A must have the daily accounting overhead row (category a)');
  assert.ok(hasRow(ledgerRows(companyB.companyId, 'a'), -expectedOverheadB), 'B must have its own daily overhead row (category a)');
  // C owns the seeded buildings too but has no funds: the charge clamps to
  // "pay what you can" and writes no ledger row.
  assert.equal(ledgerRows(companyC.companyId, 'a').length, 0, 'Broke company C pays no overhead row');

  const bondAStatus = (dbh.prepare('SELECT status FROM bonds WHERE id = ?').get(bondAId) as { status: string }).status;
  assert.equal(bondAStatus, 'active', 'Solvent issuer bond must stay active');
  const bondCStatus = (dbh.prepare('SELECT status FROM bonds WHERE id = ?').get(bondCId) as { status: string }).status;
  assert.equal(bondCStatus, 'defaulted', 'Insolvent issuer bond must default at 00:00');

  // Retail rows: the tick fires the saturation refresh for the most recent
  // 23:30 occurrence (today or yesterday depending on the wall clock).
  const retailOutcome1 = outcomeOf(tick1, 'retail_saturation_refresh');
  const retailDate = (retailOutcome1.outcome === 'ran'
    ? String(retailOutcome1.occurrence)
    : String(taskState(tick1.state, 'retail_saturation_refresh').lastScheduledForUtc)).slice(0, 10);
  const retailCount = (dbh.prepare('SELECT COUNT(*) AS count FROM retail_saturation WHERE date = ?').get(retailDate) as { count: number }).count;
  assert.ok(retailCount > 0, `Retail saturation rows must exist for ${retailDate}`);
  console.log('  -> 00:00 UTC: bond interest ledger (i), accounting overhead (a), default handling verified');

  // --- 4. Simulated clock: tomorrow 04:05 UTC (executive salaries) -----------
  console.log('  Simulating tomorrow 04:05 UTC (executive salaries)...');
  const moneyAAfterMidnight = money(companyA.companyId);
  const moneyBAfterMidnight = money(companyB.companyId);
  const tick2 = await tick(admin.cookie, new Date(tomorrow.getTime() + 4 * 3600000 + 5 * 60000).toISOString());
  const salaryOutcome = outcomeOf(tick2, 'executive_salaries');
  assert.equal(salaryOutcome.outcome, 'ran', 'Salary task must fire at 04:00');
  assert.equal(salaryOutcome.occurrence, `${tomorrow.toISOString().slice(0, 10)}T04:00:00.000Z`, 'Salary occurrence must be tomorrow 04:00 UTC');
  assert.equal(outcomeOf(tick2, 'bond_interest_and_admin_overhead').outcome, 'skipped-already-run', 'Bond task must not re-fire within the same occurrence');

  approx(money(companyA.companyId), moneyAAfterMidnight - salaryA, 'Company A money after 04:00 salary debit');
  approx(money(companyB.companyId), moneyBAfterMidnight - salaryB, 'Company B money after 04:00 salary debit');
  const salaryRowsA = ledgerRows(companyA.companyId, 'e');
  assert.ok(hasRow(salaryRowsA, -salaryA), 'A must have one daily salary debit row (category e)');
  const salaryRowsB = ledgerRows(companyB.companyId, 'e');
  assert.ok(hasRow(salaryRowsB, -salaryB), 'B must have one daily salary debit row (category e)');

  // C is broke: "pay what you can" -> no debit, no ledger row, no crash.
  assert.equal(money(companyC.companyId), 0, 'Broke company C pays nothing');
  assert.equal(ledgerRows(companyC.companyId, 'e').length, 0, 'Broke company C has no salary ledger row');
  console.log('  -> 04:00 UTC: executive salary debits (category e) verified');

  // --- 5. No double-fire on repeated tick ------------------------------------
  console.log('  Re-running the same simulated tick (no double-fire)...');
  const runsBefore = taskState(tick2.state, 'executive_salaries').runs;
  const moneyABeforeRepeat = money(companyA.companyId);
  const tick3 = await tick(admin.cookie, new Date(tomorrow.getTime() + 4 * 3600000 + 5 * 60000).toISOString());
  for (const name of ['bond_interest_and_admin_overhead', 'executive_salaries', 'retail_saturation_refresh']) {
    assert.equal(outcomeOf(tick3, name).outcome, 'skipped-already-run', `${name} must be skipped on repeat tick`);
  }
  approx(money(companyA.companyId), moneyABeforeRepeat, 'Company A money unchanged after repeat tick');
  assert.equal(taskState(tick3.state, 'executive_salaries').runs, runsBefore, 'Run counter must not advance on repeat tick');
  console.log('  -> No double-fire within the same occurrence verified');

  // --- 6. Friday 15:00 economy phase roll ------------------------------------
  console.log('  Simulating next Friday 15:05 UTC (economy phase roll)...');
  const nextFriday = nextWeekday(5, now0);
  const fridayStamp = `${nextFriday.toISOString().slice(0, 10)}T15:00:00.000Z`;
  const ecoTick = await tick(
    admin.cookie,
    new Date(nextFriday.getTime() + 15 * 3600000 + 5 * 60000).toISOString(),
    ['economy_phase_roll']
  );
  assert.equal(outcomeOf(ecoTick, 'economy_phase_roll').outcome, 'ran', 'Economy roll must fire on Friday 15:00');
  assert.equal(ecoTick.state.economyPhase.updatedAt, fridayStamp, 'Economy phase stamped with Friday occurrence');
  assert.ok([0, 1, 2].includes(ecoTick.state.economyPhase.state), 'Economy phase must be 0 (Recession), 1 (Normal) or 2 (Boom)');
  const ecoRow = dbh.prepare('SELECT state, updated_at FROM economy_state WHERE realm_id = 0').get() as { state: number; updated_at: string };
  assert.ok([0, 1, 2].includes(Number(ecoRow.state)), 'Economy phase must persist in economy_state');
  assert.equal(ecoRow.updated_at, fridayStamp, 'Persisted economy update stamp');
  console.log(`  -> 15:00 UTC Friday roll persisted: state ${ecoTick.state.economyPhase.state} (${ecoTick.state.economyPhase.stateName})`);

  // --- 7. Daily 23:30 retail saturation recalculation ------------------------
  console.log('  Simulating tomorrow 23:35 UTC (retail saturation recalculation)...');
  const retailTick = await tick(
    admin.cookie,
    new Date(tomorrow.getTime() + 23 * 3600000 + 35 * 60000).toISOString(),
    ['retail_saturation_refresh']
  );
  assert.equal(outcomeOf(retailTick, 'retail_saturation_refresh').outcome, 'ran', 'Retail saturation must fire at 23:30');
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  const saturationRows = dbh.prepare('SELECT kind, saturation FROM retail_saturation WHERE date = ? ORDER BY kind').all(tomorrowKey) as Array<{ kind: number; saturation: number }>;
  const constants = JSON.parse(
    readFileSync(path.join(SERVER_CWD, 'server', 'data', 'constants', 'resources.json'), 'utf-8')
  ) as Record<string, { unitsSoldAnHour?: number }>;
  const retailKinds = Object.entries(constants).filter(([, def]) => Number(def.unitsSoldAnHour) > 0).length;
  assert.equal(saturationRows.length, retailKinds, `Saturation must be recalculated for every retail resource (${retailKinds})`);
  for (const row of saturationRows) {
    assert.ok(Number.isFinite(row.saturation) && row.saturation > 0 && row.saturation < 2, `Saturation for kind ${row.kind} out of range`);
  }
  console.log(`  -> 23:30 UTC: saturation persisted for ${saturationRows.length} retail resources`);

  // --- 8. Wednesday 13:00 Government Orders publication ----------------------
  console.log('  Simulating next Wednesday 13:05 UTC (Government Orders publication)...');
  const nextWednesday = nextWeekday(3, now0);
  const publishTickTime = new Date(nextWednesday.getTime() + 13 * 3600000 + 5 * 60000);
  const pubTick = await tick(admin.cookie, publishTickTime.toISOString(), ['government_orders_publish']);
  assert.equal(outcomeOf(pubTick, 'government_orders_publish').outcome, 'ran', 'Publication must fire on Wednesday 13:00');
  const orderCount = (dbh.prepare('SELECT COUNT(*) AS count FROM government_orders WHERE realm_id = 0').get() as { count: number }).count;
  assert.ok(Number(orderCount) >= 7, 'Standard project pool must be published');
  const staleCount = (dbh.prepare('SELECT COUNT(*) AS count FROM government_orders WHERE realm_id = 0 AND (deadline IS NULL OR deadline < ?)')
    .get(publishTickTime.toISOString()) as { count: number }).count;
  assert.equal(Number(staleCount), 0, 'Published orders must have fresh future deadlines');
  console.log(`  -> 13:00 UTC Wednesday: ${orderCount} orders published with fresh windows`);

  // --- 9. Monday 13:00 Government Orders award fulfillment -------------------
  console.log('  Simulating next Monday 13:05 UTC (Government Orders award)...');
  // Fixture inserted AFTER the publication tick so it is not refreshed: its
  // bidding deadline stays in the past for the award pass.
  dbh.prepare(`
    INSERT INTO government_orders (
      realm_id, project_key, agency, estimated_base_value, days_to_fulfill,
      resource_multiplier_awarded, required_resources_json, unit_compensation_price,
      start_date, deadline, created_at
    ) VALUES (0, 'TEST_AWARD_PROJECT', 'TEST_AGENCY', 100000, 5, NULL, ?, 50.0, ?, ?, ?)
  `).run(
    JSON.stringify([{ id: 1, kind: 12, quality: 0, amountBase: 100, targetAmount: 100 }]),
    now0.toISOString(),
    new Date(now0.getTime() - 2 * DAY_MS).toISOString(),
    now0.toISOString()
  );
  const templateRow = dbh.prepare(`SELECT id FROM government_orders WHERE project_key = 'TEST_AWARD_PROJECT'`).get() as { id: number };
  assert.ok(templateRow, 'Award fixture template inserted');

  const depositByCompany: Array<{ company: typeof companyA; secret: string; unitPrice: number }> = [
    { company: companyA, secret: 'bid-test-winner', unitPrice: 40 },
    { company: companyB, secret: 'bid-test-loser', unitPrice: 50 }
  ];
  for (const bid of depositByCompany) {
    dbh.prepare(`
      INSERT INTO government_bids (secret, template_id, realm_id, creator_company_id, max_contractors, is_public, min_tier_index, price_breakdown_json, note, status, created_at)
      VALUES (?, ?, 0, ?, 5, 1, 1, ?, '', 'OPEN', ?)
    `).run(bid.secret, templateRow.id, bid.company.companyId, `{"12": ${bid.unitPrice}}`, nowIso);
    dbh.prepare(`
      INSERT INTO government_bid_contractors (bid_secret, company_id, is_main, tier_index, tier_multiplier, deposit_paid, fulfilled, joined_at)
      VALUES (?, ?, 1, 1, 1.0, 5000, 0, ?)
    `).run(bid.secret, bid.company.companyId, nowIso);
    // Model the deposits already being locked away (createGovernmentBid debited them).
    setMoney(bid.company.companyId, money(bid.company.companyId) - 5000);
  }
  const moneyBeforeAwardA = money(companyA.companyId);
  const moneyBeforeAwardB = money(companyB.companyId);

  const nextMonday = nextWeekday(1, now0);
  const awardTick = await tick(
    admin.cookie,
    new Date(nextMonday.getTime() + 13 * 3600000 + 5 * 60000).toISOString(),
    ['government_orders_award']
  );
  assert.equal(outcomeOf(awardTick, 'government_orders_award').outcome, 'ran', 'Award must fire on Monday 13:00');

  const winnerStatus = (dbh.prepare(`SELECT status FROM government_bids WHERE secret = 'bid-test-winner'`).get() as { status: string }).status;
  const loserStatus = (dbh.prepare(`SELECT status FROM government_bids WHERE secret = 'bid-test-loser'`).get() as { status: string }).status;
  assert.equal(winnerStatus, 'AWARDED', 'Lowest bid (40/unit) must win the award');
  assert.equal(loserStatus, 'REJECTED', 'Higher bid (50/unit) must be rejected');
  approx(money(companyA.companyId), moneyBeforeAwardA, 'Winner deposit retained (no refund until fulfillment)');
  approx(money(companyB.companyId), moneyBeforeAwardB + 5000, 'Losing bidder deposit refunded');
  const loserDeposit = (dbh.prepare(`SELECT deposit_paid FROM government_bid_contractors WHERE bid_secret = 'bid-test-loser' AND company_id = ?`).get(companyB.companyId) as { deposit_paid: number }).deposit_paid;
  assert.equal(Number(loserDeposit), 0, 'Losing contractor deposit released');
  const multiplier = (dbh.prepare('SELECT resource_multiplier_awarded FROM government_orders WHERE id = ?').get(templateRow.id) as { resource_multiplier_awarded: number }).resource_multiplier_awarded;
  assert.equal(Number(multiplier), 1, 'Template stamped with awarded resource multiplier');
  console.log('  -> 13:00 UTC Monday: lowest bid awarded, deposits settled');

  // --- 10. Catch-up after restart (no double-fire across restarts) -----------
  console.log('  Restarting server to verify boot catch-up...');

  // Kill first so the heartbeat cannot interfere with the state manipulation.
  await stopServer(child);
  dbh.close();
  dbh = new DatabaseSync(path.join(dataDir, 'simcompanies.sqlite'));
  dbh.prepare(`DELETE FROM scheduler_state WHERE task_name = 'executive_salaries'`).run();
  setMoney(companyA.companyId, 1000000);
  const salaryRowCountBefore = ledgerRows(companyA.companyId, 'e').length;

  child = spawnServer(dataDir);
  await waitUntilReady(`${BASE_URL}/version/`, 60000);
  // Boot catch-up commits before the first HTTP request is served (its work is
  // queued on microtasks ahead of any I/O), so no settle delay is needed here.

  const expectedOccurrence = latestDailyOccurrence(4, 0, new Date()).toISOString();
  approx(money(companyA.companyId), 1000000 - salaryA, 'Catch-up fired salary exactly once after restart');
  assert.equal(ledgerRows(companyA.companyId, 'e').length, salaryRowCountBefore + 1, 'Exactly one new salary ledger row after catch-up');
  const stateAfterRestart = await api(admin.cookie, 'GET', '/api/v2/scheduler/state/');
  assert.equal(stateAfterRestart.status, 200);
  const stateAfterRestartJson = stateAfterRestart.json as SchedulerStateView;
  assert.equal(taskState(stateAfterRestartJson, 'executive_salaries').lastScheduledForUtc, expectedOccurrence, 'Salary state records the caught-up occurrence');
  assert.equal(taskState(stateAfterRestartJson, 'bond_interest_and_admin_overhead').lastScheduledForUtc, `${tomorrow.toISOString().slice(0, 10)}T00:00:00.000Z`, 'Bond occurrence survived the restart untouched');
  console.log('  -> Boot catch-up ran the missed salary task exactly once');

  console.log('  Restarting again (no double-fire across restarts)...');
  const moneyBeforeSecondRestart = money(companyA.companyId);
  const salaryRowCountAfterCatchup = ledgerRows(companyA.companyId, 'e').length;
  await stopServer(child);
  child = spawnServer(dataDir);
  await waitUntilReady(`${BASE_URL}/version/`, 60000);

  approx(money(companyA.companyId), moneyBeforeSecondRestart, 'Second restart must not debit salaries again');
  assert.equal(ledgerRows(companyA.companyId, 'e').length, salaryRowCountAfterCatchup, 'No additional salary ledger row on second restart');
  console.log('  -> Second restart fired nothing: scheduler_state dedup holds across restarts');

  console.log('\n================================================================');
  console.log(' ISSUE #98 SCHEDULER VERIFICATION PASSED ALL CHECKS (0 errors)');
  console.log('================================================================\n');
}

async function main(): Promise<void> {
  const dataDir = path.resolve(SERVER_CWD, 'data', `test-run-i98-${Date.now()}`);
  console.log(`Starting test server on port ${PORT} with DATA_DIR=${dataDir}...`);
  child = spawnServer(dataDir);

  try {
    await waitUntilReady(`${BASE_URL}/version/`, 60000);
    dbh = new DatabaseSync(path.join(dataDir, 'simcompanies.sqlite'));
    await runTests(dataDir);
  } finally {
    await stopServer(child);
    dbh?.close();
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
