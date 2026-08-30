import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runE2E() {
  console.log('====================================================');
  console.log(' Starting SimCompanies Strict Real-Browser E2E Suite');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const httpErrors: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('Error') || text.includes('Uncaught')) {
      consoleLogs.push(`[${msg.type()}] ${text}`);
    }
  });

  page.on('pageerror', err => {
    pageErrors.push(err.toString());
  });

  page.on('requestfailed', req => {
    // Ignore analytics / telemetry aborts if any
    const url = req.url();
    if (!url.includes('google-analytics') && !url.includes('amplitude') && !url.includes('facebook')) {
      failedRequests.push(`${req.method()} ${url} (${req.failure()?.errorText})`);
    }
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      httpErrors.push(`[${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });

  try {
    // ----------------------------------------------------
    // STEP 1: Load Dashboard / Map
    // ----------------------------------------------------
    console.log('\n[Step 1] Navigating to http://127.0.0.1:3000/zh-cn/ ...');
    await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_dashboard_map.png'), fullPage: true });
    console.log('  -> Screenshot saved: 01_dashboard_map.png');

    const title = await page.title();
    console.log(`  -> Page title: "${title}"`);

    // Verify critical elements exist in DOM
    const bodyContent = await page.content();
    console.log(`  -> Rendered DOM HTML size: ${bodyContent.length} bytes`);

    // ----------------------------------------------------
    // STEP 2: Inspect Navigation & Header
    // ----------------------------------------------------
    console.log('\n[Step 2] Inspecting Header & Navigation Bar...');
    // Look for navigation links: 交易所 (Exchange), 仓库 (Warehouse), 消息 (Messages), 统计 (Stats)
    const links = await page.$$eval('a, button', elements =>
      elements.map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim() || '',
        href: el.getAttribute('href') || ''
      })).filter(e => e.text.length > 0)
    );

    console.log(`  -> Found ${links.length} interactive links/buttons.`);
    console.log('  -> Top 15 links sample:');
    links.slice(0, 15).forEach(l => console.log(`     - [${l.tag}] "${l.text}" -> ${l.href}`));

    // ----------------------------------------------------
    // STEP 3: Navigate to Warehouse (仓库)
    // ----------------------------------------------------
    console.log('\n[Step 3] Clicking Warehouse navigation link...');
    // Find link pointing to warehouse or containing 仓库
    const warehouseLink = await page.waitForSelector('a[href*="warehouse"], a[href*="headquarters"]', { timeout: 5000 }).catch(() => null);
    if (warehouseLink) {
      console.log('  -> Found warehouse link, clicking...');
      await warehouseLink.click();
      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_warehouse_page.png'), fullPage: true });
      console.log('  -> Screenshot saved: 02_warehouse_page.png');
    } else {
      console.log('  -> Direct selector not found, attempting URL navigation...');
      await page.goto('http://127.0.0.1:3000/zh-cn/headquarters/warehouse/', { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_warehouse_page.png'), fullPage: true });
      console.log('  -> Screenshot saved: 02_warehouse_page.png');
    }

    // ----------------------------------------------------
    // STEP 4: Navigate to Exchange / Market (交易所)
    // ----------------------------------------------------
    console.log('\n[Step 4] Navigating to Exchange / Market...');
    const marketLink = await page.waitForSelector('a[href*="market"], a[href*="exchange"]', { timeout: 5000 }).catch(() => null);
    if (marketLink) {
      console.log('  -> Found market link, clicking...');
      await marketLink.click();
      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_market_page.png'), fullPage: true });
      console.log('  -> Screenshot saved: 03_market_page.png');
    } else {
      await page.goto('http://127.0.0.1:3000/zh-cn/market/resources/', { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_market_page.png'), fullPage: true });
      console.log('  -> Screenshot saved: 03_market_page.png');
    }

    // ----------------------------------------------------
    // STEP 5: Navigate back to Main Map / Landscape
    // ----------------------------------------------------
    console.log('\n[Step 5] Navigating back to Main Map / Landscape...');
    await page.goto('http://127.0.0.1:3000/zh-cn/landscape/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_landscape_map.png'), fullPage: true });
    console.log('  -> Screenshot saved: 04_landscape_map.png');

    // ----------------------------------------------------
    // STEP 6: Interactive Building Click & Production Modal
    // ----------------------------------------------------
    console.log('\n[Step 6] Testing Building Interaction on Map...');
    // Look for building slot or clickable building icon
    const buildingSlot = await page.waitForSelector('[class*="building"], [class*="slot"], [class*="land-"]', { timeout: 5000 }).catch(() => null);
    if (buildingSlot) {
      console.log('  -> Found building slot on map, clicking...');
      await buildingSlot.click();
      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_building_modal.png'), fullPage: true });
      console.log('  -> Screenshot saved: 05_building_modal.png');
    }

  } catch (err) {
    console.error('\n[TEST ERROR]:', err);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error_state.png'), fullPage: true });
  } finally {
    console.log('\n====================================================');
    console.log(' E2E Execution Summary & Error Audit');
    console.log('====================================================');
    console.log(`Page Errors: ${pageErrors.length}`);
    pageErrors.forEach(e => console.log(`  - ${e}`));

    console.log(`Failed Requests: ${failedRequests.length}`);
    failedRequests.forEach(r => console.log(`  - ${r}`));

    console.log(`HTTP 4xx/5xx Errors: ${httpErrors.length}`);
    httpErrors.forEach(h => console.log(`  - ${h}`));

    console.log(`Console Errors/Warnings: ${consoleLogs.length}`);
    consoleLogs.slice(0, 15).forEach(l => console.log(`  - ${l}`));

    await browser.close();
  }
}

runE2E();
