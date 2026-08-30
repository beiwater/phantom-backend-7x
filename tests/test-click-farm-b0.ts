import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

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

  console.log('Navigating to http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/ ...');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // Click on Farm (button.test-building-kind-P)
  console.log('Clicking Farm button (test-building-kind-P)...');
  const farmBtn = await page.$('.test-building-kind-P');
  if (farmBtn) {
    await farmBtn.click();
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('URL after clicking Farm:', page.url());
  const afterClickInfo = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      bodyTextSnippet: document.body.innerText.slice(0, 1500),
      buttons: Array.from(document.querySelectorAll('button, a')).map(b => ({
        text: b.innerText?.trim() || '',
        class: b.className,
        href: b.getAttribute('href')
      })).filter(b => b.text.length > 0).slice(0, 30)
    };
  });

  console.log('Body Text after click:\n', afterClickInfo.bodyTextSnippet);
  console.log('Buttons:\n', JSON.stringify(afterClickInfo.buttons, null, 2));

  await browser.close();
})();
