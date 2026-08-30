import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.evaluateOnNewDocument(() => {
    const origError = console.error;
    console.error = function(...args) {
      for (const arg of args) {
        if (arg && arg.stack) {
          console.log('--- ERROR STACK FOUND IN CONSOLE.ERROR ---\n' + arg.stack);
        } else if (arg && typeof arg === 'object') {
          try { console.log('--- ERROR OBJECT --- ' + JSON.stringify(arg)); } catch {}
        }
      }
      origError.apply(console, args);
    };
  });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('STACK') || text.includes('ERROR OBJECT') || text.includes('at ')) {
      console.log(text);
    }
  });

  await page.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });
  for (const b of await page.$$('button')) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('全部接受') || text.includes('仅限必要')) {
      await b.click();
      break;
    }
  }
  for (const b of await page.$$('button')) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
      await b.click();
      break;
    }
  }
  await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});

  const emailInput = await page.$('input[type="email"], input[name="email"]');
  const passwordInput = await page.$('input[type="password"], input[name="password"]');
  if (emailInput && passwordInput) {
    await emailInput.type('admin@simcompanies.local');
    await passwordInput.type('admin123');
    await passwordInput.press('Enter');
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
  }

  await page.goto('http://127.0.0.1:3000/zh-cn/encyclopedia/0/resource/3/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  await browser.close();
})();
