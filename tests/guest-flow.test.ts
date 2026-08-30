import puppeteer, { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function takeStepScreenshot(page: Page, filename: string, caption: string) {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  [Screenshot] ${filename} - ${caption}`);
}

async function runGuestFlowTest() {
  console.log('================================================================');
  console.log(' Starting SimCompanies Guest & Unauthenticated Landing Flow Test');
  console.log('================================================================');

  const baseUrl = 'http://127.0.0.1:3000';

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  // Clean incognito context with zero initial cookies
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[Console Error]:', msg.text());
  });

  // 1. Visit Landing Page as Guest
  console.log('\n[1/3] Visiting /zh-cn/ with zero cookies...');
  await page.goto(`${baseUrl}/zh-cn/`, { waitUntil: 'networkidle2' });

  await takeStepScreenshot(page, 'guest_01_landing_page.png', 'Guest landing page with registration & start options');

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('  -> Page title:', await page.title());
  console.log('  -> Does page mention "lifeline"?', pageText.includes('lifeline'));
  console.log('  -> Does page have "登录" (Login)?', pageText.includes('登录'));
  console.log('  -> Does page have "开始" (Start) or "注册" (Register)?', pageText.includes('开始') || pageText.includes('注册'));

  // 2. Visit /500/ as Guest
  console.log('\n[2/3] Visiting /500/ ...');
  await page.goto(`${baseUrl}/500/`, { waitUntil: 'networkidle2' });
  await takeStepScreenshot(page, 'guest_02_500_page.png', '500 / Cache clear page');

  const page500Text = await page.evaluate(() => document.body.innerText);
  console.log('  -> Does 500 page mention "lifeline"?', page500Text.includes('lifeline'));

  // 3. User Register directly via UI
  console.log('\n[3/3] Navigating to /zh-cn/signup/ ...');
  await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });
  await takeStepScreenshot(page, 'guest_03_signup_view.png', 'Signup form view');

  await browser.close();
  console.log('\n================================================================');
  console.log(' Guest Flow Test Completed Successfully');
  console.log('================================================================');
}

runGuestFlowTest();
