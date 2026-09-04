import { expect } from '@playwright/test';
import type { BrowserContext, Page, Response } from '@playwright/test';
import { attachDiagnostics, type DiagnosticsController } from './diagnostics.ts';

export const password = 'Password123!';
const e2eSpeedMultiplier = Number.parseFloat(process.env.SPEED_MULTIPLIER ?? '1') || 1;

// This is the complete building-kind matrix exposed by the canonical building
// metadata. The fixture deliberately includes non-production kinds as well so
// every specialized detail renderer is visited by an isolated account.
export const ALL_BUILDING_KINDS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'P', 'W', 'E', 'O', 'R', 'S',
  'G', 'C', 'A', 'F', 'M', 'Y', 'L', 'T', 'H', 'p', 'h', 'b', 'c', 's', 'a', 'f',
  'l', 'q', 'D', 'B', 'Q', 'o', 'x', 'g', 'd', 'n', 'e', 'i', 'j', 'k', 'm', 'r',
  't', 'u', 'v', 'y', 'z', 'I'
] as const;

// Keep kinds disjoint while giving each runner production, retail, and a
// seasonal renderer; one-off flows run where their building belongs (B/l/r).
export const BUILDING_PARTITIONS = [
  ['0', '1', '2', '3', '4', '6', '7', '8', '9', 'P', 'W', 'E', 'O', 'R', 'S', 'G', 'C', 't'],
  ['5', 'A', 'F', 'M', 'Y', 'L', 'T', 'H', 'p', 'h', 'b', 'c', 's', 'a', 'f', 'l', 'u', 'B'],
  ['q', 'D', 'Q', 'o', 'x', 'g', 'd', 'n', 'e', 'i', 'j', 'k', 'm', 'r', 'v', 'y', 'z', 'I'],
] as const;

export const PRODUCTION_KINDS = new Set([
  '0', '1', '6', '7', '8', '9', 'P', 'W', 'E', 'O', 'R', 'S', 'F', 'M', 'Y', 'L', 'T',
  'D', 'Q', 'o', 'x', 'g', 'e', 'i', 'j', 'k', 'm', 'v'
]);
const DIRECT_PRODUCTION_KINDS = new Set(['M', 'O', 'Q', 'v']);

export const SALES_KINDS = new Set(['2', 'G', 'C', 'A', 'H', 'B', 'd', 'r']);
export const SEASONAL_KINDS = new Set(['t', 'u', 'z', 'I']);

export interface Building {
  id: number;
  kind: string;
  category: string;
  name: string;
}

export interface ResourceDefinition {
  dbLetter: number;
  producedAt?: string;
  producedPerHourRaw?: number;
}

interface ApiResult<T = unknown> {
  status: number;
  body: T;
  text: string;
}

export interface ProductionStartResponse {
  duration: number;
  startedAt: string;
  finishesAt: string;
  queueItem: { duration: number };
  productionModifier?: number;
}

export interface SalesOfficeOrderDTO {
  finishedAt?: string;
  resources?: unknown[];
  datetime?: string;
  qualityBonus?: number;
  searchCost?: number;
}

export async function apiJson<T = unknown>(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  return page.evaluate(async ({ method: requestMethod, url: requestUrl, body: requestBody }) => {
    const response = await fetch(requestUrl, {
      method: requestMethod,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      // Preserve the raw response so a failed assertion includes the payload.
    }
    return { status: response.status, body: parsed, text };
  }, { method, url, body: serializedBody }) as Promise<ApiResult<T>>;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const acceptButton = page.getByRole('button', { name: '全部接受', exact: true });
  if (await acceptButton.isVisible().catch(() => false)) {
    await acceptButton.click();
  }
}

async function completeCompanyCreation(page: Page, companyName: string): Promise<void> {
  await expect(page).toHaveURL(/\/zh-cn\/(?:create|landscape)\//);
  if (!/\/zh-cn\/create\//.test(page.url())) return;
  const nameInput = page.getByRole('textbox').first();
  await expect(nameInput).toBeVisible();
  await nameInput.fill(companyName);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
}

export async function createIsolatedAccount(page: Page, email: string, companyName: string): Promise<void> {
  await page.goto('/zh-cn/signup/');
  await dismissCookieBanner(page);
  await page.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await completeCompanyCreation(page, companyName);
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/zh-cn/signin/');
  await dismissCookieBanner(page);
  const emailLoginButton = page.getByRole('button', { name: '使用邮箱地址', exact: true });
  if (await emailLoginButton.isVisible().catch(() => false)) await emailLoginButton.click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('input[type="password"]').press('Enter');
  await expect(page).toHaveURL(/\/zh-cn\/landscape\//);
}

async function responseFor(
  page: Page,
  predicate: (response: Response) => boolean,
): Promise<Response> {
  return page.waitForResponse(predicate, { timeout: 20_000 });
}

function parseDisplayedDuration(text: string): number {
  const duration = text.match(/\(([^)]*)\)/)?.[1];
  if (duration) {
    const parts = [...duration.matchAll(/(\d+)\s*([dhms])/g)];
    if (parts.length > 0) {
      return parts.reduce((total, [, value, unit]) => total + Number(value) * ({
        d: 86_400,
        h: 3_600,
        m: 60,
        s: 1
      }[unit] ?? 0), 0);
    }
  }
  throw new Error(`Could not parse displayed duration from: ${text}`);
}

export async function assertHealthyBuildingPage(page: Page, building: Building): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/zh-cn/b/${building.id}/?$`));
  const body = page.locator('body');
  await expect(body).not.toContainText('NaN');
  await expect(body).not.toContainText('哎呀，出了点问题');
}

export async function openBuildingFromMapOrRoute(page: Page, building: Building): Promise<void> {
  await page.goto('/zh-cn/landscape/');
  const mapLink = page.locator(`a.test-building-${building.kind}`).first();
  if (await mapLink.isVisible().catch(() => false)) {
    await mapLink.click();
  } else {
    // The map only renders occupied coordinates in its current viewport. The
    // direct detail route is the deterministic fallback for the remaining
    // matrix slots, and still exercises the same building renderer.
    await page.goto(`/zh-cn/b/${building.id}/`);
  }
  await assertHealthyBuildingPage(page, building);
}

export async function assertHealthyBuildingPages(
  context: BrowserContext,
  diagnostics: DiagnosticsController,
  buildings: Building[],
): Promise<void> {
  // Keep browser/server pressure bounded: three partitions × six pages still
  // validates every detail route concurrently without opening 54 tabs at once.
  const batchSize = 6;
  for (let start = 0; start < buildings.length; start += batchSize) {
    await Promise.all(buildings.slice(start, start + batchSize).map(async building => {
      const detailPage = await context.newPage();
      const detailDiagnostics = attachDiagnostics(detailPage);
      try {
        await detailPage.goto(`/zh-cn/b/${building.id}/`);
        await assertHealthyBuildingPage(detailPage, building);
      } finally {
        await detailDiagnostics.flush();
        diagnostics.data.consoleErrors.push(...detailDiagnostics.data.consoleErrors);
        diagnostics.data.pageErrors.push(...detailDiagnostics.data.pageErrors);
        diagnostics.data.failedRequests.push(...detailDiagnostics.data.failedRequests);
        diagnostics.data.apiResponses.push(...detailDiagnostics.data.apiResponses);
        await detailPage.close().catch(() => undefined);
      }
    }));
  }
}

async function setProductionBonus(page: Page, target: number): Promise<void> {
  const response = await apiJson<{ productionModifier?: number }>(
    page,
    'POST',
    '/api/v2/companies/me/bonus/',
    { production: target },
  );
  expect(response.status, `bonus response: ${response.text}`).toBe(200);
  expect(response.body.productionModifier).toBe(target);
}

export async function startProduction(
  page: Page,
  building: Building,
  output: ResourceDefinition,
  bonusTarget: number,
): Promise<void> {
  await setProductionBonus(page, bonusTarget);
  await page.goto(`/zh-cn/b/${building.id}/`);
  await assertHealthyBuildingPage(page, building);

  const productionAmount = Math.max(1, Math.ceil(Number(output.producedPerHourRaw ?? 1) * 0.5));
  const row = page.locator(`.test-resource-row-${output.dbLetter}`).first();
  if (DIRECT_PRODUCTION_KINDS.has(building.kind)) {
    // Extractors expose a scalar abundance response that the original
    // renderer cannot use for its estimate. Forest Nursery output is hidden
    // outside its production season. Both still use the canonical API start.
    if (building.kind !== 'v') {
      await expect(row, `${building.kind} must render output ${output.dbLetter}`).toBeVisible();
      await expect(row.locator('input[name="amount"]')).toBeVisible();
    }
    const response = await apiJson<ProductionStartResponse>(
      page,
      'POST',
      `/api/v1/buildings/${building.id}/busy/`,
      { kind: output.dbLetter, amount: productionAmount, limitQuality: null },
    );
    expect(response.status, `${building.kind}/${output.dbLetter}: ${response.text}`).toBe(200);
    expectProductionDuration(response.body);
    return;
  }

  await expect(row, `${building.kind} must render output ${output.dbLetter}`).toBeVisible();
  const amount = row.locator('input[name="amount"]');
  await expect(amount).toBeVisible();
  await amount.fill(String(productionAmount));
  await expect(row).toContainText('预计完成时间');
  const displayedDuration = parseDisplayedDuration(await row.innerText());
  expect(displayedDuration).toBeGreaterThan(0);
  const productionResponse = responseFor(page, response => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === 'POST'
      && /^\/api\/v1\/(?:busy|buildings\/\d+\/busy)\/?$/.test(pathname);
  });
  await row.getByRole('button', { name: '生产', exact: true }).click();
  const response = await productionResponse;
  expect(response.status()).toBe(200);
  const payload = await response.json() as ProductionStartResponse;
  expectProductionDuration(payload);
  // The browser renders logical seconds; the accelerated server returns wall
  // seconds. Normalize by SPEED_MULTIPLIER before comparing the contracts.
  // The browser renders logical seconds rounded to minutes when > 1h (e.g. 1h 47m);
  // normalize by SPEED_MULTIPLIER and allow up to 60s for minute truncation.
  const allowedTolerance = displayedDuration >= 3600
    ? Math.max(60, 60 * e2eSpeedMultiplier)
    : Math.max(15, 15 * e2eSpeedMultiplier);
  expect(
    Math.abs(displayedDuration - (payload.duration * e2eSpeedMultiplier)),
    `${building.kind}/${output.dbLetter}: UI=${displayedDuration}s, server=${payload.duration}s, multiplier=${e2eSpeedMultiplier}`,
  ).toBeLessThanOrEqual(allowedTolerance);
}

function expectProductionDuration(payload: ProductionStartResponse): void {
  expect(payload.duration).toBeGreaterThan(0);
  expect(payload.queueItem.duration).toBe(payload.duration);
  expect(Date.parse(payload.finishesAt) - Date.parse(payload.startedAt)).toBe(payload.duration * 1000);
}

export async function startGenericSale(page: Page, building: Building): Promise<boolean> {
  await page.goto(`/zh-cn/b/${building.id}/`);
  const quantity = page.locator('input[name="quantity"]').first();
  const rendered = await quantity.waitFor({ state: 'visible', timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (!rendered) return false;

  const form = quantity.locator('xpath=ancestor::form[1]');
  await quantity.fill('1');
  const averagePrice = form.getByRole('button', { name: '平均价格', exact: true });
  if (await averagePrice.count() > 0) await averagePrice.click();
  const saleButton = form.getByRole('button', { name: '销售', exact: true });
  await expect(saleButton).toBeVisible();
  const saleResponse = responseFor(page, response => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === 'POST'
      && /^\/api\/v1\/(?:busy|buildings\/\d+\/busy)\/?$/.test(pathname);
  });
  await saleButton.click();
  const response = await saleResponse;
  expect(response.status()).toBe(200);
  return true;
}

export async function startSalesOfficeContract(page: Page, building: Building): Promise<void> {
  await page.goto(`/zh-cn/b/${building.id}/`);
  const search = page.getByRole('button', { name: '寻找客户', exact: true });
  await expect(search).toBeVisible();
  const searchResponse = responseFor(page, response =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/v2/companies/buildings/${building.id}/sales-orders/`,
  );
  await search.click();
  const response = await searchResponse;
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    id?: number;
    salesOrder?: {
      id?: number;
      resources?: unknown[];
      datetime?: string;
      qualityBonus?: number;
      searchCost?: number;
    };
  };
  expect(payload.salesOrder?.id || payload.id).toBeGreaterThan(0);
  expect(payload.salesOrder?.resources).toEqual(expect.any(Array));
  expect(payload.salesOrder?.datetime).toEqual(expect.any(String));
  expect(payload.salesOrder?.qualityBonus).toEqual(expect.any(Number));
  expect(payload.salesOrder?.searchCost).toEqual(expect.any(Number));
  await assertHealthyBuildingPage(page, building);
}

export async function startRestaurantSales(page: Page, building: Building): Promise<void> {
  const propertiesPath = `/api/v2/companies/buildings/${building.id}/restaurant-properties/`;
  const configured = await apiJson<{ cycle?: unknown }>(page, 'PATCH', propertiesPath, {
    menu: [
      { resource: 117, quality: 0, qualityMode: 'low' },
      { resource: 129, quality: 0, qualityMode: 'low' },
      { resource: 132, quality: 0, qualityMode: 'low' },
    ],
    menuPrice: 60,
    // keepOpen=true starts the first cycle as part of this PATCH. Do not
    // click the page's open button and create a second run.
    keepOpen: true,
  });
  expect(configured.status, `restaurant configuration: ${configured.text}`).toBe(200);
  expect(configured.body.cycle).toBeDefined();

  await page.goto(`/zh-cn/b/${building.id}/`);
  await assertHealthyBuildingPage(page, building);
}

export async function startLaunch(page: Page, building: Building): Promise<void> {
  await page.goto(`/zh-cn/b/${building.id}/`);
  const launch = page.getByRole('button', { name: '启动发射！', exact: true });
  await expect(launch).toBeVisible();
  const launchResponse = responseFor(page, response => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === 'POST'
      && /^\/api\/v1\/(?:busy|buildings\/\d+\/busy)\/?$/.test(pathname);
  });
  await launch.click();
  const response = await launchResponse;
  expect(response.status()).toBe(200);
  // The launch action returns to the landscape; reload the canonical detail
  // route before asserting the completed renderer has no frontend errors.
  await page.goto(`/zh-cn/b/${building.id}/`);
  await assertHealthyBuildingPage(page, building);
}
