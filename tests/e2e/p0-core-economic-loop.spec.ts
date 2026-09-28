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

test('fresh account completes and persists the core economic loop', async ({ page, diagnostics }, testInfo) => {
  const suffix = Date.now();
  await page.goto('/zh-cn/signup/');
  await dismissCookieBanner(page);
  await page.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  await page.locator('input[type="email"]').fill(`dom_core_${suffix}@example.local`);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeCompanyCreation(page, `Core ${suffix}`);
  const initial = await readEconomicState(page);
  expect(initial.company.money).toBe(100_000);
  expect(initial.company.simBoosts).toBe(Number(process.env.INITIAL_SIMBOOSTS ?? 300));
  await page.screenshot({ path: testInfo.outputPath('landscape.png') });
  await constructThroughUi(page, testInfo);
  await produceAndBuyThroughUi(page, testInfo);
  await diagnostics.flush();
  expect(diagnostics.data.pageErrors).toEqual([]);
  expect(diagnostics.data.failedRequests.filter(request => request.localApi)).toEqual([]);
});
