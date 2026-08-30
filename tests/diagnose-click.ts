import puppeteer from 'puppeteer';

async function diagnose() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => {
    console.log(`[Browser ${msg.type()}]:`, msg.text());
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]:', err);
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      console.log(`[HTTP ${res.status()}]:`, res.url());
    }
  });

  console.log('1. Loading http://127.0.0.1:3000/zh-cn/ ...');
  await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2' });

  console.log('\n2. Looking for buttons/links on landing page...');
  const links = await page.$$eval('a, button', els =>
    els.map(e => ({
      tag: e.tagName,
      text: e.textContent?.trim() || '',
      href: e.getAttribute('href') || ''
    })).filter(e => e.text.length > 0)
  );
  console.log(`Found ${links.length} links/buttons:`);
  links.forEach(l => console.log(`  [${l.tag}] "${l.text}" (href: ${l.href})`));

  console.log('\n3. Clicking "开始游戏" (Start Game) or "登录" (Login)...');
  const startBtn = await page.$('a[href*="signup"], a:has-text("开始游戏"), button');
  const allBtns = await page.$$('a, button');
  for (const b of allBtns) {
    const text = await b.evaluate(el => el.textContent || '');
    if (text.includes('开始游戏') || text.includes('登录') || text.includes('注册')) {
      console.log(`-> Clicking: "${text.trim()}"`);
      await b.click();
      break;
    }
  }

  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
  console.log('Current URL after click:', page.url());
  console.log('Current Body text sample:\n', (await page.evaluate(() => document.body.innerText)).slice(0, 400));

  await browser.close();
}

diagnose();
