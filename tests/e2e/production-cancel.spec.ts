import { expect, test } from '@playwright/test';

test('production cancellation restores the ingredients in the browser', async ({ page }) => {
  await page.goto('/zh-cn/signup/');
  const cookie = page.getByRole('button', { name: '全部接受', exact: true });
  if (await cookie.isVisible().catch(() => false)) await cookie.click();
  await page.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  await page.locator('input[type="email"]').fill(`cancel_${Date.now()}@example.local`);
  await page.locator('input[type="password"]').fill('Password123!');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/zh-cn\/(?:create|landscape)\//);
  if (/\/zh-cn\/create\//.test(page.url())) {
    await page.getByRole('textbox').first().fill(`Cancel ${Date.now()}`);
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
  const farm = page.locator('a.test-building-P:visible').first();
  await expect(farm).toBeVisible();
  const farmUrl = await farm.getAttribute('href');
  assertFarmUrl(farmUrl);
  await farm.click();
  await expect(page.getByRole('heading', { name: 'FARM' })).toBeVisible();
  await expect(page.locator('body')).toContainText('当前库存：10,000');
  await page.locator('input[name="amount"]').nth(1).fill('10');
  const productionResponse = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && /\/api\/v1\/(?:busy|buildings\/\d+\/busy)\/?$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('button', { name: '生产', exact: true }).click();
  expect((await productionResponse).status()).toBe(200);

  await page.goto(farmUrl);
  await expect(page.getByRole('button', { name: '取消生产' })).toBeVisible();
  await expect(page.locator('body')).toContainText('当前库存：9,990');
  const cancelResponse = page.waitForResponse(response =>
    response.request().method() === 'DELETE'
    && /\/api\/v1\/(?:busy|buildings\/\d+\/busy)\/?$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('button', { name: '取消生产' }).click();
  await expect(page.getByRole('dialog', { name: '取消' })).toBeVisible();
  await page.getByRole('button', { name: '我明白，取消生产' }).click();
  expect((await cancelResponse).status()).toBe(200);

  await page.goto(farmUrl);
  await expect(page.locator('body')).toContainText('当前库存：10,000');
  await expect(page.locator('body')).not.toContainText('正在生产：10');
  await page.reload();
  await expect(page.locator('body')).toContainText('当前库存：10,000');
  await expect(page.getByRole('button', { name: '取消生产' })).toHaveCount(0);
});

function assertFarmUrl(value: string | null): asserts value is string {
  expect(value).toMatch(/^\/zh-cn\/b\/\d+\/$/);
}
