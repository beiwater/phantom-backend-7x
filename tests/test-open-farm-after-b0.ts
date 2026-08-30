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
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n--- 4. Navigating to landscape map ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('a[href*="/b/"]', { timeout: 10000 });

  const buildingLinks = await page.$$eval('a[href*="/b/"]', els =>
    els.map(el => ({ href: el.getAttribute('href'), text: el.innerText.trim() }))
  );
  console.log('Building links on landscape map:\n', buildingLinks);

  if (buildingLinks.length > 0) {
    console.log(`\n--- 5. Clicking first building link: ${buildingLinks[0].href} ---`);
    await page.goto(`http://127.0.0.1:3000${buildingLinks[0].href}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    const insideInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input')).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim().replace(/\n+/g, ' ') || '',
        class: b.className,
        href: b.getAttribute('href'),
        value: (b as HTMLInputElement).value
      }));
      return {
        title: document.title,
        url: window.location.href,
        bodySnippet: document.body.innerText.slice(0, 1000),
        buttons: buttons.filter(b => b.text.length > 0 || b.tag === 'INPUT').slice(0, 30)
      };
    });

    console.log('Inside building URL:', insideInfo.url);
    console.log('Body Text:\n', insideInfo.bodySnippet);
    console.log('Buttons & Inputs:\n', JSON.stringify(insideInfo.buttons, null, 2));
  }

  await browser.close();
})();
