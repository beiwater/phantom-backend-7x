import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import {
  attachBrowserAudit,
  assertBusinessInvariants,
  waitForUiStable,
  waitForUiTransition,
} from './e2e/support/browser-audit.ts';

const SCREENSHOT_DIR = path.resolve('screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function clickVisibleLink(
  page: Page,
  selector: string,
  action: string,
  audit: ReturnType<typeof attachBrowserAudit>,
): Promise<void> {
  const link = await page.waitForSelector(selector, { visible: true, timeout: 5_000 });
  if (!link) throw new Error(`[UI_ACTION_FAILED] ${action}: visible link not found for ${selector}`);
  const before = await waitForUiStable(page, { action: `before ${action}` });
  audit.recordAction(action);
  await link.click();
  await waitForUiTransition(page, before, { action });
}

async function runE2E(): Promise<void> {
  console.log('====================================================');
  console.log(' Starting SimCompanies Strict Real-Browser E2E Suite');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const audit = attachBrowserAudit(page);
  let runFailed = false;

  try {
    const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

    console.log('\n[Step 1] Load Dashboard / Map');
    await page.goto(`${baseUrl}/zh-cn/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForUiStable(page, { action: 'load dashboard' });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_dashboard_map.png'), fullPage: true });
    const title = await page.title();
    console.log(`  -> Page title: "${title}"`);
    const bodyContent = await page.content();
    console.log(`  -> Rendered DOM HTML size: ${bodyContent.length} bytes`);
    await assertBusinessInvariants(page, { context: 'dashboard load' });

    console.log('\n[Step 2] Inspect Header & Navigation Bar');
    const links = await page.$$eval('a, button', elements =>
      elements.map(element => ({
        tag: element.tagName,
        text: element.textContent?.trim() || '',
        href: element.getAttribute('href') || '',
      })).filter(entry => entry.text.length > 0),
    );
    console.log(`  -> Found ${links.length} interactive links/buttons.`);
    links.slice(0, 15).forEach(link => console.log(`     - [${link.tag}] "${link.text}" -> ${link.href}`));

    console.log('\n[Step 3] Navigate to Warehouse');
    await clickVisibleLink(page, 'a[href*="warehouse"], a[href*="headquarters"]', 'open warehouse', audit);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_warehouse_page.png'), fullPage: true });

    console.log('\n[Step 4] Navigate to Exchange / Market');
    await clickVisibleLink(page, 'a[href*="market"], a[href*="exchange"]', 'open market', audit);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_market_page.png'), fullPage: true });

    console.log('\n[Step 5] Navigate back to Landscape');
    await clickVisibleLink(page, 'a[href*="landscape"]', 'return to landscape', audit);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_landscape_map.png'), fullPage: true });

    console.log('\n[Step 6] Open a visible building control');
    const buildingSlot = await page.waitForSelector(
      '[class*="building"], [class*="slot"], [class*="land-"]',
      { visible: true, timeout: 5_000 },
    );
    if (!buildingSlot) throw new Error('[UI_ACTION_FAILED] Open building: no visible building slot was found');
    const beforeBuilding = await waitForUiStable(page, { action: 'before opening building' });
    audit.recordAction('open visible building slot');
    await buildingSlot.click();
    await waitForUiTransition(page, beforeBuilding, { action: 'open visible building slot' });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_building_modal.png'), fullPage: true });
  } catch (error) {
    runFailed = true;
    process.exitCode = 1;
    console.error('\n[TEST ERROR]:', error);
    throw error;
  } finally {
    if (runFailed || audit.errors.length > 0) {
      await audit.writeFailureArtifacts(SCREENSHOT_DIR, `e2e-suite-${Date.now()}`);
    }
    await browser.close();
    if (!runFailed) audit.assertClean('e2e-suite.ts');
  }
}

void runE2E().catch((error: unknown) => {
  console.error('[E2E_SUITE_FAILED]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
