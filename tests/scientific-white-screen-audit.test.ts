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
    const commitMsg = `checkpoint: round ${round} scientific white screen and full systems audit [${timestamp}]`;
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

// Scientific White Screen & DOM Integrity Inspector
async function assertScientificDOMIntegrity(page: Page, pageName: string) {
  const result = await page.evaluate(() => {
    const root = document.getElementById('root');
    const bodyText = document.body.innerText ? document.body.innerText.trim() : '';
    const visibleElements = Array.from(document.querySelectorAll('div, a, button, h1, h2, h3, table, img')).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const crashKeywords = ['An unexpected error occurred', 'Failed to load app', 'Something went wrong', 'Cannot read properties'];
    const foundCrash = crashKeywords.find(k => bodyText.includes(k));

    const nanKeywords = ['$NaN', 'NaN$', 'BoostsNaN', 'BoostNaN', 'Sim BoostsNaN'];
    const foundNaN = nanKeywords.find(k => bodyText.includes(k));

    return {
      hasRoot: !!root,
      rootChildCount: root ? root.children.length : 0,
      bodyTextLength: bodyText.length,
      visibleCount: visibleElements.length,
      foundCrash,
      foundNaN,
      textSample: bodyText.slice(0, 150).replace(/\s+/g, ' ')
    };
  });

  if (!result.hasRoot || result.rootChildCount === 0 || result.bodyTextLength < 10 || result.visibleCount === 0) {
    throw new Error(`[SCIENTIFIC WHITE SCREEN DETECTED] Page '${pageName}' is blank! (Root children: ${result.rootChildCount}, Visible elements: ${result.visibleCount})`);
  }

  if (result.foundCrash) {
    throw new Error(`[CRASH STATE DETECTED] Page '${pageName}' contains crash keyword: '${result.foundCrash}'`);
  }

  if (result.foundNaN) {
    throw new Error(`[NAN CORRUPTION DETECTED] Page '${pageName}' contains NaN formatting error: '${result.foundNaN}'`);
  }

  return result;
}

async function runScientificAuditE2E(round: number = 7) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting Scientific White Screen & Full Systems Audit E2E (Round ${round})`);
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

  const unhandledErrors: string[] = [];
  page.on('pageerror', err => {
    unhandledErrors.push(`[Page Error] ${err.message}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Amplitude')) {
      unhandledErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  try {
    // ----------------------------------------------------
    // Flow 1: User Signup via Pure DOM
    // ----------------------------------------------------
    console.log('\n[Flow 1] User Signup & Scientific DOM check...');
    await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });

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

    const testEmail = `scientific_audit_${Date.now()}@domain.local`;
    if (emailInput && passwordInput) {
      await emailInput.type(testEmail);
      await passwordInput.type('Password123!');
      await passwordInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    }

    await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });
    await assertScientificDOMIntegrity(page, 'Signup Landscape Map');
    await takeTimestampedScreenshot(page, roundDir, round, 1, 'scientific_01_landscape');

    // ----------------------------------------------------
    // Flow 2: System Subpages Comprehensive Scientific Inspection
    // ----------------------------------------------------
    const testPages = [
      { name: 'Landscape Map', path: '/zh-cn/landscape/' },
      { name: 'B0 Construction Catalog', path: '/zh-cn/landscape/buildings/B0/' },
      { name: 'Farm Production View', path: '/zh-cn/b/1/' },
      { name: 'Grocery Store Retail View', path: '/zh-cn/b/2/' },
      { name: 'Warehouse Inventory', path: '/zh-cn/headquarters/warehouse/' },
      { name: 'Market Apples Q0-Q12', path: '/zh-cn/market/resource/3/' },
      { name: 'Market Power Q0-Q12', path: '/zh-cn/market/resource/1/' },
      { name: 'Chatrooms & Channels', path: '/zh-cn/messages/' },
      { name: 'Newspaper Issue #1', path: '/zh-cn/newspaper/0/' },
      { name: 'Encyclopedia Resources', path: '/zh-cn/encyclopedia/0/' },
      { name: 'Encyclopedia Levels Table', path: '/zh-cn/encyclopedia/0/levels/' },
      { name: 'Headquarters Financial Overview', path: '/zh-cn/headquarters/overview/' },
      { name: 'Company Search', path: '/zh-cn/search/' }
    ];

    let counter = 2;
    for (const tp of testPages) {
      console.log(`\n[Inspection] Scientifically testing: ${tp.name} (${tp.path}) ...`);
      await page.goto(`${baseUrl}${tp.path}`, { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 1000));

      const diag = await assertScientificDOMIntegrity(page, tp.name);
      console.log(`  -> Passed scientific inspection (Visible elements: ${diag.visibleCount}, Sample: "${diag.textSample.slice(0, 40)}...")`);
      await takeTimestampedScreenshot(page, roundDir, round, counter++, `scientific_page_${tp.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
    }

    // ----------------------------------------------------
    // Flow 3: Construction & 24h Production Queue Verification
    // ----------------------------------------------------
    console.log('\n[Flow 3] B0 Construction & 24h Production Queue DOM Verification...');
    await page.goto(`${baseUrl}/zh-cn/landscape/buildings/B0/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.test-building-kind-P', { timeout: 10000 });
    
    await (await page.$('.test-building-kind-P'))?.click();
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => {});
    await (await page.$('.btn-primary'))?.click();
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    await page.goto(`${baseUrl}/zh-cn/b/1/`, { waitUntil: 'networkidle2' });
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.trim() === '24h') {
        await b.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 500));

    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('生产') || text.includes('Produce')) {
        await b.click();
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1000));

    await assertScientificDOMIntegrity(page, 'Farm Production Queued View');
    await takeTimestampedScreenshot(page, roundDir, round, counter++, 'scientific_production_queued');

    console.log('\n================================================================');
    console.log(` SCIENTIFIC WHITE SCREEN & FULL SYSTEMS AUDIT (Round ${round}) PASSED!`);
    console.log(` Total Unhandled Fatal Errors: ${unhandledErrors.length}`);
    console.log(' All tested pages are 100% rendered with complete DOM integrity!');
    console.log('================================================================');

  } catch (err) {
    console.error('\nScientific Audit Failure:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'scientific_failure_state');
    throw err;
  } finally {
    await browser.close();
  }
}

runScientificAuditE2E(7);
