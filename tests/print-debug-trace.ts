import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

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
  await new Promise(r => setTimeout(r, 1000));

  // Click on "展示调试信息"
  for (const b of await page.$$('button, a, summary, div')) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('展示调试信息') || text.includes('调试')) {
      await b.click().catch(() => {});
      break;
    }
  }
  await new Promise(r => setTimeout(r, 500));

  const debugText = await page.evaluate(() => document.body.innerText);
  console.log('Full Debug text:\n', debugText);

  await browser.close();
})();
