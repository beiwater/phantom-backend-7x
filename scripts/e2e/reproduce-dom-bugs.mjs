import { chromium } from '@playwright/test';
import { findBrowserExecutable } from './find-browser.ts';

// This is intentionally a browser-only reproducer. It does not use fetch,
// page.request, direct API calls, database edits, or DOM evaluate mutations.
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3811';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

async function dismissCookieBanner(page) {
  const btn = page.getByRole('button', { name: /全部接受|仅限必要/ }).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click().catch(() => {});
  }
}

async function signIn(page) {
  if (!email || !password) {
    console.log('restaurant: skipped (set E2E_EMAIL and E2E_PASSWORD)');
    return false;
  }

  await page.goto(`${baseUrl}/zh-cn/signin/`);
  await dismissCookieBanner(page);
  const dialog = page.getByRole('dialog');
  if (await dialog.getByRole('button', { name: '使用邮箱地址', exact: true }).isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: '使用邮箱地址', exact: true }).click();
  }
  await dialog.getByRole('textbox').nth(0).fill(email);
  await dialog.getByRole('textbox').nth(1).fill(password);
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/zh-cn\/landscape\//);
  return true;
}

async function reproduceRegistrationEntry(page) {
  await page.goto(`${baseUrl}/zh-cn/`);
  await dismissCookieBanner(page);

  const startButton = page.getByRole('button', { name: '开始游戏', exact: true });
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click();
  }

  const loginLink = page.getByRole('link', { name: '登录', exact: true }).first();
  if (await loginLink.isVisible().catch(() => false)) {
    await loginLink.click();
  }

  const dialog = page.getByRole('dialog');
  const noAccount = dialog.getByRole('button', { name: '没有账号吗？', exact: true });
  if (!(await noAccount.isVisible().catch(() => false))) {
    console.log('registration: skipped (login dialog was not reachable)');
    return;
  }
  await noAccount.click();
  await page.waitForURL(/\/zh-cn\/(?:create|signup)\//, { timeout: 10000 }).catch(() => {});

  const registrationButton = page.getByRole('button', { name: '注册', exact: true });
  const createCompanyHeader = page.getByText('创建公司', { exact: true });
  const startPlayingButton = page.getByRole('button', { name: '开始游戏', exact: true });
  const registrationFormVisible = (
    await registrationButton.isVisible().catch(() => false) ||
    await createCompanyHeader.isVisible().catch(() => false) ||
    await startPlayingButton.isVisible().catch(() => false)
  );
  const result = {
    urlAfterClick: page.url(),
    registrationFormVisible,
    observedBug: !registrationFormVisible,
  };
  console.log(`registration: ${JSON.stringify(result)}`);
}

async function reproduceRestaurantCloseToggle(page) {
  if (!(await signIn(page))) {
    return;
  }

  await page.getByRole('link', { name: '地图', exact: true }).last().click();
  const building = page.locator('a[href^="/zh-cn/b/"]').filter({ hasText: /小时|分钟|餐馆|Restaurant|营业/ }).first()
    .or(page.locator('a[href="/zh-cn/b/3/"]').first())
    .or(page.locator('a[href^="/zh-cn/b/"]').nth(2));
  if (!(await building.isVisible().catch(() => false))) {
    console.log('restaurant: skipped (restaurant building link was not present on map)');
    return;
  }
  await building.click();
  await page.waitForURL(/\/zh-cn\/b\/\d+\//, { timeout: 10000 }).catch(() => {});

  const stopButton = page.getByRole('button', { name: '当前周期结束后停止营业？', exact: true });
  const openButton = page.getByRole('button', { name: '开门营业', exact: true });
  if (await openButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('restaurant: skipped (restaurant is closed or has no ready cycle; supply stock and open it first)');
    return;
  }
  if (!(await stopButton.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log('restaurant: skipped (open cycle control is not visible)');
    return;
  }
  await stopButton.click();
  const yesClose = page.getByRole('button', { name: /是的，关店|Yes, close/ }).first();
  await yesClose.waitFor({ timeout: 5000 });
  await yesClose.click();

  const autoContinue = page.getByRole('button', { name: '自动连续营业？', exact: true });
  await autoContinue.waitFor({ timeout: 5000 });
  await autoContinue.click();

  const errorVisible = await page.getByText('An unexpected error occurred', { exact: true })
    .isVisible()
    .catch(() => false);
  const stillScheduledToClose = await page.getByText('后终止营业', { exact: false })
    .isVisible()
    .catch(() => false);
  console.log(`restaurant-close-toggle: ${JSON.stringify({ errorVisible, stillScheduledToClose, observedBug: errorVisible && stillScheduledToClose })}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findBrowserExecutable(),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await reproduceRegistrationEntry(page);
  await reproduceRestaurantCloseToggle(page);
} finally {
  await browser.close();
}
