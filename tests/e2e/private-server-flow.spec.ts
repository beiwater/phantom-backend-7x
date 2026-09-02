import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { attachDiagnostics, type DiagnosticsController } from './support/diagnostics.ts';

const test = base.extend<{ diagnostics: DiagnosticsController }>({
  diagnostics: async ({ page }, use, testInfo) => {
    const diagnostics = attachDiagnostics(page);
    try {
      await use(diagnostics);
    } finally {
      await diagnostics.write(testInfo);
    }
  },
});

const password = 'Password123!';

async function dismissCookieBanner(page: Page): Promise<void> {
  const acceptButton = page.getByRole('button', { name: '全部接受', exact: true });
  if (await acceptButton.isVisible().catch(() => false)) {
    await acceptButton.click();
  }
}

async function openTopMenu(page: Page): Promise<void> {
  const menuButton = page.locator('#main-menu-dropdown');
  await expect(menuButton).toBeVisible();
  await menuButton.click();
}

async function signOut(page: Page): Promise<void> {
  await openTopMenu(page);
  await page.getByText('登出', { exact: true }).click();
  await expect(page.getByText('你确定要登出游戏吗？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登出', exact: true }).last().click();
  await expect(page.getByText('登录', { exact: true }).first()).toBeVisible();
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/zh-cn/signin/');
  await dismissCookieBanner(page);

  const emailLoginButton = page.getByRole('button', { name: '使用邮箱地址', exact: true });
  if (await emailLoginButton.isVisible().catch(() => false)) {
    await emailLoginButton.click();
  }

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('input[type="password"]').press('Enter');
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
  await expect(page.getByText('$100,000', { exact: true })).toBeVisible();
}

async function completeCompanyCreation(page: Page, companyName: string): Promise<void> {
  await expect(page).toHaveURL(/\/zh-cn\/(?:create|landscape)\//);

  if (!/\/zh-cn\/create\//.test(page.url())) {
    return;
  }

  const nameInput = page.getByRole('textbox').first();
  await expect(nameInput).toBeVisible();
  await nameInput.fill(companyName);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
}

async function clickNavigation(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name, exact: true }).last().click();
}

async function openVisibleFarm(page: Page): Promise<void> {
  const farmLink = page.locator('a.test-building-P:visible').first();
  await expect(farmLink).toBeVisible();
  // The map can briefly contain a non-interactive animation layer after a
  // production job completes. Keyboard activation is a real user action and
  // targets the same visible anchor without bypassing the UI.
  await farmLink.focus();
  await farmLink.press('Enter');
  if (!/\/zh-cn\/b\/3\//.test(page.url())) {
    // Wait for the map's building label to finish its transition before
    // retrying the same visible anchor action.
    await page.waitForTimeout(500);
    await page.locator('a.test-building-P:visible').first().click();
  }
  await expect(page).toHaveURL(/\/zh-cn\/b\/3\//);
}

test('real player core loop keeps UI and persisted state coherent', async ({ page, diagnostics }, testInfo) => {
  const email = `dom_player_${Date.now()}@example.local`;

  await page.goto('/zh-cn/signup/');
  await dismissCookieBanner(page);
  await page.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeCompanyCreation(page, `CI ${Date.now()}`);
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
  await expect(page.getByText('$100,000', { exact: true })).toBeVisible();
  await expect(page.getByText('250', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('01-signup-landscape.png') });

  await signOut(page);
  await signIn(page, email);
  await page.screenshot({ path: testInfo.outputPath('02-login-landscape.png') });

  await openVisibleFarm(page);
  const firstProductionAmount = page.locator('input[name="amount"]').first();
  await expect(firstProductionAmount).toBeVisible();
  await firstProductionAmount.fill('1');
  await page.getByRole('button', { name: '生产', exact: true }).first().click();
  // The original UI renders an active job as a visible seconds countdown.
  await expect(page.locator('body')).toContainText(/\d+秒/);
  await page.screenshot({ path: testInfo.outputPath('03-production-started.png') });

  await page.waitForTimeout(6_500);
  await clickNavigation(page, '地图');
  await page.waitForTimeout(800);
  await openVisibleFarm(page);
  const collectButton = page.getByRole('button', { name: /收取|领取|获取/ });
  if (await collectButton.first().isVisible().catch(() => false)) {
    await collectButton.first().click();
  }
  await expect(page.locator('body')).toContainText('当前库存：10,001');
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.screenshot({ path: testInfo.outputPath('04-production-collected.png') });

  await clickNavigation(page, '仓库');
  await expect(page.getByText('种子', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('05-warehouse-after-production.png') });

  await page.goto('/zh-cn/market/resource/1/');
  await expect(page.locator('input[name="quantity"]')).toBeVisible();
  await page.locator('input[name="quantity"]').fill('1');
  await page.getByRole('button', { name: /购买/ }).first().click();
  await expect(page.getByText('$99,999', { exact: true })).toBeVisible();
  await expect(page.getByText(/你已购买 1 单位的 电力/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.screenshot({ path: testInfo.outputPath('06-market-purchase.png') });

  await page.reload();
  await expect(page.getByText('$99,999', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');

  await diagnostics.flush();
  expect(diagnostics.data.pageErrors).toEqual([]);
  expect(diagnostics.data.failedRequests.filter((request) => request.localApi)).toEqual([]);
  expect(diagnostics.data.apiResponses.some((response) => response.method === 'POST' && /\/buildings\/\d+\/busy\//.test(response.url))).toBe(true);
  expect(diagnostics.data.apiResponses.some((response) => response.method === 'POST' && response.url.includes('/market-order/take/'))).toBe(true);
});

test('player can explore encyclopedia, newspaper, and financial overview without errors', async ({ page, diagnostics }, testInfo) => {
  const email = `dom_explorer_${Date.now()}@example.local`;

  await page.goto('/zh-cn/signup/');
  await dismissCookieBanner(page);
  await page.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeCompanyCreation(page, `CI ${Date.now()}`);
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
  await expect(page.getByText('$100,000', { exact: true })).toBeVisible();

  // 1. Explore Encyclopedia
  await page.goto('/zh-cn/encyclopedia/0/');
  await expect(page.getByText('原材料加工业', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.screenshot({ path: testInfo.outputPath('07-encyclopedia-home.png') });

  await page.goto('/zh-cn/encyclopedia/0/resource/3/');
  await expect(page.getByText('苹果', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('08-encyclopedia-apples.png') });

  // 2. Explore Newspaper
  await page.goto('/zh-cn/newspaper/0/');
  await expect(page.getByText('市场全品类现货贸易与宏观经济展望', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('09-newspaper.png') });

  // 3. Explore Headquarters & Finances
  await page.goto('/zh-cn/headquarters/overview/');
  await expect(page.getByText('总览', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.screenshot({ path: testInfo.outputPath('10-hq-finances.png') });

  await diagnostics.flush();
  expect(diagnostics.data.pageErrors).toEqual([]);
  expect(diagnostics.data.failedRequests.filter((request) => request.localApi)).toEqual([]);
});
