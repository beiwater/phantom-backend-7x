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

async function executeE2ERound(round: number) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting E2E Test Round ${round} [Timestamp: ${timestamp}]`);
  console.log(` Artifact Directory: ${roundDir}`);
  console.log('================================================================');

  // 1. Create Pre-test Git Checkpoint
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

  const audit = {
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    httpErrors: [] as string[]
  };

  page.on('pageerror', err => audit.pageErrors.push(err.toString()));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon.ico') && !text.includes('analytics') && !text.includes('homepage_trailer')) {
        audit.consoleErrors.push(text);
      }
    }
  });
  page.on('response', res => {
    if (res.status() >= 400) {
      const url = res.url();
      if (!url.includes('myreviews') && !url.includes('amplitude')) {
        audit.httpErrors.push(`[${res.status()}] ${res.request().method()} ${url}`);
      }
    }
  });

  try {
    // ----------------------------------------------------------------
    // Flow 1: Guest Landing Page
    // ----------------------------------------------------------------
    console.log('\n[Flow 1] Guest Landing Page (Unauthenticated)...');
    await page.goto(`${baseUrl}/zh-cn/`, { waitUntil: 'networkidle2' });
    await takeTimestampedScreenshot(page, roundDir, round, 1, 'guest_landing');

    // Dismiss cookie banner
    const cookieBtns = await page.$$('button');
    for (const b of cookieBtns) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('全部接受') || text.includes('仅限必要')) {
        await b.click();
        break;
      }
    }

    // ----------------------------------------------------------------
    // Flow 2: UI Registration of New Player
    // ----------------------------------------------------------------
    console.log('\n[Flow 2] New User UI Registration Flow...');
    const registerLink = await page.$('a[href*="/signup/"], a[href*="signup"]');
    if (registerLink) {
      await registerLink.click();
    } else {
      await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
    await takeTimestampedScreenshot(page, roundDir, round, 2, 'signup_page');

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

    const newEmail = `user_round${round}_${Date.now()}@test.local`;
    if (emailInput && passwordInput) {
      console.log(`  -> Typing email: ${newEmail}`);
      await emailInput.type(newEmail);
      await passwordInput.type('Password123!');
      await takeTimestampedScreenshot(page, roundDir, round, 3, 'signup_form_filled');

      console.log('  -> Submitting registration form via Enter key...');
      await passwordInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    }

    // ----------------------------------------------------------------
    // Flow 3: Main Map & Landscape View
    // ----------------------------------------------------------------
    console.log('\n[Flow 3] Main Company Map & Dashboard Verification...');
    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 4, 'company_landscape_map');

    const moneyText = await page.$$eval('a[href*="/headquarters/overview/"], [class*="money"]', els =>
      els.map(e => e.textContent?.trim()).filter(Boolean)
    );
    console.log('  -> Capital balance on map:', moneyText);

    // ----------------------------------------------------------------
    // Flow 4: Warehouse Stock & Inventory
    // ----------------------------------------------------------------
    console.log('\n[Flow 4] Warehouse Stock View...');
    const whLink = await page.$('a[href*="warehouse"]');
    if (whLink) {
      await whLink.click();
    } else {
      await page.goto(`${baseUrl}/zh-cn/headquarters/warehouse/`, { waitUntil: 'networkidle2' });
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
    await takeTimestampedScreenshot(page, roundDir, round, 5, 'warehouse_inventory');

    // ----------------------------------------------------------------
    // Flow 5: Exchange & Market
    // ----------------------------------------------------------------
    console.log('\n[Flow 5] Exchange & Market Ticker View...');
    const marketLink = await page.$('a[href*="market"]');
    if (marketLink) {
      await marketLink.click();
    } else {
      await page.goto(`${baseUrl}/zh-cn/market/resources/`, { waitUntil: 'networkidle2' });
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
    await takeTimestampedScreenshot(page, roundDir, round, 6, 'exchange_resources');

    // ----------------------------------------------------------------
    // Flow 6: Account Settings & Profile
    // ----------------------------------------------------------------
    console.log('\n[Flow 6] Account Settings Page...');
    await page.goto(`${baseUrl}/zh-cn/account-settings/`, { waitUntil: 'networkidle2' });
    await takeTimestampedScreenshot(page, roundDir, round, 7, 'account_settings');

    console.log('\n================================================================');
    console.log(` E2E Test Round ${round} Finished Successfully`);
    console.log('================================================================');

  } catch (err) {
    console.error('Round execution error:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'error_state');
    throw err;
  } finally {
    console.log('\n--- AUDIT METRICS ---');
    console.log(`Page Errors: ${audit.pageErrors.length}`);
    console.log(`Console Errors: ${audit.consoleErrors.length}`);
    console.log(`HTTP Errors: ${audit.httpErrors.length}`);
    await browser.close();
  }
}

// Run round 1
executeE2ERound(1);
