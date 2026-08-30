import puppeteer from 'puppeteer';
import path from 'node:path';

async function testSignInForm() {
  console.log('Testing Signin Form Submission via pure DOM interaction...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log(`[Console]: ${msg.text()}`));
  page.on('pageerror', err => console.log('[PAGE ERROR]:', err));

  await page.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });
  // Dismiss cookie banner
  const allCookieBtns = await page.$$('button');
  for (const b of allCookieBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('全部接受') || text.includes('仅限必要')) {
      await b.click();
      break;
    }
  }

  // Inspect all buttons on page
  const buttonsInfo = await page.$$eval('button', els =>
    els.map((e, idx) => ({
      idx,
      type: e.getAttribute('type'),
      text: e.textContent?.trim(),
      formAction: e.getAttribute('formaction'),
      parentTag: e.parentElement?.tagName
    }))
  );
  console.log('All buttons on Signin page:', buttonsInfo);

  // Type credentials into email & password inputs
  const emailInput = await page.$('input[type="email"]');
  const passwordInput = await page.$('input[type="password"]');

  if (emailInput && passwordInput) {
    console.log('-> Typing email & password...');
    await emailInput.type('admin@simcompanies.local');
    await passwordInput.type('admin123');

    // Submit by pressing Enter on password input or clicking the form submit button
    console.log('-> Submitting form by pressing Enter key...');
    await passwordInput.press('Enter');

    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    console.log('URL after pressing Enter:', page.url());

    await page.screenshot({ path: path.resolve('screenshots/after_enter_submit.png'), fullPage: true });

    // Check top bar and landscape elements
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('Page Title:', await page.title());
    console.log('Rendered text snippet:\n', bodyText.slice(0, 300));
  }

  await browser.close();
}

testSignInForm();
