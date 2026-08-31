import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `finance_${label}_${Date.now()}@simcompanies.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', company: `Fin-${label}-${Date.now()}` })
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(v => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie);
  const auth = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } })).json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function runFinancialReportsTest() {
  console.log('================================================================');
  console.log(' Starting Issue #46 Financial Reports & Valuation Verification');
  console.log('================================================================');

  const user = await register('bal');
  const headers = { Cookie: user.cookie };

  // Get actual DB values for cross-check
  const money = Number((db.prepare('SELECT money FROM companies WHERE company_id = ?').get(user.companyId) as { money: number })?.money || 0);
  const invRow = db.prepare('SELECT COALESCE(SUM(amount * cost_market), 0) AS total FROM warehouse WHERE company_id = ?').get(user.companyId) as { total: number };
  const bldRow = db.prepare('SELECT COALESCE(SUM(cost), 0) AS total FROM buildings WHERE company_id = ?').get(user.companyId) as { total: number };
  const dbInventory = Number(invRow?.total) || 0;
  const dbBuildings = Number(bldRow?.total) || 0;

  console.log(`[1/4] Cross-checking balance sheet against DB actuals...`);
  console.log(`  -> DB money: ${money}, inventory: ${dbInventory}, buildings: ${dbBuildings}`);

  const balRes = await fetch(`${baseUrl}/api/v2/companies/me/balance-sheet/`, { headers });
  assert.equal(balRes.status, 200, 'Balance sheet must return 200');
  const bal = (await balRes.json()) as {
    cash: number; materials: number; finishedGoods: number; buildings: number;
    contributedCapital: number; retainedEarnings: number; valuationAllowance: number;
  };

  assert.equal(bal.cash, money, 'Balance sheet cash must match DB money');
  assert.equal(bal.materials, dbInventory, 'Balance sheet materials must match warehouse valuation');
  assert.equal(bal.buildings, dbBuildings, 'Balance sheet buildings must match building cost sum');
  // Official HAR contract: contributedCapital + retainedEarnings + valuationAllowance ≈ equity = assets.
  const equity = bal.contributedCapital + bal.retainedEarnings + bal.valuationAllowance;
  assert.equal(equity, bal.cash + bal.materials + bal.buildings, 'Equity must equal cash + inventory + buildings (HAR camelCase schema)');
  console.log('  -> Balance sheet matches authoritative DB values (official camelCase schema)');

  console.log('[2/4] Verifying income statement returns 200 with official schema...');
  const incRes = await fetch(`${baseUrl}/api/v2/companies/me/income-statement/`, { headers });
  assert.equal(incRes.status, 200, 'Income statement must return 200 (official HAR)');
  const inc = (await incRes.json()) as { netIncome: number; sales: number; isComputed: boolean };
  assert.equal(typeof inc.netIncome, 'number', 'netIncome must be numeric');
  assert.equal(inc.isComputed, true, 'isComputed flag present');
  console.log('  -> Income statement returns official camelCase schema');

  console.log('[3/4] Verifying cashflow statement returns 200 with official schema...');
  const cfRes = await fetch(`${baseUrl}/api/v2/companies/me/cashflow-statement/`, { headers });
  assert.equal(cfRes.status, 200, 'Cashflow statement must return 200 (official HAR)');
  const cf = (await cfRes.json()) as { cashAllIncome: number; cashAllExpenses: number; isComputed: boolean };
  assert.equal(typeof cf.cashAllIncome, 'number', 'cashAllIncome must be numeric');
  assert.equal(cf.isComputed, true, 'isComputed flag present');
  console.log('  -> Cashflow statement returns official camelCase schema');

  console.log('[4/4] Verifying past-finances-overview returns 200 array...');
  const pfRes = await fetch(`${baseUrl}/api/v2/companies/me/past-finances-overview/`, { headers });
  assert.equal(pfRes.status, 200, 'Past finances overview must return 200 (official HAR)');
  const pf = (await pfRes.json()) as Array<{ total: number; date: string }>;
  assert.ok(Array.isArray(pf), 'past-finances-overview must be an array');
  console.log('  -> Past finances overview returns daily snapshot array');

  console.log('================================================================');
  console.log(' [OK] ISSUE #46 FINANCIAL REPORTS PASSED ALL CHECKS');
  console.log('================================================================');
}

runFinancialReportsTest().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
