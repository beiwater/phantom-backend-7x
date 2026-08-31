/**
 * P0-01 / P0-05 / P1-01 regression: finance chart endpoints.
 *
 * Verifies against the official HAR schemas:
 * - income-statement: 200, camelCase fields, expenses negative,
 *   netIncome = component sum, isComputed true.
 * - cashflow-statement: 200, camelCase fields, income/expense direction.
 * - cashflow/recent: 200 {data:[{id,datetime,money,category,description,
 *   descriptionKey,details}]}, money signed, ledger rows written by real
 *   money mutations.
 * - past-finances-overview (v2): 200 array of daily snapshots (idempotent
 *   upsert by date).
 * - past-finances (v3): 200 richer snapshot rows.
 * - balance-sheet: 200 official camelCase object.
 * - administration-overhead & plus-one: 200.
 * - GET idempotence: every finance GET called twice returns identical
 *   bodies (no hidden writes).
 */
import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3201'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `fin_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@simcompanies.local`;
  const company = `Fin-${label}-${Date.now().toString(36)}`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', company })
  });
  assert.equal(response.status, 200, `register ${label} must return 200`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(v => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'session cookie required');
  const auth = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } })).json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function getJson(path: string, cookie: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const INCOME_FIELDS = [
  'date', 'dateFrom', 'sales', 'cogs', 'freightOut', 'constructionCosts', 'marketFees',
  'salariesCosts', 'trainingCosts', 'poachingCosts', 'gameIncome', 'executiveRoyalties',
  'gainOnSale', 'patentConversion', 'bondDefaults', 'bondWriteoffs', 'accountingOverhead',
  'bondInterestExpense', 'bondInterestIncome', 'donations', 'otherComprehensiveIncome',
  'netIncome', 'economicValueAdded', 'cashAllExpenses', 'isComputed'
] as const;

const CASHFLOW_FIELDS = [
  'date', 'dateFrom', 'fromRetail', 'fromCustomers', 'fromExchange', 'fromInterest',
  'fromPoaching', 'fromGame', 'fromEmployees', 'fromRoyalties', 'toGame', 'toSuppliers',
  'toExchange', 'toEmployees', 'toExecutives', 'forInterest', 'forFees', 'forAccounting',
  'investmentInBonds', 'bonds', 'gameIncome', 'cashAllIncome', 'cashAllExpenses', 'isComputed'
] as const;

const BALANCE_FIELDS = [
  'date', 'cash', 'cashReservedForOrders', 'accountsReceivable', 'workInProcess', 'materials',
  'research', 'finishedGoods', 'investmentInBonds', 'buildings', 'constructionInProgress',
  'patents', 'bondsPayable', 'contributedCapital', 'retainedEarnings', 'valuationAllowance',
  'deposits'
] as const;

const OVERVIEW_FIELDS = [
  'total', 'currentAssets', 'nonCurrentAssets', 'liabilities', 'economicValueAdded',
  'evaProfit', 'evaRank', 'rank', 'date'
] as const;

const V3_PAST_FINANCE_FIELDS = [
  'total', 'currentAssets', 'cashAndReceivables', 'inventory', 'nonCurrentAssets',
  'buildings', 'patents', 'investmentInBonds', 'deposits', 'liabilities', 'rank', 'date'
] as const;

function assertFieldsPresent(obj: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const field of fields) {
    assert.ok(field in obj, `${label} must expose HAR field '${field}' (got keys: ${Object.keys(obj).join(',')})`);
  }
}

async function runFinanceChartsTest(): Promise<void> {
  console.log('================================================================');
  console.log(' P0 Finance Charts & Cash Ledger Verification (3201)');
  console.log('================================================================');

  const user = await register('charts');
  const headers = { Cookie: user.cookie };

  // --- Real money mutations through the public API so the ledger has
  // --- genuine rows: take a loan (income), repay part (expense).
  console.log('[1/9] Triggering real money mutations (loan take + partial repay)...');
  const takeRes = await fetch(`${baseUrl}/api/v2/companies/me/loans/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({ amount: 20000 })
  });
  assert.equal(takeRes.status, 200, 'loan take must succeed');
  const loan = (await takeRes.json()) as { loanId: number };
  assert.ok(loan.loanId, 'loan id returned');

  const repayRes = await fetch(`${baseUrl}/api/v2/companies/me/loans/${loan.loanId}/repay/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({ amount: 5000 })
  });
  assert.equal(repayRes.status, 200, 'loan partial repay must succeed');
  console.log('  -> loan +20000, repay -5000 executed through real API');

  // --- Income Statement ---
  console.log('[2/9] Income statement: 200 + HAR fields + math consistency...');
  const inc1 = await getJson('/api/v2/companies/me/income-statement/', user.cookie);
  assert.equal(inc1.status, 200, `income-statement must return 200 (got ${inc1.status}: ${JSON.stringify(inc1.body)})`);
  const inc = inc1.body as Record<string, unknown>;
  assertFieldsPresent(inc, INCOME_FIELDS, 'income-statement');
  assert.equal(inc.isComputed, true, 'isComputed must be true');

  // Expenses must be negative (or exactly 0).
  for (const field of ['cogs', 'constructionCosts', 'marketFees', 'salariesCosts', 'trainingCosts', 'poachingCosts', 'accountingOverhead', 'bondInterestExpense']) {
    const value = inc[field] as number;
    assert.ok(value <= 0, `income-statement.${field} must be <= 0 (got ${value})`);
  }
  // netIncome = exact component sum (client recomputes this).
  const componentSum =
    (inc.sales as number) + (inc.cogs as number) + (inc.freightOut as number)
    + (inc.constructionCosts as number) + (inc.marketFees as number) + (inc.salariesCosts as number)
    + (inc.trainingCosts as number) + (inc.poachingCosts as number) + (inc.gameIncome as number)
    + (inc.executiveRoyalties as number) + (inc.gainOnSale as number) + (inc.patentConversion as number)
    + (inc.accountingOverhead as number) + (inc.bondInterestExpense as number)
    + (inc.bondInterestIncome as number) + (inc.bondDefaults as number) + (inc.bondWriteoffs as number)
    + (inc.donations as number);
  const netIncome = inc.netIncome as number;
  assert.ok(
    Math.abs(netIncome - Math.round(componentSum * 100) / 100) < 0.01,
    `netIncome (${netIncome}) must equal component sum (${componentSum})`
  );
  // The 20000 loan credit and 5000 repayment must be reflected.
  assert.ok(Math.abs(netIncome - 15000) < 0.01, `netIncome must reflect +20000/-5000 loan flows (got ${netIncome})`);
  console.log(`  -> netIncome=${netIncome} equals component sum; expenses negative`);

  // --- Cashflow Statement ---
  console.log('[3/9] Cashflow statement: 200 + HAR fields + direction check...');
  const cf1 = await getJson('/api/v2/companies/me/cashflow-statement/', user.cookie);
  assert.equal(cf1.status, 200, `cashflow-statement must return 200 (got ${cf1.status})`);
  const cf = cf1.body as Record<string, unknown>;
  assertFieldsPresent(cf, CASHFLOW_FIELDS, 'cashflow-statement');
  assert.equal(cf.isComputed, true, 'isComputed must be true');
  const cashAllIncome = cf.cashAllIncome as number;
  const cashAllExpenses = cf.cashAllExpenses as number;
  assert.ok(cashAllIncome > 0, `cashAllIncome must be positive (got ${cashAllIncome})`);
  assert.ok(cashAllExpenses <= 0, `cashAllExpenses must be negative or zero (got ${cashAllExpenses})`);
  assert.ok(Math.abs(cashAllExpenses + 5000) < 0.01, `cashAllExpenses must include the -5000 repay (got ${cashAllExpenses})`);
  assert.ok(Math.abs(cashAllIncome - 20000) < 0.01 || cashAllIncome >= 20000, `cashAllIncome must include the +20000 loan (got ${cashAllIncome})`);
  console.log(`  -> cashAllIncome=${cashAllIncome}, cashAllExpenses=${cashAllExpenses}`);

  // --- Cashflow Recent (P1-01) ---
  console.log('[4/9] Cashflow recent: 200 + {data:[...]} ledger schema...');
  const recent1 = await getJson('/api/v2/companies/me/cashflow/recent/', user.cookie);
  assert.equal(recent1.status, 200, `cashflow/recent must return 200 (got ${recent1.status})`);
  const recent = recent1.body as { data: Array<Record<string, unknown>>; money: number; oldestPulled: boolean };
  assert.ok(Array.isArray(recent.data), 'recent.data must be an array');
  assert.ok(recent.data.length >= 2, `recent.data must contain the loan+repay rows (got ${recent.data.length})`);
  for (const entry of recent.data) {
    for (const field of ['id', 'datetime', 'money', 'category', 'description', 'descriptionKey', 'details']) {
      assert.ok(field in entry, `recent entry must expose '${field}'`);
    }
    assert.ok(typeof entry.money === 'number' && Number.isFinite(entry.money), 'money must be a finite signed number');
    assert.ok(typeof entry.category === 'string' && entry.category.length >= 1, 'category must be a non-empty code');
    assert.ok(entry.details === null || typeof entry.details === 'object', 'details must be an object');
  }
  const signed = recent.data.map(e => e.money as number);
  assert.ok(signed.some(v => v > 0), 'ledger must contain income entries (positive money)');
  assert.ok(signed.some(v => v < 0), 'ledger must contain expense entries (negative money)');
  // Newest first ordering.
  const times = recent.data.map(e => new Date(e.datetime as string).getTime());
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i - 1] >= times[i], 'recent entries must be ordered newest first');
  }
  console.log(`  -> ${recent.data.length} ledger rows, signed amounts present, newest first`);

  // --- Past Finances Overview (P0-01 chart data) ---
  console.log('[5/9] Past-finances-overview: 200 array with daily snapshot fields...');
  const ov1 = await getJson('/api/v2/companies/me/past-finances-overview/', user.cookie);
  assert.equal(ov1.status, 200, `past-finances-overview must return 200 (got ${ov1.status})`);
  const overview = ov1.body as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(overview), 'overview must be an array');
  assert.ok(overview.length >= 1, `overview must have at least today's snapshot (got ${overview.length})`);
  for (const row of overview) {
    assertFieldsPresent(row, OVERVIEW_FIELDS, 'overview row');
    assert.ok(typeof row.total === 'number' && row.total > 0, 'snapshot total must be positive');
    const ca = row.currentAssets as number;
    const nca = row.nonCurrentAssets as number;
    const total = row.total as number;
    const liab = row.liabilities as number;
    assert.ok(
      Math.abs(total - (ca + nca - Math.abs(liab))) < 1 || Math.abs(total - (ca + nca)) < 1,
      `snapshot total (${total}) must be consistent with currentAssets+nonCurrentAssets-liabilities (${ca}+${nca}-${liab})`
    );
  }
  // Snapshot dates must be daily-distinct (idempotent upsert, one per day).
  const dayKeys = new Set(overview.map(r => String(r.date).slice(0, 10)));
  assert.equal(dayKeys.size, overview.length, 'one snapshot per UTC day (idempotent upsert)');
  console.log(`  -> ${overview.length} snapshot row(s), fields consistent`);

  // Idempotent upsert: after a second GET (no mutations) row count must not grow.
  const ov2 = await getJson('/api/v2/companies/me/past-finances-overview/', user.cookie);
  assert.equal(ov2.status, 200);
  assert.equal((ov2.body as unknown[]).length, overview.length, 'repeat GET must not add snapshot rows');

  // --- Past Finances v3 ---
  console.log('[6/9] v3 past-finances: 200 richer schema...');
  const pf1 = await getJson('/api/v3/companies/me/past-finances/', user.cookie);
  assert.equal(pf1.status, 200, `v3 past-finances must return 200 (got ${pf1.status})`);
  const pf = pf1.body as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(pf) && pf.length >= 1, 'v3 past-finances must be a non-empty array');
  assertFieldsPresent(pf[0], V3_PAST_FINANCE_FIELDS, 'v3 past-finances row');
  console.log(`  -> ${pf.length} row(s) with cashAndReceivables/inventory/buildings breakdown`);

  // --- Balance Sheet ---
  console.log('[7/9] Balance sheet: official camelCase object...');
  const bal1 = await getJson('/api/v2/companies/me/balance-sheet/', user.cookie);
  assert.equal(bal1.status, 200, `balance-sheet must return 200 (got ${bal1.status})`);
  const bal = bal1.body as Record<string, unknown>;
  assertFieldsPresent(bal, BALANCE_FIELDS, 'balance-sheet');
  // Balance math must tie to DB money.
  assert.ok(typeof bal.cash === 'number' && bal.cash > 0, 'balance sheet cash must be positive');
  const equity = (bal.cash as number) + (bal.materials as number) + (bal.buildings as number)
    + (bal.investmentInBonds as number) - (bal.bondsPayable as number);
  const expectedRetained = Math.round((equity - (bal.contributedCapital as number)) * 100) / 100;
  assert.ok(
    Math.abs((bal.retainedEarnings as number) - Math.max(0, expectedRetained)) < 1,
    `retainedEarnings must equal assets - liabilities - contributedCapital (got ${bal.retainedEarnings}, expected ~${expectedRetained})`
  );
  console.log('  -> camelCase balance sheet with consistent equity math');

  // --- Administration overhead & plus-one (verify only) ---
  console.log('[8/9] administration-overhead & plus-one: 200...');
  const ad = await getJson('/api/v2/companies/me/administration-overhead/', user.cookie);
  assert.equal(ad.status, 200, `administration-overhead must return 200 (got ${ad.status})`);
  const ad1 = await getJson('/api/v2/companies/me/administration-overhead/plus-one/', user.cookie);
  assert.equal(ad1.status, 200, `administration-overhead/plus-one must return 200 (got ${ad1.status})`);
  assert.ok(typeof ad.body === 'number' || typeof ad.body === 'object', 'admin overhead must be numeric or object');
  console.log('  -> both endpoints 200');

  // --- GET idempotence: no hidden writes anywhere ---
  console.log('[9/9] GET idempotence: repeat GETs return byte-identical bodies...');
  const endpoints = [
    '/api/v2/companies/me/income-statement/',
    '/api/v2/companies/me/cashflow-statement/',
    '/api/v2/companies/me/cashflow/recent/',
    '/api/v2/companies/me/past-finances-overview/',
    '/api/v3/companies/me/past-finances/',
    '/api/v2/companies/me/balance-sheet/'
  ];
  for (const endpoint of endpoints) {
    const a = await getJson(endpoint, user.cookie);
    const b = await getJson(endpoint, user.cookie);
    assert.equal(a.status, 200, `${endpoint} first GET 200`);
    assert.equal(b.status, 200, `${endpoint} second GET 200`);
    // Strip the 'date' fields that legitimately advance between calls.
    const normalize = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(normalize);
      if (x && typeof x === 'object') {
        const copy = { ...(x as Record<string, unknown>) };
        delete copy.date;
        delete copy.dateFrom;
        if ('data' in copy && Array.isArray(copy.data)) copy.data = (copy.data as Array<Record<string, unknown>>).map(normalize);
        return copy;
      }
      return x;
    };
    assert.deepEqual(
      normalize(a.body), normalize(b.body),
      `${endpoint} must be read-only (identical bodies on repeat GET)`
    );
  }
  // Ledger row count stable across the idempotence GETs.
  const recent3 = await getJson('/api/v2/companies/me/cashflow/recent/', user.cookie);
  assert.equal(((recent3.body as { data: unknown[] }).data).length, recent.data.length, 'no new ledger rows from GETs');
  console.log('  -> all 6 endpoints read-only verified');

  console.log('================================================================');
  console.log(' [PASS] P0 FINANCE CHARTS: ALL CHECKS PASSED');
  console.log('================================================================');
}

runFinanceChartsTest().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
