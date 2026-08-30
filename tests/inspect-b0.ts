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

  const pageInfo = await page.evaluate(() => {
    const clickable = Array.from(document.querySelectorAll('button, a, div[role="button"], tr, form')).map(el => ({
      tag: el.tagName,
      text: el.innerText ? el.innerText.trim().replace(/\n+/g, ' ').slice(0, 80) : '',
      href: el.getAttribute('href'),
      class: el.className
    }));
    return {
      title: document.title,
      url: window.location.href,
      bodySnippet: document.body.innerText.slice(0, 1500),
      clickable: clickable.filter(c => c.text.length > 0).slice(0, 50)
    };
  });

  console.log('Page Title:', pageInfo.title);
  console.log('Current URL:', pageInfo.url);
  console.log('Body Text Snippet:\n', pageInfo.bodySnippet);
  console.log('Clickable elements count:', pageInfo.clickable.length);
  console.log('Sample clickable:\n', JSON.stringify(pageInfo.clickable.slice(0, 30), null, 2));

  await browser.close();
})();
