import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';

const SCREENSHOT_DIR = path.resolve('screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function testLandingClick() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log(`[Browser ${msg.type()}]:`, msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]:', err));

  console.log('1. Loading http://127.0.0.1:3000/zh-cn/ ...');
  await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2' });

  // Dismiss cookie banner by clicking "全部接受"
  const cookieBtns = await page.$$('button');
  for (const b of cookieBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('全部接受') || text.includes('仅限必要')) {
      console.log(`-> Clicking Cookie button: "${text.trim()}"`);
      await b.click();
      break;
    }
  }

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'click_01_after_cookie.png'), fullPage: true });

  // Click "开始游戏" button
  const allBtns = await page.$$('button, a');
  for (const b of allBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.trim() === '开始游戏') {
      console.log(`-> Clicking "开始游戏" button...`);
      await b.click();
      break;
    }
  }

  await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'click_02_after_start_game.png'), fullPage: true });
  console.log('URL after "开始游戏" click:', page.url());

  // Check what modal or form opened
  const inputs = await page.$$eval('input', els =>
    els.map(e => ({
      type: e.getAttribute('type'),
      placeholder: e.getAttribute('placeholder'),
      name: e.getAttribute('name'),
      id: e.getAttribute('id')
    }))
  );
  console.log('Visible inputs on screen:', inputs);

  // Now click "登录" (Sign in) link
  const loginLink = await page.$('a[href*="/signin/"], a[href*="signin"]');
  if (loginLink) {
    console.log('-> Clicking "登录" (Sign in) link...');
    await loginLink.click();
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'click_03_signin_page.png'), fullPage: true });
    console.log('URL on Signin page:', page.url());

    // Look for email and password inputs
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="邮箱"], input[placeholder*="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    if (emailInput && passwordInput) {
      console.log('-> Typing credentials into login form...');
      await emailInput.type('admin@simcompanies.local');
      await passwordInput.type('admin123');

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'click_04_filled_login.png'), fullPage: true });

      // Click submit button in form
      const submitBtn = await page.$('button[type="submit"], form button, .modal button');
      if (submitBtn) {
        console.log('-> Submitting login form...');
        await submitBtn.click();
        await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'click_05_after_login_submit.png'), fullPage: true });
        console.log('URL after login submit:', page.url());
      }
    }
  }

  await browser.close();
}

testLandingClick();
