import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('pageerror', err => {
    console.log('--- PAGE ERROR CAUGHT ---');
    console.log(err.message);
    console.log(err.stack);
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

  console.log('Navigating to encyclopedia resource 3...');
  await page.goto('http://127.0.0.1:3000/zh-cn/encyclopedia/0/resource/3/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // Click on show debug button
  const errorDetails = await page.evaluate(() => {
    const pre = document.querySelector('pre');
    if (pre) return pre.innerText;

    // Search for button or div that toggles debug info
    const clickable = Array.from(document.querySelectorAll('*'));
    const target = clickable.find(el => (el as HTMLElement).innerText && (el as HTMLElement).innerText.includes('调试'));
    if (target) {
      (target as HTMLElement).click();
      const preAfter = document.querySelector('pre');
      if (preAfter) return preAfter.innerText;
    }
    return 'NO ERROR PRE FOUND';
  });

  console.log('Error Details:\n', errorDetails);
  await browser.close();
})();
