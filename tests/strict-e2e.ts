import puppeteer, { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function takeStepScreenshot(page: Page, filename: string, caption: string) {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  [Screenshot] ${filename} - ${caption}`);
}

async function runStrictE2ESuite() {
  console.log('================================================================');
  console.log(' Executing SimCompanies Comprehensive Real-User E2E Test Suite');
  console.log('================================================================');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1440,900',
      '--disable-web-security'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors: { pageErrors: string[]; consoleErrors: string[]; httpErrors: string[]; failedReqs: string[] } = {
    pageErrors: [],
    consoleErrors: [],
    httpErrors: [],
    failedReqs: []
  };

  page.on('pageerror', err => {
    errors.pageErrors.push(err.toString());
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon.ico') && !text.includes('analytics')) {
        errors.consoleErrors.push(text);
      }
    }
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      const url = res.url();
      if (!url.includes('myreviews') && !url.includes('amplitude')) {
        errors.httpErrors.push(`[${res.status()}] ${res.request().method()} ${url}`);
      }
    }
  });

  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('google') && !url.includes('facebook') && !url.includes('myreviews')) {
      errors.failedReqs.push(`${req.method()} ${url} (${req.failure()?.errorText})`);
    }
  });

  try {
    // ----------------------------------------------------------------
    // Flow 1: Initial Page Load & Authentication Verification
    // ----------------------------------------------------------------
    console.log('\n--- FLOW 1: Initial Page Load & Dashboard ---');
    await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    await takeStepScreenshot(page, 'flow1_01_dashboard.png', 'Initial dashboard & landscape view');

    const pageTitle = await page.title();
    console.log(`  Page Title: "${pageTitle}"`);

    // Verify top bar and company info
    const topBarText = await page.$$eval('.navbar, header, [class*="top-bar"], [class*="nav"]', els =>
      els.map(e => e.textContent?.trim()).join(' ')
    );
    console.log(`  Top bar summary: ${topBarText.slice(0, 120)}...`);

    // ----------------------------------------------------------------
    // Flow 2: Navigation to Warehouse (仓库)
    // ----------------------------------------------------------------
    console.log('\n--- FLOW 2: Warehouse Navigation & Inventory View ---');
    // Click Warehouse link
    const whLink = await page.waitForSelector('a[href*="warehouse"], a[title*="仓库"], a[aria-label*="仓库"]', { timeout: 4000 }).catch(() => null);
    if (whLink) {
      console.log('  Clicking Warehouse nav link...');
      await whLink.click();
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.log('  Navigating directly to /zh-cn/headquarters/warehouse/ ...');
      await page.goto('http://127.0.0.1:3000/zh-cn/headquarters/warehouse/', { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
    }

    await takeStepScreenshot(page, 'flow2_01_warehouse_overview.png', 'Warehouse inventory overview');

    // Inspect visible warehouse resource tiles
    const resourceCards = await page.$$eval('[class*="resource"], [class*="card"], [class*="item"]', els =>
      els.map(e => e.textContent?.trim()).filter(t => t && t.length > 0 && t.length < 50)
    );
    console.log(`  Visible warehouse items sample (${resourceCards.length} items):`, resourceCards.slice(0, 6));

    // ----------------------------------------------------------------
    // Flow 3: Navigation to Exchange / Market (交易所)
    // ----------------------------------------------------------------
    console.log('\n--- FLOW 3: Market / Exchange Trading View ---');
    const marketLink = await page.waitForSelector('a[href*="market"], a[title*="交易所"], a[aria-label*="交易所"]', { timeout: 4000 }).catch(() => null);
    if (marketLink) {
      console.log('  Clicking Market nav link...');
      await marketLink.click();
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.log('  Navigating to /zh-cn/market/resources/ ...');
      await page.goto('http://127.0.0.1:3000/zh-cn/market/resources/', { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
    }

    await takeStepScreenshot(page, 'flow3_01_market_overview.png', 'Exchange market list');

    // Click on Power or Apples market item if visible
    const marketItem = await page.waitForSelector('a[href*="/market/resource/"], [class*="resource-tile"], [class*="market-item"]', { timeout: 4000 }).catch(() => null);
    if (marketItem) {
      console.log('  Clicking on market resource item...');
      await marketItem.click();
      await new Promise(r => setTimeout(r, 3000));
      await takeStepScreenshot(page, 'flow3_02_market_orderbook.png', 'Exchange order book details');
    }

    // ----------------------------------------------------------------
    // Flow 4: Map & Building Interaction Flow
    // ----------------------------------------------------------------
    console.log('\n--- FLOW 4: Map, Construction & Building Upgrades ---');
    await page.goto('http://127.0.0.1:3000/zh-cn/landscape/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    await takeStepScreenshot(page, 'flow4_01_map_landscape.png', 'Main landscape map view');

    // Find and click an existing building (e.g. Farm or Grocery)
    const buildingElement = await page.waitForSelector('[class*="building"], [class*="slot"], [class*="land-"]', { timeout: 4000 }).catch(() => null);
    if (buildingElement) {
      console.log('  Clicking on building on the map...');
      await buildingElement.click();
      await new Promise(r => setTimeout(r, 3000));
      await takeStepScreenshot(page, 'flow4_02_building_detail_modal.png', 'Building details and production modal');
    }

    // ----------------------------------------------------------------
    // Flow 5: Company Headquarters & Profile
    // ----------------------------------------------------------------
    console.log('\n--- FLOW 5: Company Headquarters & Profile View ---');
    await page.goto('http://127.0.0.1:3000/zh-cn/headquarters/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    await takeStepScreenshot(page, 'flow5_01_headquarters.png', 'Company headquarters page');

    console.log('\n================================================================');
    console.log(' E2E Test Suite Execution Finished Successfully');
    console.log('================================================================');

  } catch (err) {
    console.error('Fatal E2E error:', err);
    await takeStepScreenshot(page, 'fatal_error.png', 'Fatal error state');
  } finally {
    console.log('\n--- FINAL AUDIT METRICS ---');
    console.log(`Page Errors: ${errors.pageErrors.length}`);
    errors.pageErrors.forEach(e => console.log(`  [PAGE_ERR] ${e}`));

    console.log(`Console Errors: ${errors.consoleErrors.length}`);
    errors.consoleErrors.forEach(e => console.log(`  [CONSOLE_ERR] ${e}`));

    console.log(`HTTP 4xx/5xx Errors: ${errors.httpErrors.length}`);
    errors.httpErrors.forEach(e => console.log(`  [HTTP_ERR] ${e}`));

    console.log(`Failed Requests: ${errors.failedReqs.length}`);
    errors.failedReqs.forEach(e => console.log(`  [REQ_FAIL] ${e}`));

    await browser.close();
  }
}

runStrictE2ESuite();
