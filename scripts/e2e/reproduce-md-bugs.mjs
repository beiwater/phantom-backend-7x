import { chromium } from '@playwright/test';
import { findBrowserExecutable } from './find-browser.ts';

// Read-only DOM reproducer for the bug inventory in
// bug-summary-executives-chat-launchpad-production-government.md.
// No message, contract, offer, purchase, or launch is submitted by default.
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const results = [];

function record(name, observed, detail) {
  const result = { name, observed, detail };
  results.push(result);
  console.log(`${name}: ${JSON.stringify(result)}`);
}

async function signIn(page) {
  if (!email || !password) return false;
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

async function visit(page, path) {
  await page.goto(`${baseUrl}${path}`);
  await page.waitForTimeout(1200);
  return page.locator('body').innerText();
}

async function testExecutives(page) {
  const text = await visit(page, '/zh-cn/headquarters/executives/');
  record('executives-nan', /NaN/.test(text), 'candidate and hired-executive cards must never expose NaN');
  const cards = page.locator('div.hover-effect');
  record('executives-card-present', await cards.count() > 0, `cardCount=${await cards.count()}`);
  record('executives-offer-precondition', /提出报价|报价/.test(text), 'offer flow is present for a candidate; mutation is intentionally not submitted');
}

async function testChat(page) {
  const text = await visit(page, '/zh-cn/messages/chatroom_Social/');
  const region = page.getByRole('region').first();
  const regionText = await region.innerText().catch(() => text);
  record('chat-rendered', regionText.length > 0, `text=${regionText.slice(0, 400)}`);
  record('chat-relative-time', /不到\s*1\s*分钟|大约\s*\d+\s*分钟|分钟前/.test(regionText), 'relative timestamps should be present and update from server timestamps');
  record('chat-order-visible', regionText.split(/\n+/).filter(Boolean).length >= 2, 'at least two DOM message lines are required to inspect ordering');
}

async function testLaunchpad(page) {
  const text = await visit(page, '/zh-cn/b/12/');
  record('launchpad-visible', /发射亚轨道火箭|发射BFR|发射 BFR|启动发射/.test(text), text.slice(0, 600));
  record('launchpad-research-mapping', /航空航天研究|Aerospace Research/.test(text), 'inspect the displayed requirement; launch is not submitted');
}

async function testProduction(page) {
  const text = await visit(page, process.env.E2E_PRODUCTION_PATH ?? '/zh-cn/b/15/');
  record('production-page', /生产|正在生产|当前库存/.test(text), text.slice(0, 600));
  record('production-duration-visible', /小时|完成时间|生产时间/.test(text), 'preview and post-submit duration must use the same authoritative calculation');
}

async function testGovernment(page) {
  const text = await visit(page, '/zh-cn/market/government-orders/0/');
  record('government-crash', /哎呀，出了点问题|An unexpected error occurred|agency/.test(text), text.slice(0, 700));
}

async function testCompanyMap(page) {
  const text = await visit(page, '/zh-cn/company/0/Academy-Level%2050%20Test%20Corp/');
  const buildingLinks = await page.locator('a[href*="/zh-cn/b/"]').count();
  record('company-map-rendered', /FARM|ACADEMY|GROCERY STORE|BANK|RANCH|SALES OFFICE/.test(text), `buildingLinks=${buildingLinks}`);
  record('company-map-slot-count', buildingLinks > 0, 'compare this DOM count with the authoritative unlocked-slot count');
}

async function testContractPage(page) {
  const text = await visit(page, '/zh-cn/headquarters/warehouse/%E7%94%B5%E5%8A%9B');
  const sendContract = page.getByRole('button', { name: '发送合同', exact: true }).first();
  record('contract-page-rendered', /电力|单位|库存/.test(text), text.slice(0, 500));
  record('contract-action-present', await sendContract.count() > 0, 'contract submission is intentionally not triggered by default');
}

async function testNewspaper(page) {
  const text = await visit(page, '/zh-cn/newspaper/0/4/');
  record('unpublished-newspaper-accessible', /Sim Companies时报|上期|下期/.test(text), `url=${page.url()}; text=${text.slice(0, 400)}`);
}

async function testTimeWarp(page) {
  const stateResponse = await fetch(`${baseUrl}/api/v2/debug/state/`);
  const state = stateResponse.ok ? await stateResponse.json() : { error: `HTTP ${stateResponse.status}` };
  const text = await visit(page, '/zh-cn/landscape/');
  const buildingLinks = await page.locator('a[href*="/zh-cn/b/"]').count();
  record('time-warp-state', Number(state.offsetHours) !== 0, JSON.stringify(state));
  record('landscape-dom-observation', buildingLinks >= 0, `buildingLinks=${buildingLinks}; mapText=${text.slice(0, 250)}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findBrowserExecutable(),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  const authenticated = await signIn(page);
  for (const test of [testExecutives, testChat, testLaunchpad, testProduction, testGovernment, testCompanyMap, testContractPage, testNewspaper, testTimeWarp]) {
    await test(page);
  }
  console.log(JSON.stringify({ authenticated, observed: results.filter(r => r.observed).length, attempted: results.length }, null, 2));
} finally {
  await browser.close();
}
