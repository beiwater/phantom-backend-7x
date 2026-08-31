/**
 * Round-3 regression tests for P0-06 / P0-07 / P0-08.
 *
 * Run against a live private server (fresh DATA_DIR recommended):
 *   PORT=3503 node --experimental-strip-types tests/verify-round3-retail-build.test.ts
 *
 * Covers:
 *   P0-06 grocery retail: resources-retail-info carries top-level
 *     averagePrice/saturation (frontend display-case gate); POST
 *     /api/v1/busy/:id/ sells retail goods transactionally (stock down,
 *     cash up, cash_ledger category 's').
 *   P0-07 building slots: POST /api/v2/unlock/ spends SimBoosts; building at
 *     the client's extra-slot position "B0" then succeeds and persists.
 *   P0-08 buy missing materials: POST /api/v2/market-order/take/ without
 *     maxPrice (the client's contract) buys from exchange orders; failure
 *     paths leave no partial state.
 */
const PORT = process.env.PORT || '3503';
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  FAIL ${label}`);
  }
}

interface TestClient {
  cookie: string;
  companyId: number;
}

async function register(name: string): Promise<TestClient> {
  const res = await fetch(`${BASE}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `retail_build_${name}_${Date.now()}@test.local`, password: 'Password123!', companyName: `${name} Co` })
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const auth = await (await fetch(`${BASE}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } })).json();
  return { cookie, companyId: auth.authCompany.companyId };
}

async function api(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

async function getBuildings(cookie: string): Promise<Array<{ id: number; kind: string; position: string }>> {
  const res = await api(cookie, 'GET', '/api/v2/companies/me/buildings/');
  return res.data;
}

async function main() {
  console.log(`\n== Round-3 retail/build regression (${BASE}) ==\n`);

  // ---------------- P0-06 ----------------
  console.log('P0-06: grocery retail sell flow');
  {
    const c = await register('P0six');
    assert(c.companyId > 0, 'P0-06 company registered');

    // retail-info must expose top-level averagePrice/saturation (display-case render gate)
    const retailInfo = await api(c.cookie, 'GET', '/api/v4/0/resources-retail-info/');
    assert(retailInfo.status === 200 && Array.isArray(retailInfo.data), 'GET /api/v4/0/resources-retail-info/ 200 array');
    const apple = retailInfo.data.find((e: { dbLetter: number }) => e.dbLetter === 3);
    assert(apple && typeof apple.averagePrice === 'number' && apple.averagePrice > 0, 'apple entry has top-level averagePrice > 0');
    assert(apple && typeof apple.saturation === 'number', 'apple entry has top-level saturation');

    const buildings = await getBuildings(c.cookie);
    const grocery = buildings.find(b => b.kind === 'G');
    assert(!!grocery, 'seeded grocery store exists');
    if (!grocery) throw new Error('grocery missing');

    // Stock the warehouse with apples by buying them at the exchange (Q0 orders exist)
    const buyApples = await api(c.cookie, 'POST', '/api/v2/market-order/take/', { resource: 3, quantity: 200, quality: 0, money: 100000 });
    assert(buyApples.status === 200 && buyApples.data.amountBought === 200, `bought 200 apples (${buyApples.status})`);

    const authBefore = await api(c.cookie, 'GET', '/api/v3/companies/auth-data/');
    const moneyBefore = authBefore.data.authCompany.money;

    // The retail sell contract: POST /api/v1/busy/:id/ { kind, amount, price, estimatedSecondsToFinish, forceQuality }
    const sell = await api(c.cookie, 'POST', `/api/v1/busy/${grocery.id}/`, {
      kind: 3, amount: 100, price: 2, estimatedSecondsToFinish: 60, forceQuality: 0
    });
    assert(sell.status === 200, `retail sell POST /api/v1/busy/ 200 (got ${sell.status} ${JSON.stringify(sell.data).slice(0, 120)})`);

    const authAfter = await api(c.cookie, 'GET', '/api/v3/companies/auth-data/');
    assert(authAfter.data.authCompany.money > moneyBefore, `cash increased after sale (${moneyBefore} -> ${authAfter.data.authCompany.money})`);

    const stock = await api(c.cookie, 'GET', `/api/v3/resources/${c.companyId}/`);
    const appleStock = stock.data.find((r: { kind: number }) => r.kind === 3);
    // seed stock is 5000 apples: 5000 + 200 bought - 100 sold
    assert(appleStock && appleStock.amount === 5000 + 200 - 100, `apple stock reduced to 5100 (got ${appleStock?.amount})`);

    const db = await import('node:sqlite');
    const { DatabaseSync } = db as unknown as { DatabaseSync: typeof import('node:sqlite').DatabaseSync };
    // locate the server's sqlite file through the config default
    const { execSync } = await import('node:child_process');
    const dataDir = process.env.DATA_DIR || 'data';
    const sqlitePath = `${dataDir}/simcompanies.sqlite`;
    let store: import('node:sqlite').DatabaseSync | null = null;
    try {
      store = new DatabaseSync(sqlitePath, { readOnly: true });
    } catch {
      console.error(`  (skip direct sqlite checks — cannot open ${sqlitePath})`);
    }
    if (store) {
      const ledger = store.prepare("SELECT amount, category FROM cash_ledger WHERE company_id = ? AND category = 's' ORDER BY id DESC LIMIT 1").get(c.companyId) as { amount: number; category: string } | undefined;
      assert(!!ledger && ledger.amount === 200, `cash_ledger 's' row +$200 exists (got ${JSON.stringify(ledger)})`);
      const wh = store.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 3').get(c.companyId) as { amount: number } | undefined;
      assert(!!wh && wh.amount === 5000 + 200 - 100, `warehouse apples = 5100 (got ${JSON.stringify(wh)})`);
      store.close();
    }
    void execSync;
  }

  // ---------------- P0-07 ----------------
  console.log('\nP0-07: unlock building slot, build at "B0", persists');
  {
    const c = await register('P0seven');
    // top up SimBoosts for the unlock cost (50)
    const { DatabaseSync } = await import('node:sqlite');
    const store = new DatabaseSync(process.env.DATA_DIR ? `${process.env.DATA_DIR}/simcompanies.sqlite` : 'data/simcompanies.sqlite');
    store.prepare('UPDATE companies SET simboosts = 250 WHERE company_id = ?').run(c.companyId);
    store.close();

    const before = await getBuildings(c.cookie);
    assert(!before.some(b => b.position === 'B0'), 'no building at B0 before unlock');

    const unlock = await api(c.cookie, 'POST', '/api/v2/unlock/');
    assert(unlock.status === 200 && unlock.data.success === true, `unlock slot 200 spent=${unlock.data?.spent}`);

    const locked = await api(c.cookie, 'POST', '/api/v2/companies/me/buildings/', { position: 'B1', id: 'P' });
    assert(locked.status === 400, `building at B1 (not unlocked) rejected (${locked.status})`);

    const build = await api(c.cookie, 'POST', '/api/v2/companies/me/buildings/', { position: 'B0', id: 'P' });
    assert(build.status === 200, `build at B0 200 (got ${build.status} ${JSON.stringify(build.data).slice(0, 120)})`);

    const after = await getBuildings(c.cookie);
    assert(after.some(b => b.position === 'B0'), 'B0 building persists after refresh');
  }

  // ---------------- P0-08 ----------------
  console.log('\nP0-08: buy missing materials (market take without maxPrice)');
  {
    const c = await register('P0eight');

    // Contract: the client's buyResources sends NO maxPrice — must not 400.
    const take = await api(c.cookie, 'POST', '/api/v2/market-order/take/', { resource: 3, quantity: 100, quality: 0, money: 100000 });
    assert(take.status === 200, `take without maxPrice 200 (got ${take.status} ${JSON.stringify(take.data).slice(0, 120)})`);
    assert(take.data.amountBought === 100, `bought the requested 100 apples (got ${take.data?.amountBought})`);

    const auth = await api(c.cookie, 'GET', '/api/v3/companies/auth-data/');
    assert(auth.data.authCompany.money < 100000, 'cash decreased after purchase');

    const stock = await api(c.cookie, 'GET', `/api/v3/resources/${c.companyId}/`);
    const appleStock = stock.data.find((r: { kind: number }) => r.kind === 3);
    // seed 5000 + 100 bought
    assert(appleStock && appleStock.amount === 5000 + 100, `warehouse received apples (got ${appleStock?.amount})`);

    // Failure path: impossible quantity must not leave partial state.
    const authBefore = await api(c.cookie, 'GET', '/api/v3/companies/auth-data/');
    const bad = await api(c.cookie, 'POST', '/api/v2/market-order/take/', { resource: 76, quantity: 5, quality: 0, money: 100000 });
    assert(bad.status === 400, `unsatisfiable take rejected (${bad.status})`);
    const authAfter = await api(c.cookie, 'GET', '/api/v3/companies/auth-data/');
    assert(authAfter.data.authCompany.money === authBefore.data.authCompany.money, 'no cash movement on failed take');
    const stockAfter = await api(c.cookie, 'GET', `/api/v3/resources/${c.companyId}/`);
    const carbComp = stockAfter.data.find((r: { kind: number }) => r.kind === 76);
    assert(!carbComp || carbComp.amount === 0, 'no partial stock on failed take');
  }

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failures.length) {
    console.error('Failures:');
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
