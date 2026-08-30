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

  console.log('[Step 1] Navigating to http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/ ...');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/buildings/B0/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  // Click on Farm
  console.log('[Step 2] Clicking Farm (test-building-kind-P)...');
  const farmBtn = await page.$('.test-building-kind-P');
  if (farmBtn) {
    await farmBtn.click();
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => {});
  }

  // Click "建设农场"
  console.log('[Step 3] Clicking "建设农场" button...');
  const constructBtns = await page.$$('button');
  let clickedConstruct = false;
  for (const b of constructBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('建设农场') || text.includes('建设') || text.includes('Construct')) {
      await b.click();
      clickedConstruct = true;
      console.log('  -> Clicked:', text.trim());
      break;
    }
  }
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  console.log('[Step 4] Current URL after construction:', page.url());

  // Inspect the current page (is it map or building?)
  const currentUrl = page.url();
  if (currentUrl.includes('/landscape/')) {
    console.log('On landscape map, clicking on building link...');
    const bLinks = await page.$$('a[href*="/b/"]');
    if (bLinks.length > 0) {
      await bLinks[0].click();
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
    }
  }

  console.log('[Step 5] In building view URL:', page.url());
  const buildingViewInfo = await page.evaluate(() => {
    return {
      title: document.title,
      bodyTextSnippet: document.body.innerText.slice(0, 1500),
      buttons: Array.from(document.querySelectorAll('button, a, div[role="button"]')).map(b => ({
        text: b.innerText?.trim().replace(/\n+/g, ' ') || '',
        class: b.className,
        href: b.getAttribute('href')
      })).filter(b => b.text.length > 0).slice(0, 30)
    };
  });
  console.log('Building View Text:\n', buildingViewInfo.bodyTextSnippet);
  console.log('Building View Buttons:\n', JSON.stringify(buildingViewInfo.buttons, null, 2));

  await browser.close();
})();
