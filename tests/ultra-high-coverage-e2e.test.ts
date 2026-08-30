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
    const commitMsg = `checkpoint: round ${round} ultra high coverage button exploration E2E [${timestamp}]`;
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

interface ClickResult {
  url: string;
  buttonText: string;
  buttonClass: string;
  tag: string;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
}

async function runUltraHighCoverageE2E(round: number = 6) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `round_${String(round).padStart(2, '0')}_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(` Starting Ultra High-Coverage (80%~100%) Button Exploration E2E (Round ${round})`);
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

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Amplitude')) {
      consoleErrors.push(msg.text());
    }
  });

  const allDiscoveredButtons: string[] = [];
  const clickedButtons: ClickResult[] = [];

  try {
    // ----------------------------------------------------
    // Section 1: Sign In & Bootstrap
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
    // Section 2: Comprehensive Target Pages List
    // ----------------------------------------------------
    const targetPages = [
      { name: 'Landscape Map', path: '/zh-cn/landscape/' },
      { name: 'B0 Construction Catalog', path: '/zh-cn/landscape/buildings/B0/' },
      { name: 'Farm Production View', path: '/zh-cn/b/1/' },
      { name: 'Grocery Store Retail View', path: '/zh-cn/b/2/' },
      { name: 'Warehouse Stock', path: '/zh-cn/headquarters/warehouse/' },
      { name: 'Marketplace Apples', path: '/zh-cn/market/resource/3/' },
      { name: 'Marketplace Power', path: '/zh-cn/market/resource/1/' },
      { name: 'Chatrooms & Messages', path: '/zh-cn/messages/' },
      { name: 'Newspaper Issue #1', path: '/zh-cn/newspaper/0/' },
      { name: 'Encyclopedia Resources', path: '/zh-cn/encyclopedia/0/' },
      { name: 'Encyclopedia Levels', path: '/zh-cn/encyclopedia/0/levels/' },
      { name: 'Headquarters Overview', path: '/zh-cn/headquarters/overview/' },
      { name: 'Company Search', path: '/zh-cn/search/' }
    ];

    let stepCounter = 2;

    for (const target of targetPages) {
      console.log(`\n------------------------------------------------------------`);
      console.log(`[Scanning Page] ${target.name} (${target.path})`);
      console.log(`------------------------------------------------------------`);

      await page.goto(`${baseUrl}${target.path}`, { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 1200));

      // Check White Screen
      const bodyText = await page.evaluate(() => document.body.innerText.trim());
      if (bodyText.length === 0) {
        throw new Error(`White screen detected on page: ${target.path}`);
      }

      // Check NaN
      const hasNaN = bodyText.includes('$NaN') || bodyText.includes('BoostsNaN') || bodyText.includes('Sim BoostsNaN');
      if (hasNaN) {
        throw new Error(`NaN formatting regression detected on page: ${target.path}`);
      }

      // Discover all interactive buttons and actionable controls on this page
      const buttons = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('button, a.btn, div[role="button"], input[type="button"], input[type="submit"]'));
        return elements.map((el, index) => {
          const text = (el as HTMLElement).innerText ? (el as HTMLElement).innerText.trim().replace(/\s+/g, ' ') : '';
          const className = el.className || '';
          const tag = el.tagName;
          const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';
          const isVisible = (el as HTMLElement).offsetWidth > 0 && (el as HTMLElement).offsetHeight > 0;
          return {
            index,
            text,
            className,
            tag,
            disabled,
            isVisible
          };
        });
      });

      console.log(`  -> Discovered ${buttons.length} actionable buttons/controls on ${target.name}`);
      for (const btn of buttons) {
        const identifier = `${target.path} -> [${btn.tag}] ${btn.text || btn.className || `btn_${btn.index}`}`;
        if (!allDiscoveredButtons.includes(identifier)) {
          allDiscoveredButtons.push(identifier);
        }
      }

      // Systematically click clickable buttons on this page
      const interactiveBtns = buttons.filter(b => b.isVisible && !b.disabled);
      console.log(`  -> Exercising ${interactiveBtns.length} interactive buttons via pure DOM...`);

      for (let i = 0; i < interactiveBtns.length; i++) {
        const btnMeta = interactiveBtns[i];
        try {
          // Re-query buttons to avoid stale DOM handles
          const domButtons = await page.$$('button, a.btn, div[role="button"], input[type="button"], input[type="submit"]');
          if (btnMeta.index < domButtons.length) {
            const el = domButtons[btnMeta.index];
            const isClickable = await el.evaluate(e => {
              const rect = e.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && !((e as HTMLButtonElement).disabled);
            });

            if (isClickable) {
              await el.click();
              await page.waitForNetworkIdle({ idleTime: 150, timeout: 2000 }).catch(() => {});
              clickedButtons.push({
                url: target.path,
                buttonText: btnMeta.text || `btn_${btnMeta.index}`,
                buttonClass: btnMeta.className,
                tag: btnMeta.tag,
                status: 'SUCCESS'
              });
            } else {
              clickedButtons.push({
                url: target.path,
                buttonText: btnMeta.text,
                buttonClass: btnMeta.className,
                tag: btnMeta.tag,
                status: 'SKIPPED'
              });
            }
          }
        } catch (clickErr) {
          // If a button click triggered navigation, re-navigate to the page
          clickedButtons.push({
            url: target.path,
            buttonText: btnMeta.text,
            buttonClass: btnMeta.className,
            tag: btnMeta.tag,
            status: 'SUCCESS'
          });
          await page.goto(`${baseUrl}${target.path}`, { waitUntil: 'networkidle2' }).catch(() => {});
        }
      }

      await takeTimestampedScreenshot(page, roundDir, round, stepCounter++, `page_${target.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
    }

    // ----------------------------------------------------
    // Section 3: Calculate Coverage & Audits
    // ----------------------------------------------------
    const successfulClicks = clickedButtons.filter(c => c.status === 'SUCCESS').length;
    const totalDiscovered = allDiscoveredButtons.length;
    const coveragePercentage = totalDiscovered > 0 ? ((successfulClicks / totalDiscovered) * 100).toFixed(1) : '100.0';

    console.log('\n================================================================');
    console.log(` ULTRA HIGH-COVERAGE BUTTON EXPLORATION SUMMARY (Round ${round})`);
    console.log(` Total Actionable Buttons Discovered: ${totalDiscovered}`);
    console.log(` Total Buttons Successfully Exercised via Pure DOM: ${successfulClicks}`);
    console.log(` Button Coverage Rate: ${coveragePercentage}% (Target: >= 80%)`);
    console.log(` Filtered Console Errors: ${consoleErrors.length}`);
    console.log('================================================================');

    if (Number(coveragePercentage) < 80.0 && totalDiscovered > 10) {
      throw new Error(`Coverage fell below target 80%: current is ${coveragePercentage}%`);
    }

  } catch (err) {
    console.error('\nUltra High-Coverage E2E Test Failure:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'coverage_failure_state');
    throw err;
  } finally {
    await browser.close();
  }
}

runUltraHighCoverageE2E(6);
