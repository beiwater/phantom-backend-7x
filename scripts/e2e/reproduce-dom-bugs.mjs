import { chromium } from '@playwright/test';
import { findBrowserExecutable } from './find-browser.ts';

// Browser/DOM-only reproducer for logged-in gameplay findings #134-#151.
// It deliberately uses page navigation and DOM locators; it does not use
// fetch, page.request, direct API calls, or DOM mutations.
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const restaurantId = process.env.E2E_RESTAURANT_ID ?? '17';
const groceryId = process.env.E2E_GROCERY_ID ?? '19';
const chatroomPath = '/zh-cn/messages/chatroom_[ZH]%20游戏-chatroom_[ZH]%20交易-chatroom_Social/';
const results = [];

function record(issue, observed, detail = '') {
  const item = { issue, observed, detail };
  results.push(item);
  console.log(`${issue}: ${JSON.stringify(item)}`);
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

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 });
}

async function reproduceAuctionLoading(page) {
  await page.goto(`${baseUrl}/zh-cn/market/building-auction/1/`);
  await page.waitForTimeout(2500);
  const text = await bodyText(page);
  record('#134/#140', text.includes('加载数据') && !/拍卖卡片|没有拍卖|空/.test(text), 'auction market remains in loading state');
}

async function reproduceAccountingNaN(page) {
  await page.goto(`${baseUrl}/zh-cn/headquarters/accounting/`);
  const text = await bodyText(page);
  record('#139', /NaN/.test(text), text.match(/[^\n]*NaN[^\n]*/g)?.slice(0, 6).join(' | '));
}

async function reproduceWarehouseStatsLoading(page) {
  await page.goto(`${baseUrl}/zh-cn/headquarters/warehouse/%E7%89%9B%E5%A5%B6/sell/`);
  const stats = page.getByRole('button', { name: '获取资源统计数据', exact: true });
  if (!(await stats.isVisible({ timeout: 3000 }).catch(() => false))) {
    record('#141', false, 'precondition missing: statistics button is not visible');
    return;
  }
  await stats.click();
  await page.waitForTimeout(1500);
  record('#141', (await bodyText(page)).includes('加载数据'), 'statistics view remains loading after button click');
}

async function reproduceRetailStatus(page) {
  await page.goto(`${baseUrl}/zh-cn/b/${groceryId}/`);
  if (!(await page.getByRole('heading', { name: '苹果', exact: true }).first().isVisible({ timeout: 3000 }).catch(() => false))) {
    record('#142', false, 'precondition missing: grocery store or apple row is unavailable');
    return;
  }
  await page.locator('input[name="quantity"]').first().fill('1');
  await page.locator('input[name="price"]').first().fill('3');
  const sell = page.getByRole('button', { name: '销售', exact: true }).first();
  if (!(await sell.isEnabled().catch(() => false))) {
    record('#142', false, 'precondition missing: apple stock/transport unit is unavailable');
    return;
  }
  await sell.click();
  await page.waitForURL(/\/zh-cn\/landscape\//, { timeout: 10000 }).catch(() => {});
  if (!/\/zh-cn\/landscape\//.test(page.url())) {
    record('#142', false, 'sales click did not navigate; inspect the current UI for a precondition error');
    return;
  }
  record('#142', /升级中/.test(await bodyText(page)), 'retail order is labelled as upgrading on the map');
  await page.goto(`${baseUrl}/zh-cn/b/${groceryId}/`);
  record('#142-ui', /升级到1级|建筑正在升级/.test(await bodyText(page)), 'building page reuses upgrade status during retail');
}

function rating(text) {
  return Number(text.match(/Restaurant 评级\s*([0-9]+(?:\.[0-9]+)?)/)?.[1] ?? NaN);
}

async function reproduceRestaurantClosePenalty(page) {
  await page.goto(`${baseUrl}/zh-cn/b/${restaurantId}/`);
  let stop = page.getByRole('button', { name: '当前周期结束后停止营业？', exact: true });
  if (!(await stop.isVisible({ timeout: 3000 }).catch(() => false))) {
    const reopen = page.getByRole('button', { name: '自动连续营业？', exact: true });
    if (await reopen.isVisible().catch(() => false)) await reopen.click();
  }
  stop = page.getByRole('button', { name: '当前周期结束后停止营业？', exact: true });
  if (!(await stop.isVisible({ timeout: 3000 }).catch(() => false))) {
    record('#143', false, 'precondition missing: restaurant is not in an open cycle');
    return;
  }
  const before = await bodyText(page);
  await stop.click();
  await page.getByRole('button', { name: '是的，关店' }).click();
  await page.getByText('后终止营业', { exact: false }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const afterClose = await bodyText(page);
  const reopen = page.getByRole('button', { name: '自动连续营业？', exact: true });
  await reopen.waitFor({ state: 'visible', timeout: 5000 });
  await reopen.click();
  await page.getByRole('button', { name: '当前周期结束后停止营业？', exact: true }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const afterReopen = await bodyText(page);
  record('#143', rating(afterReopen) > rating(afterClose), `before=${rating(before)}, afterClose=${rating(afterClose)}, afterReopen=${rating(afterReopen)}`);
}

async function reproduceRestaurantFirstRating(page) {
  if (process.env.E2E_FIRST_CYCLE !== '1') {
    record('#136', false, 'skipped: set E2E_FIRST_CYCLE=1 with a fresh restaurant fixture');
    return;
  }
  await page.goto(`${baseUrl}/zh-cn/b/${restaurantId}/`);
  const text = await bodyText(page);
  const currentRating = rating(text);
  const firstCycle = /正在统计客户反馈/.test(text) && !/历史|上一轮/.test(text);
  record('#136', firstCycle && currentRating > 0, `rating=${currentRating}; requires a fresh restaurant before first settlement`);
}

async function reproduceExecutivePage(page) {
  await page.goto(`${baseUrl}/zh-cn/headquarters/executives/`);
  const text = await bodyText(page);
  record('#135', /哎呀，出了点问题|reading ['"]?eyes/.test(text), 'requires an executive/candidate record in the fixture');
}

async function reproduceExecutiveOfferNaN(page) {
  await page.goto(`${baseUrl}/zh-cn/headquarters/executives/`);
  const text = await bodyText(page);
  const boardroom = /会议室|Boardroom/.test(text);
  const sentOffer = /聘书已发送|Offer extended|offer has been sent/i.test(text);
  const nanLines = text.match(/[^\n]*NaN[^\n]*/g) ?? [];
  record('#145', boardroom && sentOffer && nanLines.length > 0, nanLines.slice(0, 4).join(' | ') || 'no NaN found');
}

async function reproduceExecutiveSlot(page) {
  await page.goto(`${baseUrl}/zh-cn/headquarters/executives/`);
  const unlock = page.getByText('解锁职员空位', { exact: false }).first();
  if (!(await unlock.isVisible({ timeout: 3000 }).catch(() => false))) {
    record('#137/#138', false, 'precondition missing: staff-slot unlock control is unavailable');
    return;
  }
  await unlock.click();
  await page.getByRole('button', { name: '解锁', exact: true }).last().click();
  const immediate = await bodyText(page);
  const hasNaN = /Sim BoostsNaN/.test(immediate);
  await page.reload();
  const afterReload = await bodyText(page);
  const lost = !/空位|职员空位/.test(afterReload) || /花费\s*50/.test(afterReload);
  record('#137', hasNaN, 'SimBoosts becomes NaN after slot unlock');
  record('#138', lost, 'unlocked slot/cost is not retained after reload');
}

async function reproduceChatMessagePersistence(page) {
  await page.goto(`${baseUrl}${chatroomPath}`);
  const input = page.getByRole('textbox');
  if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) {
    record('#151', false, 'precondition missing: chat input is not visible');
    return;
  }

  const marker = `DOM CHAT PERSISTENCE ${Date.now()}`;
  await input.fill(marker);
  await input.press('Enter');
  await page.waitForTimeout(800);
  const immediatelyVisible = (await bodyText(page)).includes(marker);

  await page.reload();
  await page.waitForTimeout(900);
  const visibleAfterReload = (await bodyText(page)).includes(marker);
  record('#151', immediatelyVisible && !visibleAfterReload,
    `immediatelyVisible=${immediatelyVisible}; visibleAfterReload=${visibleAfterReload}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findBrowserExecutable(),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  if (await signIn(page)) {
    await reproduceAuctionLoading(page);
    await reproduceAccountingNaN(page);
    await reproduceWarehouseStatsLoading(page);
    await reproduceRetailStatus(page);
    await reproduceRestaurantClosePenalty(page);
    await reproduceRestaurantFirstRating(page);
    await reproduceExecutivePage(page);
    await reproduceExecutiveOfferNaN(page);
    await reproduceExecutiveSlot(page);
    await reproduceChatMessagePersistence(page);
  }
} finally {
  await browser.close();
}

console.log(`DOM reproducer finished: ${results.filter(x => x.observed).length} observed / ${results.length} attempted`);
