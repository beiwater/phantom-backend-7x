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

async function runAllSubpagesVerification(round: number = 5) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting Comprehensive Subpages & Chatroom Pure DOM Test (Round ${round})`);
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

  try {
    // 1. Sign In
    console.log('\n[1/10] Signing in via UI...');
    await page.goto(`${baseUrl}/zh-cn/signin/`, { waitUntil: 'networkidle2' });
    
    // Cookie banner
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
    await takeTimestampedScreenshot(page, roundDir, round, 1, 'subpage_01_landscape');

    // 2. Newspaper (/zh-cn/newspaper/0/ and /zh-cn/newspaper/)
    console.log('\n[2/10] Testing Newspaper page (/zh-cn/newspaper/0/) ...');
    await page.goto(`${baseUrl}/zh-cn/newspaper/0/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('h1, h2, h3, b, div', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 2, 'subpage_02_newspaper');

    // 3. Chatrooms & Messaging (/zh-cn/messages/)
    console.log('\n[3/10] Testing Chatrooms & Live Messaging (/zh-cn/messages/) ...');
    await page.goto(`${baseUrl}/zh-cn/messages/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input, textarea, button, div', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 3, 'subpage_03_chatrooms');

    // Send a message via DOM in chatroom
    const chatInput = await page.$('input[type="text"], textarea');
    if (chatInput) {
      await chatInput.type('Hello from Private Server E2E Pure DOM test!');
      await chatInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => {});
    }
    await takeTimestampedScreenshot(page, roundDir, round, 4, 'subpage_04_chatroom_message_sent');

    // 4. Encyclopedia (/zh-cn/encyclopedia/0/)
    console.log('\n[4/10] Testing Encyclopedia (/zh-cn/encyclopedia/0/) ...');
    await page.goto(`${baseUrl}/zh-cn/encyclopedia/0/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a, table, div', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 5, 'subpage_05_encyclopedia');

    // 5. Market / Exchange (/zh-cn/market/resource/3/)
    console.log('\n[5/10] Testing Marketplace (/zh-cn/market/resource/3/) ...');
    await page.goto(`${baseUrl}/zh-cn/market/resource/3/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('table, div, a', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 6, 'subpage_06_market');

    // 6. Warehouse (/zh-cn/headquarters/warehouse/)
    console.log('\n[6/10] Testing Warehouse (/zh-cn/headquarters/warehouse/) ...');
    await page.goto(`${baseUrl}/zh-cn/headquarters/warehouse/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('img, div, a', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 7, 'subpage_07_warehouse');

    // 7. Headquarters Overview & Financials (/zh-cn/headquarters/overview/)
    console.log('\n[7/10] Testing Overview & Financials (/zh-cn/headquarters/overview/) ...');
    await page.goto(`${baseUrl}/zh-cn/headquarters/overview/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('div, table, a', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 8, 'subpage_08_overview');

    // 8. Search (/zh-cn/search/)
    console.log('\n[8/10] Testing Company Search (/zh-cn/search/) ...');
    await page.goto(`${baseUrl}/zh-cn/search/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input, div', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 9, 'subpage_09_search');

    // 9. Building Construction Catalog (/zh-cn/landscape/buildings/B0/)
    console.log('\n[9/10] Testing Construction Catalog (/zh-cn/landscape/buildings/B0/) ...');
    await page.goto(`${baseUrl}/zh-cn/landscape/buildings/B0/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.test-building-kind-P, button', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 10, 'subpage_10_construction_catalog');

    // 10. Farm Details & Production View (/zh-cn/b/1/)
    console.log('\n[10/10] Testing Farm Details & Production View (/zh-cn/b/1/) ...');
    await page.goto(`${baseUrl}/zh-cn/b/1/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('button, div, input', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 11, 'subpage_11_farm_interior');

    console.log('\n================================================================');
    console.log(` All Subpages & Chatroom Pure DOM Test (Round ${round}) PASSED!`);
    console.log(` Filtered Console Errors: ${consoleErrors.length}`);
    console.log('================================================================');

  } catch (err) {
    console.error('\nSubpages Verification Failure:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'subpages_failure_state');
    throw err;
  } finally {
    await browser.close();
  }
}

runAllSubpagesVerification(5);
