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

  console.log('\n--- Navigating to Farm: /zh-cn/b/1/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/b/1/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // Find the first "24h" button and click it
  console.log('Clicking "24h" button for the first recipe (Seeds)...');
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.trim() === '24h') {
      await b.click();
      console.log('  -> Clicked 24h button');
      break;
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // Inspect the page to see if "生产" button appeared
  const after24hButtons = await page.$$eval('button', els =>
    els.map(el => ({ text: el.textContent?.trim() || '', class: el.className }))
  );
  console.log('Buttons after clicking 24h:\n', after24hButtons);

  // Click "生产" button
  console.log('Looking for "生产" / "Produce" button...');
  for (const b of await page.$$('button')) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('生产') || text.includes('Produce')) {
      console.log('  -> Clicking Produce button:', text.trim());
      await b.click();
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
      break;
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  const finalPageText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log('Page text after queuing production:\n', finalPageText);

  await browser.close();
})();
