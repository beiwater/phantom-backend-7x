import puppeteer from 'puppeteer';

async function reproduce() {
  const email = `test_construct_${Date.now()}@domain.local`;
  const password = 'Password123!';

  console.log('1. Registering user via API...');
  const regRes = await fetch('http://127.0.0.1:3000/api/v2/auth/email/connect/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, company: 'Builder Corp' })
  });
  const regData = await regRes.json();
  const setCookie = regRes.headers.get('set-cookie') || '';
  const tokenMatch = setCookie.match(/sessionid=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : '';

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => {
    console.log(`[Browser Console ${msg.type()}]:`, msg.text());
  });

  page.on('pageerror', err => {
    console.error(`[Browser PageError]:`, err.message);
    if (err.stack) console.error(err.stack);
  });

  page.on('requestfailed', req => {
    console.error(`[Browser RequestFailed]: ${req.url()} (${req.failure()?.errorText})`);
  });

  page.on('request', req => {
    if (req.url().includes('/buildings') || req.method() === 'POST' || req.method() === 'PATCH') {
      console.log(`[Request ${req.method()}]: ${req.url()} (postData: ${req.postData()})`);
    }
  });

  page.on('response', async res => {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {}
    if (res.status() >= 400) {
      console.error(`[HTTP ${res.status()} ${res.request().method()}]: ${res.url()} -> ${bodyText.slice(0, 500)}`);
    } else if (res.url().includes('/buildings') || res.request().method() === 'POST' || res.request().method() === 'PATCH') {
      console.log(`[HTTP ${res.status()} ${res.request().method()}]: ${res.url()} -> ${bodyText.slice(0, 300)}`);
    }
  });

  await page.setCookie(
    { name: 'sessionid', value: token, domain: '127.0.0.1', path: '/' },
    { name: 'session_token', value: token, domain: '127.0.0.1', path: '/' }
  );

  console.log('2. Navigating to /zh-cn/landscape/buildings/2/...');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/buildings/2/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  console.log('3. Clicking on 农场 button...');
  await page.click('.test-building-kind-P');
  await new Promise(r => setTimeout(r, 1500));

  console.log('4. Clicking "建设农场" button...');
  const clickedBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, div[role="button"], a.btn, div.btn'));
    for (const b of btns) {
      if (b.innerText && (b.innerText.includes('建设') || b.innerText.includes('建造') || b.innerText.includes('Construct'))) {
        b.click();
        return `Clicked: ${b.innerText}`;
      }
    }
    return 'Not found';
  });
  console.log('Clicked result:', clickedBtn);
  await new Promise(r => setTimeout(r, 3000));

  console.log('5. Page content after construction click:');
  const textAfter = await page.evaluate(() => document.body.innerText);
  console.log(textAfter);

  await page.screenshot({ path: 'screenshots/after_construct_click.png' });
  await browser.close();
}

reproduce().catch(console.error);
