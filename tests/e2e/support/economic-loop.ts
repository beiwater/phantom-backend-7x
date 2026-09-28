import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

interface CompanyState { companyId: number; money: number; simBoosts: number }
interface Stock { kind: number; quality: number; amount: number }

export async function readEconomicState(page: Page): Promise<{ company: CompanyState; stock: Stock[] }> {
  // Read-only verification. Every mutation in this flow uses visible controls.
  const auth = await page.request.get('/api/v3/companies/auth-data/');
  expect(auth.status()).toBe(200);
  const { authCompany: company } = await auth.json() as { authCompany: CompanyState };
  expect(Number.isFinite(company.money)).toBe(true);
  expect(Number.isFinite(company.simBoosts)).toBe(true);
  const inventory = await page.request.get(`/api/v3/resources/${company.companyId}/`);
  expect(inventory.status()).toBe(200);
  const stock = await inventory.json() as Stock[];
  for (const item of stock) {
    expect(Number.isFinite(item.amount)).toBe(true);
    expect(item.amount).toBeGreaterThanOrEqual(0);
  }
  return { company, stock };
}

function amount(stock: Stock[], kind: number): number {
  return stock.filter(item => item.kind === kind).reduce((sum, item) => sum + item.amount, 0);
}

export async function constructThroughUi(page: Page, testInfo: TestInfo): Promise<void> {
  const before = await readEconomicState(page);
  const readBuildings = async () => {
    const response = await page.request.get('/api/v2/companies/me/buildings/');
    expect(response.status()).toBe(200);
    return await response.json() as Array<{ id: number; kind: string; position: string; busy: unknown }>;
  };
  const buildingsBefore = await readBuildings();
  await page.getByRole('button', { name: '地块', exact: true }).first().click();
  await expect(page).toHaveURL(/\/zh-cn\/landscape\/buildings\//);
  const position = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  await page.getByRole('button', { name: /^农场，大约价格/ }).click();
  const constructionResponse = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && /\/api\/v2\/companies\/(?:me|\d+)\/buildings\/?$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('button', { name: '建设农场', exact: true }).click();
  const constructed = await constructionResponse;
  expect(constructed.status()).toBe(200);
  const result = await constructed.json() as {
    cost: number;
    building: { id: number; kind: string; position: string; isUnderConstruction: boolean; busy: { duration: number } };
    resourcesConsumed: Array<{ db_letter: number; quality: number; amount: number }>;
  };
  expect(result.cost).toBe(6900);
  expect(result.building).toMatchObject({ kind: 'P', position, isUnderConstruction: true });
  expect(result.building.busy.duration).toBeGreaterThan(0);
  expect(result.resourcesConsumed).toEqual([
    { db_letter: 101, quality: 0, amount: 8 },
    { db_letter: 102, quality: 0, amount: 110 },
    { db_letter: 108, quality: 0, amount: 32 },
    { db_letter: 111, quality: 0, amount: 2 }
  ]);
  await expect(page).toHaveURL(/\/zh-cn\/landscape\/$/);
  await expect(page.locator(`a[href="/zh-cn/b/${result.building.id}/"]`)).toBeVisible();
  const after = await readEconomicState(page);
  expect(after.company.money).toBe(before.company.money - result.cost);
  expect(after.company.money).toBeGreaterThanOrEqual(0);
  expect(after.company.simBoosts).toBe(before.company.simBoosts);
  for (const input of result.resourcesConsumed) {
    expect(amount(after.stock, input.db_letter)).toBe(amount(before.stock, input.db_letter) - input.amount);
  }
  const buildingsAfter = await readBuildings();
  expect(buildingsAfter).toHaveLength(buildingsBefore.length + 1);
  expect(buildingsAfter.find(building => building.id === result.building.id)).toMatchObject({ kind: 'P', position });
  await page.screenshot({ path: testInfo.outputPath('landscape-after-construction.png') });
  await page.reload();
  expect((await readEconomicState(page)).company.money).toBe(after.company.money);
  expect(await readBuildings()).toHaveLength(buildingsAfter.length);
  await testInfo.attach('construction-invariants.json', {
    body: JSON.stringify({ before, buildingsBefore, result, after, buildingsAfter }, null, 2),
    contentType: 'application/json'
  });
}

export async function produceAndBuyThroughUi(page: Page, testInfo: TestInfo): Promise<void> {
  const before = await readEconomicState(page);
  const farm = page.locator('a.test-building-P:visible').first();
  await expect(farm).toBeVisible();
  await farm.click();
  await expect(page.getByRole('heading', { name: 'FARM', exact: true })).toBeVisible();
  await page.locator('input[name="amount"]').first().fill('1');
  const startResponse = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && /^\/api\/v1\/(?:busy\/\d+|buildings\/\d+\/busy)\/?$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('button', { name: '生产', exact: true }).click();
  const started = await startResponse;
  expect(started.status()).toBe(200);
  const task = await started.json() as {
    duration: number;
    queueItem: { id: number; kind: number; amount: number; duration: number };
    resourceTransactions: Array<{ kind: number; amount: number }>;
  };
  expect(task.queueItem.id).toBeGreaterThan(0);
  expect(task.queueItem.kind).toBe(66);
  expect(task.duration).toBeGreaterThan(0);
  expect(task.queueItem.duration).toBe(task.duration);
  const queued = await readEconomicState(page);
  expect(amount(queued.stock, 66)).toBe(amount(before.stock, 66));
  for (const input of task.resourceTransactions) {
    expect(amount(queued.stock, input.kind)).toBe(amount(before.stock, input.kind) - Math.abs(input.amount));
  }
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
  const pickup = page.getByRole('link', { name: '捡起种子', exact: true });
  await expect(pickup).toBeVisible({ timeout: Math.min(60_000, task.duration * 1000 + 15_000) });
  const collectResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && /\/api\/v2\/order\/take\/\d+\//.test(response.url())
  );
  await pickup.click();
  expect((await collectResponse).status()).toBe(200);
  const collected = await readEconomicState(page);
  expect(amount(collected.stock, 66)).toBe(amount(before.stock, 66) + task.queueItem.amount);
  expect(collected.company.money).toBe(queued.company.money);
  await page.getByRole('link', { name: '仓库', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(`种子，数量 ${amount(collected.stock, 66)}`) })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('warehouse-after-production.png') });

  await page.getByRole('link', { name: '交易所', exact: true }).last().click();
  await page.locator('a.test-exchange-resource-1:visible').first().click();
  await expect(page.locator('input[name="quantity"]')).toBeVisible();
  await page.locator('input[name="quantity"]').fill('1');
  const purchaseResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && /\/api\/v2\/market-order\/take\/?$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('button', { name: /购买/ }).first().click();
  const purchased = await purchaseResponse;
  expect(purchased.status()).toBe(200);
  const trade = await purchased.json() as { money: number; moneyDelta: number; amountBought: number };
  expect(trade.amountBought).toBe(1);
  expect(trade.moneyDelta).toBeLessThan(0);
  const after = await readEconomicState(page);
  expect(after.company.money).toBeCloseTo(collected.company.money + trade.moneyDelta, 8);
  expect(after.company.money).toBe(trade.money);
  expect(amount(after.stock, 1)).toBe(amount(collected.stock, 1) + 1);
  await expect(page.getByText(/你已购买 1 单位的 电力/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('market-purchase.png') });
  await page.reload();
  const persisted = await readEconomicState(page);
  expect(persisted.company.money).toBe(after.company.money);
  expect(persisted.stock).toEqual(after.stock);
  await page.getByRole('link', { name: '仓库', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(`电力，数量 ${amount(after.stock, 1)}`) })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/NaN|Infinity|undefined/);
  await testInfo.attach('economic-invariants.json', {
    body: JSON.stringify({ before, queued, collected, trade, after, persisted }, null, 2),
    contentType: 'application/json'
  });
}
