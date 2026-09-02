/** Log the executives page network traffic and visible NaN/state issues. */
import { chromium } from '@playwright/test';
import { findBrowserExecutable } from './find-browser.ts';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3001';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

const browser = await chromium.launch({
  headless: true,
  executablePath: findBrowserExecutable(),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on('response', async (res) => {
  if (res.url().includes('/executive')) {
    console.log('API:', res.status(), res.url().replace(baseUrl, ''));
  }
});

if (!email || !password) {
  console.log('set E2E_EMAIL/E2E_PASSWORD');
  process.exit(1);
}
await page.goto(`${baseUrl}/zh-cn/signin/`);
const banner = page.getByRole('button', { name: /全部接受|仅限必要/ }).first();
if (await banner.isVisible({ timeout: 1500 }).catch(() => false)) await banner.click().catch(() => {});
const dialog = page.getByRole('dialog');
const emailMode = dialog.getByRole('button', { name: '使用邮箱地址', exact: true });
if (await emailMode.isVisible().catch(() => false)) await emailMode.click();
await dialog.getByRole('textbox').nth(0).fill(email);
await dialog.getByRole('textbox').nth(1).fill(password);
await dialog.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForURL(/\/zh-cn\/landscape\//, { timeout: 10000 }).catch(() => {});

await page.goto(`${baseUrl}/zh-cn/headquarters/executives/`);
await page.waitForTimeout(3000);
const text = await page.locator('body').innerText({ timeout: 5000 });
console.log('=== executives page text (excerpt) ===');
for (const line of text.split('\n')) {
  if (/NaN|交接|培训|罢工|增益| settling|Settling|strike/i.test(line)) console.log('>>', line.trim());
}
await browser.close();
