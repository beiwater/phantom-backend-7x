import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { attachDiagnostics, type DiagnosticsController } from './support/diagnostics.ts';
import { constructThroughUi, produceAndBuyThroughUi, readEconomicState } from './support/economic-loop.ts';

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

test('real player core loop keeps UI and persisted state coherent', async ({ page, diagnostics }, testInfo) => {
  const suffix = Date.now();
  const email = `dom_player_${suffix}@example.local`;
  await page.goto('/zh-cn/signup/');
  await dismissCookieBanner(page);
  await page.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeCompanyCreation(page, `CI ${suffix}`);
  const registered = await readEconomicState(page);
  expect(registered.company.money).toBe(100_000);
  expect(registered.company.simBoosts).toBe(Number(process.env.INITIAL_SIMBOOSTS ?? 300));
  await signOut(page);
  await signIn(page, email);
  expect((await readEconomicState(page)).company).toEqual(registered.company);
  await constructThroughUi(page, testInfo);
  await produceAndBuyThroughUi(page, testInfo);
  await diagnostics.flush();
  expect(diagnostics.data.pageErrors).toEqual([]);
  expect(diagnostics.data.failedRequests.filter(request => request.localApi)).toEqual([]);
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

  // 1. Explore Encyclopedia and assert the actual API payloads used by the UI.
  const retailResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/') && response.url().includes('/resources-retail-info/') && response.status() === 200
  );
  await page.goto('/zh-cn/encyclopedia/0/');
  const retailResponse = await retailResponsePromise;
  const retailPayload = await retailResponse.json();
  expect(Array.isArray(retailPayload)).toBe(true);
  const appleRetail = retailPayload.find((entry: { dbLetter?: number }) => entry.dbLetter === 3);
  expect(appleRetail).toMatchObject({
    dbLetter: 3,
    averagePrice: expect.any(Number),
    saturation: expect.any(Number)
  });
  await expect(page.getByText('原材料加工业', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.screenshot({ path: testInfo.outputPath('07-encyclopedia-home.png') });

  await page.goto('/zh-cn/encyclopedia/0/resource/3/');
  await expect(page.getByText('苹果', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.reload();
  await expect(page.getByText('苹果', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
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
