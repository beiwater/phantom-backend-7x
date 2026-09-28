import puppeteer, { type Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  attachBrowserAudit,
  waitForUiStable,
  waitForUiTransition,
} from './e2e/support/browser-audit.ts';

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

async function clickVisibleLink(page: Page, selector: string, action: string, audit: ReturnType<typeof attachBrowserAudit>): Promise<void> {
  const link = await page.waitForSelector(selector, { visible: true, timeout: 10_000 });
  if (!link) throw new Error(`[UI_ACTION_FAILED] ${action}: visible link not found for ${selector}`);
  const before = await waitForUiStable(page, { action: `before ${action}` });
  audit.recordAction(action);
  await link.click();
  await waitForUiTransition(page, before, { action });
}

async function clickButtonContaining(page: Page, textFragments: string[], audit: ReturnType<typeof attachBrowserAudit>, action: string): Promise<boolean> {
  for (const button of await page.$$('button')) {
    const details = await button.evaluate(element => ({
      text: element.textContent?.trim() ?? '',
      visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
      disabled: (element as HTMLButtonElement).disabled,
    }));
    if (!details.visible || details.disabled || !textFragments.some(fragment => details.text.includes(fragment))) continue;
    const before = await waitForUiStable(page, { action: `before ${action}` });
    audit.recordAction(action);
    await button.click();
    await waitForUiTransition(page, before, { action });
    return true;
  }
  return false;
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

  const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const audit = attachBrowserAudit(page);
  let runFailed = false;

  try {
    // ----------------------------------------------------------------
    // Flow 1: Guest Landing Page
    // ----------------------------------------------------------------
    console.log('\n[Flow 1] Guest Landing Page (Unauthenticated)...');
    await page.goto(`${baseUrl}/zh-cn/`, { waitUntil: 'domcontentloaded' });
    await waitForUiStable(page, { action: 'load guest landing page' });
    await takeTimestampedScreenshot(page, roundDir, round, 1, 'guest_landing');

    // Dismiss cookie banner
    await clickButtonContaining(page, ['全部接受', '仅限必要'], audit, 'dismiss cookie banner');

    // ----------------------------------------------------------------
    // Flow 2: UI Registration of New Player
    // ----------------------------------------------------------------
    console.log('\n[Flow 2] New User UI Registration Flow...');
    await clickVisibleLink(page, 'a[href*="/signup/"], a[href*="signup"]', 'open signup page', audit);
    await takeTimestampedScreenshot(page, roundDir, round, 2, 'signup_page');

    // Click "使用邮箱地址"
    const emailSignupVisible = await clickButtonContaining(page, ['使用邮箱地址', '邮箱'], audit, 'choose email registration');
    if (emailSignupVisible) {
      await page.waitForSelector('input[type="email"], input[name="email"]', { visible: true, timeout: 10_000 });
    }

    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    const newEmail = `user_round${round}_${Date.now()}@test.local`;
    if (!emailInput || !passwordInput) throw new Error('Signup form did not expose the email and password fields');
    console.log(`  -> Typing email: ${newEmail}`);
    await emailInput.type(newEmail);
    await passwordInput.type('Password123!');
    await takeTimestampedScreenshot(page, roundDir, round, 3, 'signup_form_filled');

    console.log('  -> Submitting registration form via Enter key...');
    const beforeRegistration = await waitForUiStable(page, { action: 'before account registration' });
    audit.recordAction('submit account registration');
    await passwordInput.press('Enter');
    await waitForUiTransition(page, beforeRegistration, { action: 'submit account registration', timeoutMs: 20_000 });

    // ----------------------------------------------------------------
    // Flow 3: Main Map & Landscape View
    // ----------------------------------------------------------------
    console.log('\n[Flow 3] Main Company Map & Dashboard Verification...');
    await page.waitForSelector('a[href*="/b/"], a[href*="landscape"]', { visible: true, timeout: 20_000 });
    await takeTimestampedScreenshot(page, roundDir, round, 4, 'company_landscape_map');

    const moneyText = await page.$$eval('a[href*="/headquarters/overview/"], [class*="money"]', els =>
      els.map(e => e.textContent?.trim()).filter(Boolean)
    );
    console.log('  -> Capital balance on map:', moneyText);

    // ----------------------------------------------------------------
    // Flow 4: Warehouse Stock & Inventory
    // ----------------------------------------------------------------
    console.log('\n[Flow 4] Warehouse Stock View...');
    await clickVisibleLink(page, 'a[href*="warehouse"]', 'open warehouse', audit);
    await takeTimestampedScreenshot(page, roundDir, round, 5, 'warehouse_inventory');

    // ----------------------------------------------------------------
    // Flow 5: Exchange & Market
    // ----------------------------------------------------------------
    console.log('\n[Flow 5] Exchange & Market Ticker View...');
    await clickVisibleLink(page, 'a[href*="market"]', 'open market', audit);
    await takeTimestampedScreenshot(page, roundDir, round, 6, 'exchange_resources');

    // ----------------------------------------------------------------
    // Flow 6: Account Settings & Profile
    // ----------------------------------------------------------------
    console.log('\n[Flow 6] Account Settings Page...');
    await clickVisibleLink(page, 'a[href*="account-settings"]', 'open account settings', audit);
    await takeTimestampedScreenshot(page, roundDir, round, 7, 'account_settings');

    console.log('\n================================================================');
    console.log(` E2E Test Round ${round} Finished Successfully`);
    console.log('================================================================');

  } catch (err) {
    runFailed = true;
    process.exitCode = 1;
    console.error('Round execution error:', err);
    await takeTimestampedScreenshot(page, roundDir, round, 99, 'error_state');
    throw err;
  } finally {
    console.log('\n--- AUDIT METRICS ---');
    const summary = audit.getSummary();
    console.log(`Page Errors: ${summary.pageErrors}`);
    console.log(`Console Errors: ${summary.consoleErrors}`);
    console.log(`Request Failures: ${summary.requestFailures}`);
    console.log(`HTTP/API Errors: ${summary.httpFailures}`);
    if (runFailed || summary.totalErrors > 0) {
      await audit.writeFailureArtifacts(roundDir, 'browser-audit-failure');
    }
    await browser.close();
    if (!runFailed) audit.assertClean(`run-e2e-with-checkpoints.ts round ${round}`);
  }
}

// Run round 1
void executeE2ERound(1).catch((error: unknown) => {
  console.error('[E2E_ROUND_FAILED]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
