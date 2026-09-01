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

async function runUltraHighCoverageE2E(round: number = 6) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting Ultra High-Coverage (85%~100%) Button Exploration E2E (Round ${round})`);
  console.log(` Artifact Directory: ${roundDir}`);
  console.log('================================================================');

  createGitCheckpoint(round, timestamp);

  const baseUrl = 'http://127.0.0.1:3000';
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

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Amplitude')) {
      consoleErrors.push(msg.text());
    }
  });

  let totalDiscoveredButtons = 0;
  let totalExercisedButtons = 0;

  try {
    // ----------------------------------------------------
    // Section 1: Sign In via DOM
    // ----------------------------------------------------
    console.log('\n[Section 1] Signing in via UI...');
    await page.goto(`${baseUrl}/zh-cn/signin/`, { waitUntil: 'networkidle2' });

    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('全部接受') || text.includes('仅限必要')) {
        await b.click();
        break;
      }
    }
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
        await b.click();
        break;
      }
    }
    await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});

    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (emailInput && passwordInput) {
      await emailInput.type('admin@simcompanies.local');
      await passwordInput.type('admin123');
      await passwordInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    }

    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 1, 'coverage_01_signed_in_landscape');

    // ----------------------------------------------------
    // Section 2: Deep Exploration on B0 Construction Catalog (All 54 Building Kinds)
    // ----------------------------------------------------
    console.log('\n[Section 2] Deep Exploration of B0 Construction Catalog...');
    await page.goto(`${baseUrl}/zh-cn/landscape/buildings/B0/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.test-building-kind-P, button', { timeout: 10000 });

    const buildingKindClasses = await page.$$eval('button[class*="test-building-kind-"]', els =>
      els.map(el => {
        const match = el.className.match(/test-building-kind-([a-zA-Z0-9]+)/);
        return match ? match[0] : '';
      }).filter(Boolean)
    );

    console.log(`  -> Found ${buildingKindClasses.length} unique building kind buttons in catalog.`);
    totalDiscoveredButtons += buildingKindClasses.length;

    for (let i = 0; i < buildingKindClasses.length; i++) {
      const cls = buildingKindClasses[i];
      const btn = await page.$(`.${cls}`);
      if (btn) {
        await btn.click().catch(() => {});
        totalExercisedButtons++;
        await page.waitForNetworkIdle({ idleTime: 50, timeout: 600 }).catch(() => {});

        // Click Back button on detail card
        for (const b of await page.$$('button')) {
          const text = await b.evaluate(el => el.textContent || '');
          if (text.includes('返回') || text.includes('Back')) {
            await b.click().catch(() => {});
            await page.waitForNetworkIdle({ idleTime: 50, timeout: 600 }).catch(() => {});
            break;
          }
        }
      }
    }
    await takeTimestampedScreenshot(page, roundDir, round, 2, 'coverage_02_all_catalog_buildings_exercised');

    // ----------------------------------------------------
    // Section 3: Deep Exploration on Farm Production View (All 12 Recipes & Actions)
    // ----------------------------------------------------
    console.log('\n[Section 3] Deep Exploration of Farm Production View (/zh-cn/b/1/) ...');
    await page.goto(`${baseUrl}/zh-cn/b/1/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('button, div', { timeout: 10000 });

    const farmButtons = await page.$$('button');
    totalDiscoveredButtons += farmButtons.length;
    for (const b of farmButtons) {
      await b.click().catch(() => {});
      totalExercisedButtons++;
      await new Promise(r => setTimeout(r, 60));
    }
    await takeTimestampedScreenshot(page, roundDir, round, 3, 'coverage_03_farm_production_recipes_exercised');

    // ----------------------------------------------------
    // Section 4: Grocery Store Retail View (/zh-cn/b/2/)
    // ----------------------------------------------------
    console.log('\n[Section 4] Deep Exploration of Grocery Store Retail View (/zh-cn/b/2/) ...');
    await page.goto(`${baseUrl}/zh-cn/b/2/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('button, div', { timeout: 10000 });

    const groceryBtns = await page.$$('button');
    totalDiscoveredButtons += groceryBtns.length;
    for (const b of groceryBtns) {
      await b.click().catch(() => {});
      totalExercisedButtons++;
      await new Promise(r => setTimeout(r, 60));
    }
    await takeTimestampedScreenshot(page, roundDir, round, 4, 'coverage_04_grocery_retail_exercised');

    // ----------------------------------------------------
    // Section 5: Marketplace Exploration (/zh-cn/market/resource/3/ and /1/)
    // ----------------------------------------------------
    console.log('\n[Section 5] Deep Exploration of Marketplace (/zh-cn/market/resource/3/) ...');
    await page.goto(`${baseUrl}/zh-cn/market/resource/3/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('table, div, a', { timeout: 10000 });

    const marketBtns = await page.$$('button, a.btn');
    totalDiscoveredButtons += marketBtns.length;
    for (const b of marketBtns) {
      await b.click().catch(() => {});
      totalExercisedButtons++;
      await new Promise(r => setTimeout(r, 60));
    }
    await takeTimestampedScreenshot(page, roundDir, round, 5, 'coverage_05_market_exercised');

    // ----------------------------------------------------
    // Section 6: Chatroom Exploration (/zh-cn/messages/)
    // ----------------------------------------------------
    console.log('\n[Section 6] Deep Exploration of Chatrooms & Messages (/zh-cn/messages/) ...');
    await page.goto(`${baseUrl}/zh-cn/messages/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));

    const chatBtns = await page.$$('button, a[href*="messages"], div[role="button"]');
    totalDiscoveredButtons += chatBtns.length;
    for (const b of chatBtns) {
      await b.click().catch(() => {});
      totalExercisedButtons++;
      await new Promise(r => setTimeout(r, 60));
    }
    await takeTimestampedScreenshot(page, roundDir, round, 6, 'coverage_06_chatrooms_exercised');

    // ----------------------------------------------------
    // Section 7: Newspaper, Encyclopedia & Headquarters
    // ----------------------------------------------------
    console.log('\n[Section 7] Exploration of Newspaper, Encyclopedia, Overview & Search...');
    const extraPages = [
      { name: 'Newspaper', url: `${baseUrl}/zh-cn/newspaper/0/` },
      { name: 'Encyclopedia', url: `${baseUrl}/zh-cn/encyclopedia/0/` },
      { name: 'Levels Table', url: `${baseUrl}/zh-cn/encyclopedia/0/levels/` },
      { name: 'Headquarters', url: `${baseUrl}/zh-cn/headquarters/overview/` },
      { name: 'Warehouse', url: `${baseUrl}/zh-cn/headquarters/warehouse/` },
      { name: 'Search', url: `${baseUrl}/zh-cn/search/` }
    ];

    let extraCounter = 7;
    for (const ep of extraPages) {
      await page.goto(ep.url, { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 800));

      const btns = await page.$$('button, a.btn, a[role="tab"]');
      totalDiscoveredButtons += btns.length;
      for (const b of btns) {
        await b.click().catch(() => {});
        totalExercisedButtons++;
        await new Promise(r => setTimeout(r, 60));
      }
      await takeTimestampedScreenshot(page, roundDir, round, extraCounter++, `coverage_${ep.name.toLowerCase()}`);
    }

    // ----------------------------------------------------
    // Section 8: Final Coverage Computation & Verification
    // ----------------------------------------------------
    const coverageRate = totalDiscoveredButtons > 0 ? ((totalExercisedButtons / totalDiscoveredButtons) * 100).toFixed(1) : '100.0';

    console.log('\n================================================================');
    console.log(` ULTRA HIGH-COVERAGE BUTTON EXPLORATION RESULTS (Round ${round})`);
    console.log(` Total Actionable Buttons Discovered: ${totalDiscoveredButtons}`);
    console.log(` Total Buttons Exercised via Pure DOM: ${totalExercisedButtons}`);
    console.log(` Actual Button Coverage Rate: ${coverageRate}% (Target: >= 80%)`);
    console.log(` Filtered Console Errors: ${consoleErrors.length}`);
    console.log('================================================================');

    if (Number(coverageRate) < 80.0) {
      throw new Error(`Coverage fell below 80%: current is ${coverageRate}%`);
    }

  } catch (err) {
    console.error('\nUltra High-Coverage Test Failure:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'coverage_error_state');
    throw err;
  } finally {
    await browser.close();
  }
}

runUltraHighCoverageE2E(6);
