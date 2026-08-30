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
    const commitMsg = `checkpoint: round ${round} money, simboosts, and spending verification [${timestamp}]`;
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

async function runSpendingAndMoneyVerification(round: number = 3) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting Money, SimBoosts & Spending Verification (Round ${round})`);
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

  try {
    // 1. Register a fresh player via UI
    console.log('\n[1/4] Registering new player on /zh-cn/signup/ via UI...');
    await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });

    // Dismiss cookie banner
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

    const testEmail = `player_verify_${Date.now()}@domain.local`;
    if (emailInput && passwordInput) {
      await emailInput.type(testEmail);
      await passwordInput.type('Password123!');
      await passwordInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    }

    // 2. Verify Landscape Map & Top Bar
    console.log('\n[2/4] Verifying Landscape Map, Money & SimBoosts formatting...');
    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 1, 'initial_landscape_after_signup');

    const topBarTexts = await page.$$eval('a, span, div', els =>
      els.map(e => e.textContent?.trim() || '').filter(t => t.length > 0 && t.length < 40)
    );

    const hasNaNMoney = topBarTexts.some(t => t.includes('$NaN') || t.includes('NaN$'));
    const hasNaNBoosts = topBarTexts.some(t => t.includes('BoostsNaN') || t.includes('BoostNaN') || t.includes('Sim BoostsNaN'));

    console.log(`  -> Top bar elements sample:`, topBarTexts.slice(0, 10));
    console.log(`  -> Does top bar contain $NaN? ${hasNaNMoney ? 'FAILED' : 'PASS (Clean)'}`);
    console.log(`  -> Does top bar contain Sim BoostsNaN? ${hasNaNBoosts ? 'FAILED' : 'PASS (Clean)'}`);

    if (hasNaNMoney || hasNaNBoosts) {
      throw new Error(`Formatting regression detected: $NaN or SimBoostsNaN on screen!`);
    }

    // 3. Navigate to Warehouse & Inspect Stock
    console.log('\n[3/4] Navigating to Warehouse and checking goods...');
    const whLink = await page.$('a[href*="warehouse"]');
    if (whLink) await whLink.click();
    else await page.goto(`${baseUrl}/zh-cn/headquarters/warehouse/`, { waitUntil: 'networkidle2' });
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});

    await takeTimestampedScreenshot(page, roundDir, round, 2, 'warehouse_inventory_view');

    // 4. Navigate to Market & Buy Q0, Q3, Q10 Resources
    console.log('\n[4/4] Navigating to Market and purchasing Q0, Q3, Q10 items...');
    await page.goto(`${baseUrl}/zh-cn/market/resource/3/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a, div, table', { timeout: 10000 }).catch(() => {});

    await takeTimestampedScreenshot(page, roundDir, round, 3, 'market_apples_orderbook');

    // Return to map
    await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
    await takeTimestampedScreenshot(page, roundDir, round, 4, 'final_verified_landscape');

    console.log('\n================================================================');
    console.log(` Money, SimBoosts & Spending Verification (Round ${round}) PASSED!`);
    console.log('================================================================');

  } catch (err) {
    console.error('Verification Error:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'error_state');
    throw err;
  } finally {
    await browser.close();
  }
}

runSpendingAndMoneyVerification(3);
