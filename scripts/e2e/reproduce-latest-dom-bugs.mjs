import { chromium } from '@playwright/test';
import { findBrowserExecutable } from './find-browser.ts';

// DOM-only reproducer for the latest gameplay findings.
// It intentionally uses visible page navigation, locators, and clicks only;
// it does not use fetch, page.request, or direct database/API access.
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const launchpadId = process.env.E2E_LAUNCHPAD_ID ?? '12';
const expectWarpedExecutiveState = process.env.E2E_EXPECT_EXECUTIVE_TIME_WARP === '1';
const expectLevelOneLaunchpadFailure = process.env.E2E_EXPECT_LEVEL1_LAUNCHPAD_FAILURE === '1';
const results = [];

function record(name, observed, detail = '') {
  const result = { name, observed, detail };
  results.push(result);
  console.log(`${name}: ${JSON.stringify(result)}`);
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 });
}

async function dismissCookieBanner(page) {
  const banner = page.getByRole('button', { name: /全部接受|仅限必要/ }).first();
  if (await banner.isVisible({ timeout: 1500 }).catch(() => false)) await banner.click().catch(() => {});
}

async function signIn(page) {
  if (!email || !password) {
    console.log('Login-required tests skipped: set E2E_EMAIL and E2E_PASSWORD.');
    return false;
  }
  await page.goto(`${baseUrl}/zh-cn/signin/`);
  await dismissCookieBanner(page);
  const dialog = page.getByRole('dialog');
  const emailMode = dialog.getByRole('button', { name: '使用邮箱地址', exact: true });
  if (await emailMode.isVisible().catch(() => false)) await emailMode.click();
  await dialog.getByRole('textbox').nth(0).fill(email);
  await dialog.getByRole('textbox').nth(1).fill(password);
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/zh-cn\/landscape\//, { timeout: 10000 }).catch(() => {});
  return /\/zh-cn\/landscape\//.test(page.url());
}

async function reproduceGovernmentOrders(page) {
  await page.goto(`${baseUrl}/zh-cn/market/government-orders/0/`);
  await page.waitForTimeout(2500);
  const text = await bodyText(page);
  record('government-orders-loading', text.includes('加载订单'),
    'government orders page remains on the loading state');
}

async function reproduceCollectibles(page) {
  await page.goto(`${baseUrl}/zh-cn/market/collectibles/`);
  await page.waitForTimeout(2500);
  const text = await bodyText(page);
  record('collectibles-loading', text.includes('加载数据'),
    'collectibles exchange remains on the loading state');
}

async function reproduceWarehouseStats(page) {
  await page.goto(`${baseUrl}/zh-cn/headquarters/warehouse/stats/`);
  await page.waitForTimeout(2500);
  const text = await bodyText(page);
  record('warehouse-stats-loading', text.includes('交易所上的买单') && text.includes('加载数据'),
    'warehouse summary renders but the buy-order section never leaves loading');
}

async function reproduceExecutiveTimeWarp(page) {
  await page.goto(`${baseUrl}/zh-cn/headquarters/executives/`);
  await page.waitForTimeout(1200);
  const text = await bodyText(page);
  const handover = /正在交接工作|handover/i.test(text);
  const nan = /NaN/.test(text);
  record('executive-state', handover || nan,
    `handover=${handover}; nan=${nan}`);
  if (expectWarpedExecutiveState) {
    record('executive-time-warp', handover,
      'fixture was advanced by the debug time-warp before this run; handover is still active');
  }
}

async function reproduceLaunchpad(page) {
  await page.goto(`${baseUrl}/zh-cn/b/${launchpadId}/`);
  await page.waitForTimeout(1200);
  const text = await bodyText(page);
  const launchButton = page.getByRole('button', { name: '启动发射！', exact: true }).first();
  const hasRocket = /发射亚轨道火箭|Sub-Orbital Rocket/i.test(text);
  const duration = text.match(/发射时间：[^\n]+|Launch time:[^\n]+/i)?.[0] ?? '';
  record('launchpad-visible-action', hasRocket && await launchButton.isVisible().catch(() => false),
    `duration=${duration}`);
  if (expectLevelOneLaunchpadFailure) {
    await launchButton.click();
    await page.waitForTimeout(800);
    const afterClick = await bodyText(page);
    record('level1-launchpad-rejected', /queue duration limit|队列时长|超过.*队列/i.test(afterClick),
      'level-1 launchpad exposes the launch action but rejects it after the DOM click');
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findBrowserExecutable(),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  if (await signIn(page)) {
    await reproduceGovernmentOrders(page);
    await reproduceCollectibles(page);
    await reproduceWarehouseStats(page);
    await reproduceExecutiveTimeWarp(page);
    await reproduceLaunchpad(page);
  }
} finally {
  await browser.close();
}

console.log(`Latest DOM reproducer finished: ${results.filter(result => result.observed).length} observed / ${results.length} attempted`);
