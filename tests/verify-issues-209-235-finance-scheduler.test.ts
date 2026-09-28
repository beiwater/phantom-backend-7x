import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'phantom-finance-scheduler-'));
process.env.DATA_DIR = dataDir;

const { db, registerPlayer } = await import('../server/db/database.ts');

try {
  const [{ virtualClock }, loans, scheduler, { companyRepository }, { bondRepository }, bondUseCases, { CONFIG }, dailyJobs, { FixtureService }] = await Promise.all([
    import('../server/core/virtual-clock.ts'),
    import('../server/game/loans.ts'),
    import('../server/scheduler/timetable.ts'),
    import('../server/repositories/company-repository.ts'),
    import('../server/repositories/bond-repository.ts'),
    import('../server/application/finance/bond-use-cases.ts'),
    import('../server/config.ts'),
    import('../server/application/scheduler/daily-jobs.ts'),
    import('../server/services/fixture-service.ts')
  ]);

  const createCompany = (name: string): number => registerPlayer(
    `${name}_${Date.now()}_${Math.random()}@domain.local`,
    'Password123!',
    `Finance scheduler ${name} ${Date.now()}`
  ).companyId;
  const companyA = createCompany('a');
  const companyB = createCompany('b');
  const companyC = createCompany('c');
  const companyD = createCompany('d');

  const setMoney = (companyId: number, value: number): void => {
    db.prepare('UPDATE companies SET money = ? WHERE company_id = ?').run(value, companyId);
  };
  const money = (companyId: number): number => {
    const row = db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number };
    return Number(row.money);
  };
  const clearTaskState = (taskName: string): void => {
    db.prepare('DELETE FROM scheduler_state WHERE task_name = ?').run(taskName);
  };
  const insertLoan = (companyId: number, remaining: number, dueAt: string): number => {
    const result = db.prepare(`
      INSERT INTO loans (company_id, principal, interest_rate, remaining, status, created_at, due_at)
      VALUES (?, ?, 0.1, ?, 'active', ?, ?)
    `).run(companyId, remaining, remaining, '2040-01-01T00:00:00.000Z', dueAt);
    return Number(result.lastInsertRowid);
  };

  // Issue #209: interest must apply to principal remaining after the payment.
  virtualClock.setTime('2040-01-20T04:05:00.000Z');
  setMoney(companyA, 400);
  setMoney(companyB, 1000);
  const partialLoanId = insertLoan(companyA, 1000, '2040-01-13T04:05:00.000Z');
  const fullLoanId = insertLoan(companyB, 1000, '2040-01-13T04:05:00.000Z');
  await loans.settleDueLoans();
  const partialLoan = db.prepare('SELECT remaining, status FROM loans WHERE id = ?').get(partialLoanId) as { remaining: number; status: string };
  const fullLoan = db.prepare('SELECT remaining, status FROM loans WHERE id = ?').get(fullLoanId) as { remaining: number; status: string };
  assert.equal(Number(partialLoan.remaining), 660, 'Partial payment interest applies only to the unpaid $600');
  assert.equal(partialLoan.status, 'active');
  assert.equal(Number(fullLoan.remaining), 0, 'A fully paid loan must have no balance');
  assert.equal(fullLoan.status, 'repaid', 'A fully paid overdue loan must be closed');
  assert.equal(money(companyA), 0);
  assert.equal(money(companyB), 0);
  console.log('Issue #209 passed: overdue loan interest and full-repayment status are correct.');

  // Issues #230 and #235: the daily finance occurrence settles due loans and
  // completes overhead charging through the existing company cash accessor.
  virtualClock.setTime('2040-02-02T00:05:00.000Z');
  setMoney(companyC, 200);
  const scheduledLoanId = insertLoan(companyC, 100, '2040-02-01T00:05:00.000Z');
  clearTaskState(scheduler.TASK_BOND_INTEREST_AND_OVERHEAD);
  const loanTick = await scheduler.runDueSchedulerTasks(undefined, [scheduler.TASK_BOND_INTEREST_AND_OVERHEAD]);
  const loanTickResult = loanTick.results.find(result => result.task === scheduler.TASK_BOND_INTEREST_AND_OVERHEAD);
  assert.equal(loanTickResult?.outcome, 'ran');
  const scheduledLoan = db.prepare('SELECT remaining, status FROM loans WHERE id = ?').get(scheduledLoanId) as { remaining: number; status: string };
  assert.equal(Number(scheduledLoan.remaining), 0);
  assert.equal(scheduledLoan.status, 'repaid', 'The scheduled daily job must settle an overdue loan');
  assert.ok(
    (db.prepare("SELECT COUNT(*) AS count FROM cash_ledger WHERE company_id = ? AND category = 'a'").get(companyC) as { count: number }).count > 0,
    'The daily task must record overhead instead of failing on a missing cash-list method'
  );
  console.log('Issues #230 and #235 passed: daily finance settles loans and charges overhead.');

  // Issue #231: the midnight finance task settles matured bonds before daily
  // interest, including a partial payout/default, and does not charge matured
  // holders another day of interest.
  virtualClock.setTime('2040-03-01T00:05:00.000Z');
  setMoney(companyC, 1000);
  setMoney(companyD, 500);
  setMoney(companyA, 50);
  setMoney(companyB, 0);
  const heldBondId = Number(bondRepository.insertBond(
    companyC, 0.1, 100, '2040-02-01T00:00:00.000Z', '2040-02-29T00:00:00.000Z'
  ).id);
  assert.equal(bondRepository.claimForBuyer(companyD, heldBondId), 1);
  const defaultedBondId = Number(bondRepository.insertBond(
    companyA, 0.1, 100, '2040-02-01T00:00:00.000Z', '2040-02-29T00:00:00.000Z'
  ).id);
  assert.equal(bondRepository.claimForBuyer(companyB, defaultedBondId), 1);
  clearTaskState(scheduler.TASK_BOND_INTEREST_AND_OVERHEAD);
  const bondTick = await scheduler.runDueSchedulerTasks(undefined, [scheduler.TASK_BOND_INTEREST_AND_OVERHEAD]);
  assert.equal(
    bondTick.results.find(result => result.task === scheduler.TASK_BOND_INTEREST_AND_OVERHEAD)?.outcome,
    'ran'
  );
  assert.equal(bondRepository.findById(heldBondId)?.status, 'matured');
  assert.equal(bondRepository.findById(heldBondId)?.settled, 1);
  assert.equal(bondRepository.findById(defaultedBondId)?.status, 'defaulted');
  assert.equal(bondRepository.findById(defaultedBondId)?.settled, 1);
  assert.ok(!bondRepository.findActiveHeld().some(bond => bond.id === heldBondId || bond.id === defaultedBondId));
  const holderInterestRows = db.prepare("SELECT COUNT(*) AS count FROM cash_ledger WHERE company_id = ? AND category = 'i'")
    .get(companyD) as { count: number };
  assert.equal(Number(holderInterestRows.count), 0, 'Maturity settlement must prevent an extra daily interest credit');
  console.log('Issue #231 passed: matured bonds settle once and stop accruing daily interest.');

  // Issue #233: no-argument scheduler calls use game time, so a virtual-clock
  // jump makes the corresponding daily occurrence due.
  const schedulerTimeTarget = '2040-04-03T04:05:00.000Z';
  virtualClock.setTime(schedulerTimeTarget);
  clearTaskState(scheduler.TASK_EXECUTIVE_SALARIES);
  const virtualTimeTick = await scheduler.runDueSchedulerTasks(undefined, [scheduler.TASK_EXECUTIVE_SALARIES]);
  assert.equal(virtualTimeTick.results[0]?.occurrence, '2040-04-03T04:00:00.000Z');
  assert.ok(Math.abs(Date.parse(virtualTimeTick.ranAt) - Date.parse(schedulerTimeTarget)) < 5_000);
  const recordedVirtualRunAt = scheduler.getSchedulerTaskState(scheduler.TASK_EXECUTIVE_SALARIES)?.lastRunUtc;
  assert.ok(recordedVirtualRunAt);
  assert.ok(Math.abs(Date.parse(recordedVirtualRunAt) - Date.parse(schedulerTimeTarget)) < 5_000);
  console.log('Issue #233 passed: the scheduler default follows virtual game time.');

  // Random rotation has an existing environment/database switch. Disabled
  // randomness preserves the configured phase while explicit admin changes
  // remain available; the default-enabled setting continues to roll weekly.
  CONFIG.ECONOMY_RANDOM = false;
  db.prepare("DELETE FROM company_settings WHERE company_id = 0 AND key = 'economy_random'").run();
  dailyJobs.setEconomyPhase(0, 1, new Date('2040-04-01T15:00:00.000Z'), 'test', true);
  const unchangedPhaseAt = (db.prepare('SELECT updated_at FROM economy_state WHERE realm_id = 0').get() as { updated_at: string }).updated_at;
  const economyTick = await scheduler.runDueSchedulerTasks(
    new Date('2040-04-06T15:05:00.000Z'),
    [scheduler.TASK_ECONOMY_PHASE_ROLL]
  );
  assert.equal(economyTick.results[0]?.outcome, 'ran');
  assert.equal(
    (db.prepare('SELECT updated_at FROM economy_state WHERE realm_id = 0').get() as { updated_at: string }).updated_at,
    unchangedPhaseAt,
    'ECONOMY_RANDOM=false must keep the current phase instead of automatically rolling'
  );
  db.prepare("INSERT INTO company_settings (company_id, key, value) VALUES (0, 'economy_random', 'false') ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value").run();
  const manualPhase = FixtureService.setEconomyState('boom', { realmId: 0 });
  assert.equal(manualPhase.state, 2, 'Explicit manual phase selection still works with random rotation disabled');
  assert.equal(manualPhase.source, 'admin');
  CONFIG.ECONOMY_RANDOM = true;
  db.prepare("DELETE FROM company_settings WHERE company_id = 0 AND key = 'economy_random'").run();
  dailyJobs.setEconomyPhase(0, 1, new Date('2040-04-10T15:00:00.000Z'), 'test', true);
  virtualClock.setTime('2040-04-13T15:05:00.000Z');
  const defaultRandomTick = await scheduler.runDueSchedulerTasks(undefined, [scheduler.TASK_ECONOMY_PHASE_ROLL]);
  assert.equal(defaultRandomTick.results[0]?.outcome, 'ran');
  assert.equal(
    (db.prepare('SELECT updated_at FROM economy_state WHERE realm_id = 0').get() as { updated_at: string }).updated_at,
    '2040-04-13T15:00:00.000Z',
    'Random rotation defaults to enabled when there is no database override'
  );
  // The weekly economy task writes phase history inside the scheduler
  // transaction; its repository savepoint must nest safely.
  assert.equal(
    (db.prepare('SELECT updated_at FROM economy_state WHERE realm_id = 0').get() as { updated_at: string }).updated_at,
    '2040-04-13T15:00:00.000Z'
  );

  // Issue #229: simultaneous heartbeat/admin ticks are queued and deduplicated.
  virtualClock.setTime('2040-04-04T04:05:00.000Z');
  setMoney(companyC, 1_000_000);
  clearTaskState(scheduler.TASK_EXECUTIVE_SALARIES);
  const salary = companyRepository.listExecutivePayrolls().find(row => row.companyId === companyC)?.salaries ?? 0;
  const beforeConcurrentTicks = money(companyC);
  const concurrentNow = virtualClock.now();
  const concurrentReports = await Promise.all([
    scheduler.runDueSchedulerTasks(concurrentNow, [scheduler.TASK_EXECUTIVE_SALARIES]),
    scheduler.runDueSchedulerTasks(concurrentNow, [scheduler.TASK_EXECUTIVE_SALARIES])
  ]);
  const concurrentOutcomes = concurrentReports.map(report => report.results[0]?.outcome).sort();
  assert.deepEqual(concurrentOutcomes, ['ran', 'skipped-already-run']);
  assert.equal(money(companyC), beforeConcurrentTicks - salary, 'Concurrent ticks must debit one daily salary only');
  console.log('Issue #229 passed: concurrent scheduler ticks execute the money job once.');

  // Issue #232: failures retain the occurrence as retryable and block later
  // occurrences until the failed one succeeds.
  virtualClock.setTime('2040-04-05T04:05:00.000Z');
  clearTaskState(scheduler.TASK_EXECUTIVE_SALARIES);
  const salaryTask = scheduler.SCHEDULED_TASKS.find(task => task.name === scheduler.TASK_EXECUTIVE_SALARIES);
  assert.ok(salaryTask);
  const originalRun = salaryTask.run;
  salaryTask.run = () => { throw new Error('temporary scheduler failure'); };
  try {
    const failedTick = await scheduler.runDueSchedulerTasks(undefined, [scheduler.TASK_EXECUTIVE_SALARIES]);
    assert.equal(failedTick.results[0]?.outcome, 'error');
    assert.equal(scheduler.getSchedulerTaskState(scheduler.TASK_EXECUTIVE_SALARIES)?.lastStatus, 'error');
    salaryTask.run = originalRun;
    const retryTick = await scheduler.runDueSchedulerTasks(undefined, [scheduler.TASK_EXECUTIVE_SALARIES]);
    assert.equal(retryTick.results[0]?.outcome, 'ran', 'The same occurrence must retry on the next tick');
    assert.equal(scheduler.getSchedulerTaskState(scheduler.TASK_EXECUTIVE_SALARIES)?.lastStatus, 'ok');
  } finally {
    salaryTask.run = originalRun;
  }
  console.log('Issue #232 passed: failed occurrences retry and clear their error on success.');

  // Issue #234: after a persisted run, a multi-day outage replays each missed
  // daily occurrence in order instead of collapsing them to the latest date.
  clearTaskState(scheduler.TASK_EXECUTIVE_SALARIES);
  virtualClock.setTime('2040-04-06T04:05:00.000Z');
  setMoney(companyC, 1_000_000);
  const salaryBeforeCatchup = money(companyC);
  const dayOne = await scheduler.runDueSchedulerTasks(undefined, [scheduler.TASK_EXECUTIVE_SALARIES]);
  assert.equal(dayOne.results[0]?.outcome, 'ran');
  const afterDayOne = money(companyC);
  const catchupNow = new Date('2040-04-09T04:05:00.000Z');
  const catchup = await scheduler.runDueSchedulerTasks(catchupNow, [scheduler.TASK_EXECUTIVE_SALARIES]);
  const catchupResults = catchup.results.filter(result => result.outcome === 'ran');
  assert.deepEqual(catchupResults.map(result => result.occurrence), [
    '2040-04-07T04:00:00.000Z',
    '2040-04-08T04:00:00.000Z',
    '2040-04-09T04:00:00.000Z'
  ]);
  assert.equal(money(companyC), afterDayOne - salary * 3, 'Catch-up must apply one salary debit per missed day');
  assert.equal(money(companyC) < salaryBeforeCatchup, true);
  assert.equal(scheduler.getSchedulerTaskState(scheduler.TASK_EXECUTIVE_SALARIES)?.lastScheduledForUtc, '2040-04-09T04:00:00.000Z');
  console.log('Issue #234 passed: all missed daily occurrences are replayed in order.');

  console.log('Finance and scheduler issue regressions passed in isolated DATA_DIR.');
} finally {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
}
