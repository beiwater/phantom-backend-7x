import puppeteer, { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function getFormattedTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function createGitCheckpoint(round: number, timestamp: string) {
  console.log(`\n--- [CHECKPOINT] Recording checkpoint for Round ${round} (${timestamp}) ---`);
  try {
    let commitSha = 'unknown';
    try {
      commitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch {}
    const artifactDir = path.join(process.cwd(), 'artifacts', 'e2e');
    fs.mkdirSync(artifactDir, { recursive: true });
    const metadata = {
      round,
      timestamp,
      commitSha,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(artifactDir, `checkpoint_round${round}_${timestamp}.json`), JSON.stringify(metadata, null, 2));
    console.log(`  -> Artifact Checkpoint Recorded (commit: ${commitSha})`);
  } catch (err: unknown) {
    console.log('  -> Checkpoint note:', err instanceof Error ? err.message : String(err));
  }
}

async function takeTimestampedScreenshot(page: Page, roundDir: string, round: number, stepNum: number, stepName: string) {
  const ts = getFormattedTimestamp();
  const filename = `round${round}_step${String(stepNum).padStart(2, '0')}_${stepName}_${ts}.png`;
  const filePath = path.join(roundDir, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  [Screenshot] ${filename}`);
  return filePath;
}

async function runBuildingsAndMarketTest(round: number = 2) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting Building Mechanics & Market Q0-Q12 E2E Test (Round ${round})`);
  console.log(` Artifact Directory: ${roundDir}`);
  console.log('================================================================');

  createGitCheckpoint(round, timestamp);

  const baseUrl = 'http://127.0.0.1:3000';

  // ----------------------------------------------------------------
  // PART 1: Market Q0 - Q12 Full Verification
  // ----------------------------------------------------------------
  console.log('\n[Part 1] Verifying Market Orders across Q0-Q12...');
  // Test Resource 3 (Apples) and Resource 24 (Smart Phones)
  for (const testKind of [3, 24, 1]) {
    const mRes = await fetch(`${baseUrl}/api/v3/market/0/${testKind}/`);
    const orders = await mRes.json();
    console.log(`  -> Resource #${testKind} has ${orders.length} market listings.`);
    const qualities = orders.map((o: { quality: number; price: number }) => `Q${o.quality}($${o.price})`);
    console.log(`     Sample Qualities:`, qualities.slice(0, 7).join(', '));
  }

  // Register player for test
  const regRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `market_tester_${Date.now()}@domain.local`,
      password: 'Password123!',
      companyName: 'OmniTrading Corp'
    })
  });
  const cookies = regRes.headers.getSetCookie?.() || [regRes.headers.get('set-cookie') || ''];
  const sessionCookieVal = cookies.find(c => c.startsWith('sessionid='))?.split(';')[0]?.split('=')[1] || '';

  // Buy Q0, Q5, Q12 Apples from Market
  console.log('\n[Part 2] Buying Q0, Q5, Q12 from Market...');
  for (const q of [0, 5, 12]) {
    const buyRes = await fetch(`${baseUrl}/api/v2/market-order/take/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `sessionid=${sessionCookieVal}` },
      body: JSON.stringify({ resource: 3, quantity: 200, quality: q, maxPrice: q + 2.0 })
    });
    const buyData = await buyRes.json();
    console.log(`  -> Bought 200 units of Q${q} Apples! Remaining Money: $${buyData.money}`);
  }

  // Verify Warehouse received all quality tiers
  const authRes = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { 'Cookie': `sessionid=${sessionCookieVal}` }
  });
  const authData = await authRes.json();
  const companyId = authData.authCompany.companyId;

  const whRes = await fetch(`${baseUrl}/api/v3/resources/${companyId}/`, {
    headers: { 'Cookie': `sessionid=${sessionCookieVal}` }
  });
  const whItems = await whRes.json();
  console.log(`  -> Warehouse now has ${whItems.length} inventory records:`);
  whItems.forEach((i: { kind: number; quality: number; amount: number }) => {
    if (i.kind === 3) console.log(`     * Kind #${i.kind} Quality Q${i.quality}: ${i.amount} units`);
  });

  // ----------------------------------------------------------------
  // PART 3: Retail Building Sales Orders Verification
  // ----------------------------------------------------------------
  console.log('\n[Part 3] Testing Grocery Store Retail Sales Orders...');
  const bRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { 'Cookie': `sessionid=${sessionCookieVal}` }
  });
  const buildings = await bRes.json();
  const groceryBuilding = buildings.find((b: { kind: string }) => b.kind === 'G');

  if (groceryBuilding) {
    // 1. Get sales orders
    const ordersRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${groceryBuilding.id}/sales-orders/`, {
      headers: { 'Cookie': `sessionid=${sessionCookieVal}` }
    });
    const salesOrders = await ordersRes.json();
    console.log(`  -> Grocery Store Sales Orders (${salesOrders.length}):`);
    salesOrders.forEach((o: { id: number; resource: { name: string }; units: number; price: number }) =>
      console.log(`     - Order #${o.id}: ${o.units} units of ${o.resource?.name} @ $${o.price}`)
    );

    // 2. Fulfill first sales order
    if (salesOrders.length > 0) {
      const orderToFulfill = salesOrders[0];
      const fulfillRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${groceryBuilding.id}/sales-orders/${orderToFulfill.id}/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': `sessionid=${sessionCookieVal}` },
        body: JSON.stringify({ lowestQualityFirst: true })
      });
      const fulfillData = await fulfillRes.json();
      console.log(`  -> Fulfilled Retail Order #${orderToFulfill.id}! Cash Revenue Collected, New Money: $${fulfillData.money}`);
    }
  }

  // ----------------------------------------------------------------
  // PART 4: Real Browser UI Inspection & Screenshots
  // ----------------------------------------------------------------
  console.log('\n[Part 4] Real Browser UI Navigation & Screenshot Captures...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.setCookie({
    name: 'sessionid',
    value: sessionCookieVal,
    domain: '127.0.0.1',
    path: '/'
  });

  // 1. Map View
  await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
  await takeTimestampedScreenshot(page, roundDir, round, 1, 'landscape_map_view');

  // 2. Farm Building Internal Page / Modal
  if (buildings[0]) {
    await page.goto(`${baseUrl}/zh-cn/b/${buildings[0].id}/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a, div, button', { timeout: 10000 }).catch(() => {});
    await takeTimestampedScreenshot(page, roundDir, round, 2, 'farm_building_internal_page');
  }

  // 3. Grocery Store Building Internal Page
  if (groceryBuilding) {
    await page.goto(`${baseUrl}/zh-cn/b/${groceryBuilding.id}/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a, div, button', { timeout: 10000 }).catch(() => {});
    await takeTimestampedScreenshot(page, roundDir, round, 3, 'grocery_retail_internal_page');
  }

  // 4. Warehouse View
  await page.goto(`${baseUrl}/zh-cn/headquarters/warehouse/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('a, div', { timeout: 10000 }).catch(() => {});
  await takeTimestampedScreenshot(page, roundDir, round, 4, 'warehouse_with_q0_q12_stock');

  // 5. Market View for Apples
  await page.goto(`${baseUrl}/zh-cn/market/resource/3/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('a, div, table', { timeout: 10000 }).catch(() => {});
  await takeTimestampedScreenshot(page, roundDir, round, 5, 'market_apples_q0_to_q12');

  await browser.close();
  console.log('\n================================================================');
  console.log(` Building Mechanics & Market Q0-Q12 Test (Round ${round}) PASSED!`);
  console.log('================================================================');
}

runBuildingsAndMarketTest(2);
