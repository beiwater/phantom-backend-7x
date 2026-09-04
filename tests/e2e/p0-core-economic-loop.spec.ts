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
  const buildingUrl = /\/zh-cn\/b\/\d+\/?/;
  const isFarmDetail = async (): Promise<boolean> => {
    if (!buildingUrl.test(page.url())) return false;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return bodyText.includes('农场') || bodyText.toLowerCase().includes('farm');
  };

  if (await isFarmDetail()) {
    return;
  }

  const farmLink = page.locator('a[href*="/b/1/"]:visible, a.test-building-P:visible').first();
  if (await farmLink.isVisible().catch(() => false)) {
    await farmLink.click();
  } else {
    await page.goto('/zh-cn/b/1/');
  }
  await expect.poll(isFarmDetail).toBe(true);
}

test('fresh account completes and persists the core economic loop', async ({ page, diagnostics }, testInfo) => {
  const suffix = Date.now();
  const email = `dom_core_${suffix}@example.local`;

  await page.goto('/zh-cn/signup/');
  await dismissCookieBanner(page);
  await page.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();

  await completeCompanyCreation(page, `Core ${suffix}`);
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
  await expect(page.getByText('$100,000', { exact: true })).toBeVisible();
  await expect(page.getByText('250', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('01-landscape.png') });

  await openVisibleFarm(page);
  const productionAmount = page.locator('input[name="amount"]').first();
  await expect(productionAmount).toBeVisible();
  await productionAmount.fill('1');
  const productionResponse = page.waitForResponse(response => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === 'POST'
      && /^\/api\/v1\/(?:busy|buildings\/\d+\/busy)\/?$/.test(pathname);
  });
  await page.getByRole('button', { name: '生产', exact: true }).first().click();
  const response = await productionResponse;
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    duration?: number;
    queueItem?: { duration?: number };
  };
  expect(payload.duration).toBeGreaterThan(0);
  expect(payload.queueItem?.duration).toBe(payload.duration);

  await page.waitForTimeout(6_500);
  await clickNavigation(page, '地图');
  await page.waitForTimeout(800);
  await openVisibleFarm(page);
  await page.reload();
  await expect(page).toHaveURL(/\/zh-cn\/b\/\d+\/?/);
  await expect(page.locator('body')).toContainText('当前库存：10,001');
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.screenshot({ path: testInfo.outputPath('02-production-collected.png') });

  await clickNavigation(page, '仓库');
  await expect(page.getByText('种子', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('03-warehouse-after-production.png') });

  await page.goto('/zh-cn/market/resource/1/');
  await expect(page.locator('input[name="quantity"]')).toBeVisible();
  await page.locator('input[name="quantity"]').fill('1');
  await page.getByRole('button', { name: /购买/ }).first().click();
  await expect(page.getByText('$99,999', { exact: true })).toBeVisible();
  await expect(page.getByText(/你已购买 1 单位的 电力/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.screenshot({ path: testInfo.outputPath('04-market-purchase.png') });

  await page.reload();
  await expect(page.getByText('$99,999', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await clickNavigation(page, '仓库');
  await expect(page.getByText('种子', { exact: true })).toBeVisible();
  await expect(page.getByText('电力', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /种子，数量 10001/ })).toBeVisible();

  await page.goto('/zh-cn/headquarters/overview/');
  await expect(page).toHaveURL(/\/zh-cn\/headquarters\/overview\//);
  await expect(page.getByText('总览', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');

  await diagnostics.flush();
  expect(diagnostics.data.pageErrors).toEqual([]);
  expect(diagnostics.data.failedRequests.filter((request) => request.localApi)).toEqual([]);

  const productionQueueResponse = diagnostics.data.apiResponses.find(
    (response) => response.method === 'POST' && /\/api\/v2\/companies\/buildings\/\d+\/queue\//.test(response.url),
  );
  if (productionQueueResponse) {
    expect(productionQueueResponse.responseBody).toBeDefined();
    expect(JSON.parse(productionQueueResponse.responseBody ?? 'null')).toEqual(expect.any(Array));
  }
});
