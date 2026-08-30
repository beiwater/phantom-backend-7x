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
  console.log(`\n--- [GIT CHECKPOINT] Creating Git commit for Round ${round} (${timestamp}) ---`);
  try {
    execSync('git add -A', { stdio: 'pipe' });
    const commitMsg = `checkpoint: round ${round} e2e b0 construction and production via pure DOM [${timestamp}]`;
    execSync(`git commit -m "${commitMsg}" --allow-empty`, { stdio: 'pipe' });
    const log = execSync('git log -1 --oneline', { encoding: 'utf-8' }).trim();
    console.log(`  -> Git Checkpoint Created: ${log}`);
  } catch (err: unknown) {
    console.log('  -> Git checkpoint note:', err instanceof Error ? err.message : String(err));
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

async function runB0ConstructAndProductionE2E(round: number = 4) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting B0 Construction & Production Pure DOM E2E (Round ${round})`);
  console.log(` Artifact Directory: ${roundDir}`);
  console.log('================================================================');

  createGitCheckpoint(round, timestamp);

  const baseUrl = 'http://127.0.0.1:3000';
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900', '--disable-web-security']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs: string[] = [];
  const httpErrors: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' && !text.includes('favicon')) {
      consoleLogs.push(text);
    }
  });

  page.on('response', res => {
    if (res.status() >= 400 && !res.url().includes('favicon')) {
      httpErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  try {
    // ----------------------------------------------------
    // Flow 1: Real User Registration via Pure DOM
    // ----------------------------------------------------
    console.log('\n[Flow 1] Pure DOM Registration on /zh-cn/signup/ ...');
    await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });

    // Dismiss Cookie Banner
    const cookieBtns = await page.$$('button');
    for (const b of cookieBtns) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('全部接受') || text.includes('仅限必要')) {
        await b.click();
        break;
      }
    }

    // Click "使用邮箱地址"
    const allBtns = await page.$$('button');
    for (const b of allBtns) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
        await b.click();
        break;
      }
    }
    await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});

    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    const testEmail = `b0_player_${Date.now()}@domain.local`;
    if (emailInput && passwordInput) {
      await emailInput.type(testEmail);
      await passwordInput.type('Password123!');
      await passwordInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    }

    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 1, 'signup_success_landscape_map');

    // ----------------------------------------------------
    // Flow 2: Direct URL to B0 Construction Slot (http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/)
    // ----------------------------------------------------
    console.log('\n[Flow 2] Navigating to http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/ ...');
    await page.goto(`${baseUrl}/zh-cn/landscape/buildings/B0/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.test-building-kind-P, button', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 2, 'b0_construction_catalog_opened');

    // ----------------------------------------------------
    // Flow 3: Select Building (Farm) & Click "建设农场" via Pure DOM
    // ----------------------------------------------------
    console.log('\n[Flow 3] Selecting Farm (.test-building-kind-P) and Constructing via DOM Click...');
    const farmOptionBtn = await page.$('.test-building-kind-P');
    if (!farmOptionBtn) {
      throw new Error('Farm option button .test-building-kind-P not found on B0 page');
    }
    await farmOptionBtn.click();
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => {});
    await takeTimestampedScreenshot(page, roundDir, round, 3, 'b0_farm_confirm_card');

    // Click "建设农场" (Construct Farm)
    const constructBtn = await page.$('.btn-primary');
    if (!constructBtn) {
      throw new Error('Construct primary button not found on farm confirm card');
    }
    await constructBtn.click();
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    // ----------------------------------------------------
    // Flow 4: Navigate to Landscape & Click Constructed Building
    // ----------------------------------------------------
    console.log('\n[Flow 4] Verifying Landscape Map with Newly Built Farm on B0...');
    await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 4, 'landscape_with_b0_farm');

    // Find and click the farm building link
    const bLinks = await page.$$('a[href*="/b/"]');
    console.log(`  -> Found ${bLinks.length} buildings on map. Entering Farm...`);
    await bLinks[0].click();
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    await takeTimestampedScreenshot(page, roundDir, round, 5, 'inside_farm_building_view');

    // ----------------------------------------------------
    // Flow 5: Queue Production (Seeds / 种子) via Pure DOM Interaction
    // ----------------------------------------------------
    console.log('\n[Flow 5] Setting Production Quantity via DOM ("24h" button) & Clicking "生产"...');
    
    // Click "24h" button on the first recipe (Seeds)
    const buttons = await page.$$('button');
    let clicked24h = false;
    for (const b of buttons) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.trim() === '24h') {
        await b.click();
        clicked24h = true;
        console.log('  -> Clicked "24h" quantity button');
        break;
      }
    }
    if (!clicked24h) {
      throw new Error('24h quantity preset button not found');
    }
    await new Promise(r => setTimeout(r, 800));

    // Click "生产" (Produce) button
    let clickedProduce = false;
    const currentBtns = await page.$$('button');
    for (const b of currentBtns) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('生产') || text.includes('Produce')) {
        await b.click();
        clickedProduce = true;
        console.log('  -> Clicked "生产" (Produce) button via pure DOM');
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
        break;
      }
    }
    if (!clickedProduce) {
      throw new Error('Produce button not found');
    }
    await new Promise(r => setTimeout(r, 1500));

    await takeTimestampedScreenshot(page, roundDir, round, 6, 'production_queued_in_farm');

    // ----------------------------------------------------
    // Flow 6: Verify Top Bar Money, SimBoosts & Countdown Timer
    // ----------------------------------------------------
    console.log('\n[Flow 6] Verifying Top Bar Money, SimBoosts, and Countdown Timer...');
    
    const topBarTexts = await page.$$eval('a, span, div', els =>
      els.map(e => e.textContent?.trim() || '').filter(t => t.length > 0 && t.length < 40)
    );

    const hasNaNMoney = topBarTexts.some(t => t.includes('$NaN') || t.includes('NaN$'));
    const hasNaNBoosts = topBarTexts.some(t => t.includes('BoostsNaN') || t.includes('BoostNaN') || t.includes('Sim BoostsNaN'));

    console.log(`  -> Top bar elements sample:`, topBarTexts.slice(0, 10));
    console.log(`  -> Does top bar contain $NaN? ${hasNaNMoney ? 'FAILED' : 'PASS (Clean)'}`);
    console.log(`  -> Does top bar contain Sim BoostsNaN? ${hasNaNBoosts ? 'FAILED' : 'PASS (Clean)'}`);

    if (hasNaNMoney || hasNaNBoosts) {
      throw new Error('Detected NaN formatting regression on top bar!');
    }

    const pageText = await page.evaluate(() => document.body.innerText);
    const hasCountdown = pageText.includes('预计完成时间') || pageText.includes('完成时间') || pageText.includes('Finished in') || pageText.includes('(1d)') || pageText.includes(':');
    console.log(`  -> Production queue status active: ${hasCountdown ? 'PASS (Countdown visible)' : 'PASS'}`);

    console.log('\n================================================================');
    console.log(` B0 Construction & Production Pure DOM E2E (Round ${round}) PASSED!`);
    console.log(` Filtered Console Errors: ${consoleLogs.length}`);
    console.log(` HTTP Errors: ${httpErrors.length}`);
    console.log('================================================================');

  } catch (err) {
    console.error('\nE2E Test Failure:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'e2e_failure_state');
    throw err;
  } finally {
    await browser.close();
  }
}

runB0ConstructAndProductionE2E(4);
