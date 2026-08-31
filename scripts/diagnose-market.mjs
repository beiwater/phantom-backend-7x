import puppeteer from 'puppeteer';

async function diagnoseMarket() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log(`[Console]:`, msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]:', err.message));
  page.on('response', async res => {
    if (res.status() >= 400 || res.url().includes('collectibles') || res.url().includes('government-orders') || res.url().includes('certificates') || res.url().includes('referrals') || res.url().includes('polls')) {
      console.log(`[HTTP ${res.status()}] ${res.url()}`);
      try {
        const text = await res.text();
        console.log('  Response:', text.slice(0, 300));
      } catch {}
    }
  });

  // Login
  await page.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });
  const emailInput = await page.$('input[type="email"]');
  const passwordInput = await page.$('input[type="password"]');
  if (emailInput && passwordInput) {
    await emailInput.type('admin@simcompanies.local');
    await passwordInput.type('admin123');
    await passwordInput.press('Enter');
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
  }

  console.log('\n--- 1. Testing /zh-cn/market/collectibles/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/market/collectibles/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  console.log('Collectibles Body Text:\n', await page.evaluate(() => document.body.innerText));

  console.log('\n--- 2. Testing /zh-cn/market/government-orders/0/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/market/government-orders/0/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  console.log('Government Orders Body Text:\n', await page.evaluate(() => document.body.innerText));

  console.log('\n--- 3. Testing /zh-cn/encyclopedia/0/certificates/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/encyclopedia/0/certificates/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  console.log('Certificates Body Text:\n', await page.evaluate(() => document.body.innerText));

  console.log('\n--- 4. Testing /zh-cn/referrals/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/referrals/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  console.log('Referrals Body Text:\n', await page.evaluate(() => document.body.innerText));

  console.log('\n--- 5. Testing /zh-cn/polls/1/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/polls/1/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  console.log('Polls Body Text:\n', await page.evaluate(() => document.body.innerText));

  await browser.close();
}

diagnoseMarket().catch(console.error);
