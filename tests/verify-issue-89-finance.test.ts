import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3760');
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
      // polling network
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 150);
    await promise;
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

  const dataDir = path.resolve('data', `test-run-finance-89-${Date.now()}`);
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
      process.stderr.write(str);
    }
  });

  // Integration test: poll spawned child process until HTTP server is ready
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);

  return {
    child,
    dataDir,
    dbPath: path.join(dataDir, 'simcompanies.sqlite')
  };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number; playerId: number }> {
  const email = `fin89_${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}@simcompanies.local`;
  const company = `Fin89-${label}-${Date.now().toString(36)}`;
  const response = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', company })
  });
  assert.equal(response.status, 200, `register ${label} must succeed`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(v => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'session cookie required');
  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  const auth = (await authRes.json()) as { authCompany: { companyId: number; playerId: number } };
  return { cookie, companyId: auth.authCompany.companyId, playerId: auth.authCompany.playerId };
}

async function runTests() {
  console.log('================================================================');
  console.log(' Starting Issue #89 Finance & Accounting Valuation Verification');
  console.log(` Target Port: ${TEST_PORT}`);
  console.log('================================================================');

  const server = await startTestServer();
  const db = new DatabaseSync(server.dbPath);

  try {
    // -------------------------------------------------------------------------
    // Test 1: Balance Sheet Accounting Equation (Assets = Liabilities + Equity)
    //         with Positive and Negative Retained Earnings
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying Balance Sheet Accounting Equation & Negative Retained Earnings...');
    const user1 = await registerCompany('eq');
    const headers1 = { Cookie: user1.cookie };

    // 1a. Default starter state: Assets = cash + inventory + buildings + bonds
    const balRes1 = await fetch(`${BASE_URL}/api/v2/companies/me/balance-sheet/`, { headers: headers1 });
    assert.equal(balRes1.status, 200, 'Balance sheet must return 200');
    const bal1 = await balRes1.json() as {
      cash: number;
      materials: number;
      finishedGoods: number;
      investmentInBonds: number;
      buildings: number;
      bondsPayable: number;
      contributedCapital: number;
      retainedEarnings: number;
      valuationAllowance: number;
    };

    const assets1 = bal1.cash + bal1.materials + bal1.investmentInBonds + bal1.buildings;
    const liabilities1 = bal1.bondsPayable;
    const equity1 = bal1.contributedCapital + bal1.retainedEarnings + bal1.valuationAllowance;
    assert.equal(
      Math.round(assets1 * 100) / 100,
      Math.round((liabilities1 + equity1) * 100) / 100,
      `Accounting equation Assets (${assets1}) = Liabilities (${liabilities1}) + Equity (${equity1}) must balance`
    );
    console.log(`  -> Initial balance sheet balances: Assets ($${assets1}) = Liabilities ($${liabilities1}) + Equity ($${equity1})`);

    // 1b. Force negative retained earnings by reducing company money below contributed capital
    // Starter contributed capital is $100,000. Set company money to $25,000, 0 buildings, 0 warehouse, 0 bonds.
    db.prepare('UPDATE companies SET money = 25000 WHERE company_id = ?').run(user1.companyId);
    db.prepare('DELETE FROM buildings WHERE company_id = ?').run(user1.companyId);
    db.prepare('DELETE FROM warehouse WHERE company_id = ?').run(user1.companyId);

    const balResNeg = await fetch(`${BASE_URL}/api/v2/companies/me/balance-sheet/`, { headers: headers1 });
    assert.equal(balResNeg.status, 200);
    const balNeg = await balResNeg.json() as typeof bal1;

    console.log(`  -> Negative Retained Earnings check: cash=$${balNeg.cash}, contributed=$${balNeg.contributedCapital}, retainedEarnings=$${balNeg.retainedEarnings}`);
    assert.equal(balNeg.cash, 25000);
    assert.equal(balNeg.contributedCapital, 100000);
    assert.equal(balNeg.bondsPayable, 0);
    // Retained earnings = $25,000 - 0 - $100,000 = -$75,000 (MUST NOT be clamped to 0)
    assert.equal(balNeg.retainedEarnings, -75000, 'retainedEarnings must be negative (-75000), not clamped to 0');

    const assetsNeg = balNeg.cash + balNeg.materials + balNeg.investmentInBonds + balNeg.buildings;
    const liabilitiesNeg = balNeg.bondsPayable;
    const equityNeg = balNeg.contributedCapital + balNeg.retainedEarnings + balNeg.valuationAllowance;
    assert.equal(assetsNeg, 25000);
    assert.equal(equityNeg, 25000);
    assert.equal(
      Math.round(assetsNeg * 100) / 100,
      Math.round((liabilitiesNeg + equityNeg) * 100) / 100,
      `Accounting equation Assets (${assetsNeg}) = Liabilities (${liabilitiesNeg}) + Equity (${equityNeg}) must hold when retained earnings is negative`
    );
    console.log('  -> Negative retained earnings accounting equation verified successfully');

    // -------------------------------------------------------------------------
    // Test 2: Bond Valuation ($5,000 Face Value per unit)
    // -------------------------------------------------------------------------
    console.log('[Test 2] Verifying Bond Valuation ($5,000 face value per unit)...');
    const user2 = await registerCompany('bonds');
    const headers2 = { Cookie: user2.cookie };

    // Insert 4 units of active bonds held by user2 (buyer_company_id = user2.companyId)
    // 4 units * $5,000 = $20,000
    db.prepare(`
      INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at, maturity_date, settled)
      VALUES (999901, ?, 0.005, 4, 'active', datetime('now'), datetime('now', '+30 days'), 0)
    `).run(user2.companyId);

    const balResBonds = await fetch(`${BASE_URL}/api/v2/companies/me/balance-sheet/`, { headers: headers2 });
    assert.equal(balResBonds.status, 200);
    const balBonds = await balResBonds.json() as typeof bal1;

    console.log(`  -> Bonds held value in balance sheet: investmentInBonds = $${balBonds.investmentInBonds}`);
    assert.equal(balBonds.investmentInBonds, 20000, '4 units of bonds must be valued at $20,000 ($5,000 face value per unit)');

    const assetsBonds = balBonds.cash + balBonds.materials + balBonds.investmentInBonds + balBonds.buildings;
    const liabilitiesBonds = balBonds.bondsPayable;
    const equityBonds = balBonds.contributedCapital + balBonds.retainedEarnings + balBonds.valuationAllowance;
    assert.equal(
      Math.round(assetsBonds * 100) / 100,
      Math.round((liabilitiesBonds + equityBonds) * 100) / 100,
      'Balance sheet with bonds must balance: Assets = Liabilities + Equity'
    );
    console.log('  -> Bond face value valuation verified successfully');

    // -------------------------------------------------------------------------
    // Test 3: Building Size Valuation (SUM(cost * size))
    // -------------------------------------------------------------------------
    console.log('[Test 3] Verifying Building Valuation with Size Multiplier (SUM(cost * size))...');
    const user3 = await registerCompany('bld');
    const headers3 = { Cookie: user3.cookie };

    // Clear existing buildings and insert buildings with custom size and cost:
    // Building A: cost = 8,000, size = 2 -> 16,000
    // Building B: cost = 12,500, size = 4 -> 50,000
    // Expected buildings valuation = 16,000 + 50,000 = 66,000
    db.prepare('DELETE FROM buildings WHERE company_id = ?').run(user3.companyId);
    db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, 'A', 'plantation', 2, 'Plantation Lvl 2', 8000, 'production', datetime('now'))
    `).run(user3.companyId);
    db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, 'B', 'electronics-factory', 4, 'Electronics Factory Lvl 4', 12500, 'production', datetime('now'))
    `).run(user3.companyId);

    const balResBld = await fetch(`${BASE_URL}/api/v2/companies/me/balance-sheet/`, { headers: headers3 });
    assert.equal(balResBld.status, 200);
    const balBld = await balResBld.json() as typeof bal1;

    console.log(`  -> Buildings valuation in balance sheet: buildings = $${balBld.buildings}`);
    assert.equal(balBld.buildings, 66000, 'buildings must be valued with size multiplier: SUM(cost * size) = 66,000');

    const assetsBld = balBld.cash + balBld.materials + balBld.investmentInBonds + balBld.buildings;
    const liabilitiesBld = balBld.bondsPayable;
    const equityBld = balBld.contributedCapital + balBld.retainedEarnings + balBld.valuationAllowance;
    assert.equal(
      Math.round(assetsBld * 100) / 100,
      Math.round((liabilitiesBld + equityBld) * 100) / 100,
      'Balance sheet with sized buildings must balance: Assets = Liabilities + Equity'
    );
    console.log('  -> Building size valuation verified successfully');

    // -------------------------------------------------------------------------
    // Test 4: Cashflow and Income Statement Category Classification
    //         - 'e': executive salaries (salariesCosts)
    //         - 'h': executive training (trainingCosts)
    //         - 'k' / 'c': contracts
    //         - 't': government spend
    // -------------------------------------------------------------------------
    console.log('[Test 4] Verifying Cashflow Category Classification...');
    const user4 = await registerCompany('cats');
    const headers4 = { Cookie: user4.cookie };
    const nowIso = new Date().toISOString().replace('Z', '+00:00');

    // Insert cash_ledger rows with specific categories:
    // 'e': Executive salary expense (-3,000)
    // 'h': Executive training expense (-1,500)
    // 'k': Contract expense (-5,000)
    // 'c': Construction/Contract expense (-8,000)
    // 't': Government spend (-2,000)
    // 's': Sales revenue (+20,000)
    db.prepare(`
      INSERT INTO cash_ledger (company_id, amount, category, description, description_key, details, created_at)
      VALUES
        (?, -3000, 'e', 'Executive salaries', '1-salaries', '{}', ?),
        (?, -1500, 'h', 'Executive training', '1-training', '{}', ?),
        (?, -5000, 'k', 'Contract purchase', 'contract-1', '{}', ?),
        (?, -8000, 'c', 'Construction expense', 'build-1', '{}', ?),
        (?, -2000, 't', 'Government spend', 'gov-spend', '{}', ?),
        (?, 20000, 's', 'Retail sales revenue', 'retail-1', '{}', ?)
    `).run(
      user4.companyId, nowIso,
      user4.companyId, nowIso,
      user4.companyId, nowIso,
      user4.companyId, nowIso,
      user4.companyId, nowIso,
      user4.companyId, nowIso
    );

    // 4a. Income Statement verification
    const incRes = await fetch(`${BASE_URL}/api/v2/companies/me/income-statement/`, { headers: headers4 });
    assert.equal(incRes.status, 200, 'Income statement must return 200');
    const inc = await incRes.json() as {
      sales: number;
      salariesCosts: number;
      trainingCosts: number;
      constructionCosts: number;
      isComputed: boolean;
      netIncome: number;
    };

    console.log(`  -> Income Statement: sales=${inc.sales}, salariesCosts=${inc.salariesCosts}, trainingCosts=${inc.trainingCosts}, constructionCosts=${inc.constructionCosts}`);
    assert.equal(inc.sales, 20000, 'sales must reflect category s (+20000)');
    assert.equal(inc.salariesCosts, -3000, 'salariesCosts must reflect category e (-3000)');
    assert.equal(inc.trainingCosts, -1500, 'trainingCosts must reflect category h (-1500)');
    assert.equal(inc.constructionCosts, -8000, 'constructionCosts must reflect category c (-8000)');
    assert.equal(inc.isComputed, true);

    // 4b. Cashflow Statement verification
    const cfRes = await fetch(`${BASE_URL}/api/v2/companies/me/cashflow-statement/`, { headers: headers4 });
    assert.equal(cfRes.status, 200, 'Cashflow statement must return 200');
    const cf = await cfRes.json() as {
      fromRetail: number;
      toExecutives: number;
      toSuppliers: number;
      cashAllIncome: number;
      cashAllExpenses: number;
      isComputed: boolean;
    };

    console.log(`  -> Cashflow Statement: fromRetail=${cf.fromRetail}, toExecutives=${cf.toExecutives}, toSuppliers=${cf.toSuppliers}, income=${cf.cashAllIncome}, expenses=${cf.cashAllExpenses}`);
    assert.equal(cf.fromRetail, 20000, 'fromRetail must reflect sales (+20000)');
    assert.equal(cf.toExecutives, -4500, 'toExecutives must reflect categories e + h (-3000 + -1500 = -4500)');
    assert.equal(cf.toSuppliers, -15000, 'toSuppliers must reflect categories k + c + t (-5000 + -8000 + -2000 = -15000)');
    assert.equal(cf.cashAllIncome, 20000, 'cashAllIncome must be 20000');
    assert.equal(cf.cashAllExpenses, -19500, 'cashAllExpenses must be -19500 (-3000-1500-5000-8000-2000)');
    assert.equal(cf.isComputed, true);

    // 4c. Recent Cashflow journal verification
    const recRes = await fetch(`${BASE_URL}/api/v2/companies/me/cashflow/recent/`, { headers: headers4 });
    assert.equal(recRes.status, 200, 'Cashflow recent must return 200');
    const rec = await recRes.json() as { data: Array<{ category: string; money: number }> };
    assert.ok(Array.isArray(rec.data), 'recent data must be an array');
    const recordedCategories = new Set(rec.data.map(d => d.category));
    assert.ok(recordedCategories.has('e'), 'cashflow recent must include category e');
    assert.ok(recordedCategories.has('h'), 'cashflow recent must include category h');
    assert.ok(recordedCategories.has('k'), 'cashflow recent must include category k');
    assert.ok(recordedCategories.has('c'), 'cashflow recent must include category c');
    assert.ok(recordedCategories.has('t'), 'cashflow recent must include category t');
    assert.ok(recordedCategories.has('s'), 'cashflow recent must include category s');
    console.log('  -> Cashflow categories classification verified successfully');

    console.log('================================================================');
    console.log(' All Issue #89 Finance & Accounting Assertions Passed (0 Errors)');
    console.log('================================================================');
  } finally {
    try {
      db.close();
    } catch {}
    server.child.kill('SIGTERM');
    try {
      if (existsSync(server.dataDir)) {
        rmSync(server.dataDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
