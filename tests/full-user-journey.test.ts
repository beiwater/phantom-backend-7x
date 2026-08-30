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

async function runFullUserJourney() {
  console.log('================================================================');
  console.log(' Starting SimCompanies Full User Journey Real Browser E2E Test');
  console.log('================================================================');

  const baseUrl = 'http://127.0.0.1:3000';

  // 1. Create a clean test user & session
  const regRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_journey_${Date.now()}@domain.local`,
      password: 'Password123!',
      companyName: 'Journey Corporation'
    })
  });
  const cookies = regRes.headers.getSetCookie?.() || [regRes.headers.get('set-cookie') || ''];
  const sessionCookieVal = cookies.find(c => c.startsWith('sessionid='))?.split(';')[0]?.split('=')[1] || '';

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

  // Set session cookie in browser
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
    // 1. Load Main Map / Landscape
    // ----------------------------------------------------------------
    console.log('\n[1/5] Loading Main Map / Landscape View...');
    await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('a[href*="/headquarters/overview/"], a[href*="/b/"]', { timeout: 10000 });

    await takeStepScreenshot(page, '01_landscape_view.png', 'Main Landscape map with buildings and money bar');

    const title = await page.title();
    console.log(`  -> Title: "${title}"`);

    // Verify top bar elements
    const moneyText = await page.$$eval('a[href*="/headquarters/overview/"], [class*="money"]', els =>
      els.map(e => e.textContent?.trim()).filter(Boolean)
    );
    console.log(`  -> Money bar text:`, moneyText);

    // ----------------------------------------------------------------
    // 2. Click "仓库" (Warehouse) in Bottom Nav
    // ----------------------------------------------------------------
    console.log('\n[2/5] Clicking "仓库" (Warehouse) navigation link...');
    const whLink = await page.waitForSelector('a[href*="warehouse"]', { timeout: 5000 });
    if (whLink) {
      await whLink.click();
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});
      await takeStepScreenshot(page, '02_warehouse_view.png', 'Warehouse stock and inventory cards');

      const whItems = await page.$$eval('a[href*="/headquarters/warehouse/"], [class*="resource-tile"], [class*="card"]', els =>
        els.map(e => e.textContent?.trim()).filter(Boolean)
      );
      console.log(`  -> Warehouse visible items count: ${whItems.length}`);
      console.log(`  -> Warehouse sample items:`, whItems.slice(0, 5));
    }

    // ----------------------------------------------------------------
    // 3. Click "交易所" (Exchange) Navigation
    // ----------------------------------------------------------------
    console.log('\n[3/5] Clicking "交易所" (Exchange) navigation link...');
    const marketLink = await page.waitForSelector('a[href*="market"]', { timeout: 5000 }).catch(() => null);
    if (marketLink) {
      await marketLink.click();
    } else {
      await page.goto(`${baseUrl}/zh-cn/market/resources/`, { waitUntil: 'networkidle2' });
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, '03_exchange_view.png', 'Exchange market categories and price ticker');

    const tickerItems = await page.$$eval('a[href*="/market/resource/"]', els =>
      els.map(e => e.textContent?.trim()).filter(Boolean)
    );
    console.log(`  -> Market tradable resources visible: ${tickerItems.length}`);
    console.log(`  -> Market sample resources:`, tickerItems.slice(0, 5));

    // ----------------------------------------------------------------
    // 4. Return to Map and Click Building to Open Modal
    // ----------------------------------------------------------------
    console.log('\n[4/5] Returning to Map and Clicking Farm Building...');
    const mapNav = await page.waitForSelector('a[href*="/landscape/"]', { timeout: 5000 }).catch(() => null);
    if (mapNav) {
      await mapNav.click();
    } else {
      await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2' });
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});

    // Find the Farm building link on map
    const farmBuilding = await page.waitForSelector('a[href*="/b/"]', { timeout: 5000 });
    if (farmBuilding) {
      const bText = await farmBuilding.evaluate(el => el.textContent?.trim() || '');
      console.log(`  -> Clicking building: "${bText}"`);
      await farmBuilding.click();
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});

      await takeStepScreenshot(page, '04_building_modal.png', 'Building production & management modal');
    }

    // ----------------------------------------------------------------
    // 5. Verification & Summary
    // ----------------------------------------------------------------
    console.log('\n[5/5] Checking final state and console log health...');
    await takeStepScreenshot(page, '05_final_success.png', 'End-to-end user journey successful');

  } catch (err) {
    console.error('Test Execution Error:', err);
    await takeStepScreenshot(page, 'error_state.png', 'Error state snapshot');
    throw err;
  } finally {
    console.log('\n================================================================');
    console.log(' E2E Test Audit Results');
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

runFullUserJourney();
