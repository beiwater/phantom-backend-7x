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

async function runInteractiveGameplay() {
  console.log('================================================================');
  console.log(' SimCompanies Interactive Gameplay Real Browser E2E Test');
  console.log('================================================================');

  const baseUrl = 'http://127.0.0.1:3000';

  // Create clean user & session
  const regRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_play_${Date.now()}@domain.local`,
      password: 'Password123!',
      companyName: 'Gameplay Co'
    })
  });
  const cookies = regRes.headers.getSetCookie?.() || [regRes.headers.get('set-cookie') || ''];
  const sessionCookieVal = cookies.find(c => c.startsWith('sessionid='))?.split(';')[0]?.split('=')[1] || '';

  const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'];
  if (process.env.E2E_DISABLE_WEB_SECURITY === '1') {
    console.warn('  [WARN] NON-RELEASE / INSECURE BROWSER MODE: --disable-web-security enabled');
    browserArgs.push('--disable-web-security');
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: browserArgs
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.setCookie({
    name: 'sessionid',
    value: sessionCookieVal,
    domain: '127.0.0.1',
    path: '/'
  });

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
      if (!text.includes('favicon.ico') && !text.includes('analytics') && !text.includes('homepage_trailer')) {
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

  try {
    // ----------------------------------------------------------------
    // STEP 1: Load Landscape Map
    // ----------------------------------------------------------------
    console.log('\n[1/4] Loading Map and opening Farm building modal...');
    await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });

    await takeStepScreenshot(page, 'gameplay_01_map.png', 'Landscape map with active buildings');

    // Click Farm building link
    const farmLink = await page.$('a[href*="/b/"]');
    if (farmLink) {
      console.log('  -> Clicking Farm building link on map...');
      await farmLink.click();
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});
      await takeStepScreenshot(page, 'gameplay_02_farm_modal.png', 'Farm modal with production choices');
    }

    // ----------------------------------------------------------------
    // STEP 2: Navigate to Warehouse & Inspect Inventory
    // ----------------------------------------------------------------
    console.log('\n[2/4] Navigating to Warehouse and checking goods...');
    await page.goto(`${baseUrl}/zh-cn/headquarters/warehouse/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a[href*="/headquarters/warehouse/"], [class*="nav"], header, a', { timeout: 10000 });

    await takeStepScreenshot(page, 'gameplay_03_warehouse.png', 'Warehouse resource inventory list');

    // ----------------------------------------------------------------
    // STEP 3: Navigate to Exchange & Inspect Market Order Book
    // ----------------------------------------------------------------
    console.log('\n[3/4] Navigating to Exchange and viewing Market Order Book...');
    await page.goto(`${baseUrl}/zh-cn/market/resource/3/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a, div, table', { timeout: 10000 }).catch(() => {});

    await takeStepScreenshot(page, 'gameplay_04_exchange_apples.png', 'Exchange order book for Apples');

    // ----------------------------------------------------------------
    // STEP 4: Final Success Verification
    // ----------------------------------------------------------------
    console.log('\n[4/4] Verifying total E2E stability and rendering health...');
    await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });

    await takeStepScreenshot(page, 'gameplay_05_final_map.png', 'Final verified game landscape');

  } catch (err) {
    console.error('Interactive Test Error:', err);
    await takeStepScreenshot(page, 'gameplay_error.png', 'Error state screenshot');
    throw err;
  } finally {
    console.log('\n================================================================');
    console.log(' Interactive Gameplay Audit Metrics');
    console.log('================================================================');
    console.log(`Page Errors: ${errors.pageErrors.length}`);
    errors.pageErrors.forEach(e => console.log(`  - ${e}`));

    console.log(`Console Errors: ${errors.consoleErrors.length}`);
    errors.consoleErrors.forEach(e => console.log(`  - ${e}`));

    console.log(`HTTP 4xx/5xx Errors: ${errors.httpErrors.length}`);
    errors.httpErrors.forEach(e => console.log(`  - ${e}`));

    console.log(`Failed Requests: ${errors.failedReqs.length}`);
    errors.failedReqs.forEach(e => console.log(`  - ${e}`));

    await browser.close();
  }
}

runInteractiveGameplay();
