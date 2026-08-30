import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log('[Browser Log]', msg.type(), msg.text()));
  page.on('request', req => {
    if (req.url().includes('/api/')) {
      console.log('[API Req]', req.method(), req.url(), req.postData() || '');
    }
  });
  page.on('response', async res => {
    if (res.url().includes('/api/')) {
      let body = '';
      try { body = await res.text(); } catch {}
      console.log('[API Res]', res.status(), res.url(), body.slice(0, 150));
    }
  });

  await page.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });
  const cookieBtns = await page.$$('button');
  for (const b of cookieBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('全部接受') || text.includes('仅限必要')) {
      await b.click();
      break;
    }
  }

  const allBtns = await page.$$('button');
  for (const b of allBtns) {
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

  console.log('\n--- Navigating to B0 ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- Clicking Farm (test-building-kind-P) ---');
  const farmBtn = await page.$('.test-building-kind-P');
  if (farmBtn) {
    await farmBtn.click();
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n--- Clicking "建设农场" button ---');
  const constructBtn = await page.$('.btn-primary');
  if (constructBtn) {
    await constructBtn.click();
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('Done.');
  await browser.close();
})();
