import { chromium } from '@playwright/test';
import { findBrowserExecutable } from './find-browser.ts';

// Reproduces the server-clock consistency problem.
// The page observations use Playwright DOM locators. The debug endpoint is used
// only to trigger the repository's test-only time-warp mechanism; there is no
// direct database mutation in this script.
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const warpDays = Number(process.env.E2E_WARP_DAYS ?? 3);
const buildingPath = process.env.E2E_BUILDING_PATH ?? '/zh-cn/b/15/';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

if (!Number.isFinite(warpDays) || warpDays <= 0) {
  throw new Error('E2E_WARP_DAYS must be a positive number');
}

async function getClockState() {
  const response = await fetch(`${baseUrl}/api/v2/debug/state/`);
  if (!response.ok) throw new Error(`debug state failed: HTTP ${response.status}`);
  return response.json();
}

async function warpClock(days) {
  const response = await fetch(`${baseUrl}/api/v2/debug/time-warp/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days })
  });
  if (!response.ok) throw new Error(`time warp failed: HTTP ${response.status}`);
  return response.json();
}

async function signIn(page) {
  if (!email || !password) {
    console.log('E2E_EMAIL/E2E_PASSWORD not set; DOM snapshots will be anonymous.');
    return false;
  }
  await page.goto(`${baseUrl}/zh-cn/signin/`);
  const dialog = page.getByRole('dialog');
  const emailMode = dialog.getByRole('button', { name: '使用邮箱地址', exact: true });
  if (await emailMode.isVisible({ timeout: 1500 }).catch(() => false)) await emailMode.click();
  await dialog.getByRole('textbox').nth(0).fill(email);
  await dialog.getByRole('textbox').nth(1).fill(password);
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/zh-cn\/landscape\//, { timeout: 10000 }).catch(() => {});
  return /\/zh-cn\/landscape\//.test(page.url());
}

async function domSnapshot(page, path) {
  await page.goto(`${baseUrl}${path}`);
  await page.waitForTimeout(1200);
  const text = await page.locator('body').innerText();
  return {
    path,
    url: page.url(),
    buildingLinks: await page.locator('a[href*="/zh-cn/b/"]').count(),
    emptyLandButtons: await page.getByRole('button', { name: '地块', exact: true }).count(),
    hasErrorPage: /哎呀，出了点问题|An unexpected error occurred/i.test(text),
    hasLoadingState: /加载数据|加载任务|加载丰度|加载中/i.test(text),
    text: text.replace(/\s+/g, ' ').slice(0, 1200)
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findBrowserExecutable(),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  const authenticated = await signIn(page);
  const beforeClock = await getClockState();
  const beforeLandscape = await domSnapshot(page, '/zh-cn/landscape/');
  const beforeBuilding = await domSnapshot(page, buildingPath);
  const warpResult = await warpClock(warpDays);
  const afterLandscape = await domSnapshot(page, '/zh-cn/landscape/');
  const afterBuilding = await domSnapshot(page, buildingPath);
  const afterClock = await getClockState();

  console.log(JSON.stringify({
    beforeClock,
    warpResult,
    afterClock,
    beforeLandscape,
    afterLandscape,
    beforeBuilding,
    afterBuilding,
    authenticated,
    observations: {
      clockAdvanced: afterClock.virtualNowMs > beforeClock.virtualNowMs,
      landscapeStructureStable:
        beforeLandscape.buildingLinks === afterLandscape.buildingLinks &&
        beforeLandscape.emptyLandButtons === afterLandscape.emptyLandButtons,
      buildingPageReached: afterBuilding.url.endsWith(buildingPath),
      pageExposedError: afterLandscape.hasErrorPage || afterBuilding.hasErrorPage
    }
  }, null, 2));
} finally {
  await browser.close();
}
