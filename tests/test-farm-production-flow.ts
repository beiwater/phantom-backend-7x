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

  console.log('\n--- 1. Navigating to B0 ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- 2. Clicking Farm button ---');
  const farmBtn = await page.$('.test-building-kind-P');
  if (farmBtn) {
    await farmBtn.click();
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n--- 3. Clicking "建设农场" button ---');
  const constructBtn = await page.$('.btn-primary');
  if (constructBtn) {
    await constructBtn.click();
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n--- 4. After construction, current URL:', page.url());

  // Click on the Farm building on the map
  console.log('\n--- 5. Clicking Farm building on map ---');
  const buildingLinks = await page.$$('a[href*="/b/"]');
  console.log(`Found ${buildingLinks.length} building links on map.`);
  if (buildingLinks.length > 0) {
    await buildingLinks[0].click();
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('Inside building URL:', page.url());

  // Inspect recipes and buttons inside building
  const buildingInfo = await page.evaluate(() => {
    const clickable = Array.from(document.querySelectorAll('button, a, div[role="button"], img, input')).map(el => ({
      tag: el.tagName,
      text: el.innerText ? el.innerText.trim().replace(/\n+/g, ' ').slice(0, 80) : '',
      class: el.className,
      href: el.getAttribute('href'),
      src: el.getAttribute('src')
    }));
    return {
      title: document.title,
      url: window.location.href,
      bodySnippet: document.body.innerText.slice(0, 1500),
      clickable: clickable.filter(c => c.text.length > 0 || c.src || c.tag === 'BUTTON').slice(0, 40)
    };
  });

  console.log('Building Body Snippet:\n', buildingInfo.bodySnippet);
  console.log('Clickable elements:\n', JSON.stringify(buildingInfo.clickable, null, 2));

  await browser.close();
})();
