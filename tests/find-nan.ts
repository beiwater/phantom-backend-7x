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

  await page.goto('http://127.0.0.1:3000/zh-cn/b/1/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  // Find all elements containing NaN
  const nanElements = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all
      .filter(el => el.children.length === 0 && el.innerText && el.innerText.includes('NaN'))
      .map(el => ({
        tag: el.tagName,
        className: el.className,
        parentTag: el.parentElement?.tagName,
        parentClass: el.parentElement?.className,
        text: el.innerText
      }));
  });

  console.log('DOM elements with NaN:\n', JSON.stringify(nanElements, null, 2));

  await browser.close();
})();
