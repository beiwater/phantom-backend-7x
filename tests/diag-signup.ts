import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('1. Going to root / ...');
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle2' });

  // Dismiss cookie banner
  for (const b of await page.$$('button')) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('全部接受') || text.includes('仅限必要')) {
      await b.click();
      break;
    }
  }

  console.log('2. Going to /zh-cn/signup/ ...');
  await page.goto('http://127.0.0.1:3000/zh-cn/signup/', { waitUntil: 'networkidle2' });

  const btns = await page.$$eval('button', els => els.map(e => e.innerText));
  console.log('Buttons on signup page:', btns);

  const inputs = await page.$$eval('input', els => els.map(e => ({ type: e.type, name: e.name, placeholder: e.placeholder })));
  console.log('Inputs on signup page:', inputs);

  // Click "使用邮箱地址"
  for (const b of await page.$$('button')) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
      await b.click();
      console.log('Clicked email button:', text);
      break;
    }
  }
  await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});

  const inputsAfter = await page.$$eval('input', els => els.map(e => ({ type: e.type, name: e.name, placeholder: e.placeholder })));
  console.log('Inputs after click:', inputsAfter);

  const emailInput = await page.$('input[type="email"], input[name="email"]');
  const passwordInput = await page.$('input[type="password"], input[name="password"]');

  if (emailInput && passwordInput) {
    const testEmail = `diag_test_${Date.now()}@domain.local`;
    console.log('Typing credentials...');
    await emailInput.type(testEmail);
    await passwordInput.type('Password123!');
    console.log('Pressing Enter...');
    await passwordInput.press('Enter');
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
  }

  console.log('URL after submit:', page.url());
  const bodySnippet = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log('Body snippet:\n', bodySnippet);

  await browser.close();
})();
