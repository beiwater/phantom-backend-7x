import puppeteer from 'puppeteer';
import path from 'node:path';

async function testSignUpForm() {
  console.log('Testing Full UI Signup Flow...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log(`[Console]: ${msg.text()}`));
  page.on('pageerror', err => console.log('[PAGE ERROR]:', err));

  await page.goto('http://127.0.0.1:3000/zh-cn/signup/', { waitUntil: 'networkidle2' });

  // Dismiss cookie banner
  const cookieBtns = await page.$$('button');
  for (const b of cookieBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('全部接受') || text.includes('仅限必要')) {
      await b.click();
      break;
    }
  }

  // Click "使用邮箱地址" button
  const allBtns = await page.$$('button');
  for (const b of allBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
      console.log(`-> Clicking: "${text.trim()}"`);
      await b.click();
      break;
    }
  }

  await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.resolve('screenshots/signup_after_email_click.png'), fullPage: true });

  // Now find the visible email and password inputs
  const emailInput = await page.$('input[type="email"], input[name="email"]');
  const passwordInput = await page.$('input[type="password"], input[name="password"]');

  const newEmail = `player_${Date.now()}@domain.local`;

  if (emailInput && passwordInput) {
    console.log(`-> Typing email: ${newEmail}`);
    await emailInput.type(newEmail);

    console.log('-> Typing password: Password123!');
    await passwordInput.type('Password123!');

    await page.screenshot({ path: path.resolve('screenshots/signup_filled.png'), fullPage: true });

    // Submit by pressing Enter or clicking the register button
    console.log('-> Submitting registration by pressing Enter key...');
    await passwordInput.press('Enter');

    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    console.log('URL after Signup submit:', page.url());

    await page.screenshot({ path: path.resolve('screenshots/after_signup_success.png'), fullPage: true });

    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('Page Title:', await page.title());
    console.log('Rendered text snippet:\n', bodyText.slice(0, 300));
  } else {
    console.error('Failed to locate email and password inputs after clicking 使用邮箱地址!');
  }

  await browser.close();
}

testSignUpForm();
