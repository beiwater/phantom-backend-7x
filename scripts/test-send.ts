import puppeteer from 'puppeteer';

const baseUrl = 'http://127.0.0.1:3000';

async function main() {
  const email = `send_test_${Date.now()}@domain.local`;
  const res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `SendTester ${Date.now()}` })
  });
  const rawCookie = (res.headers.getSetCookie?.() || []).find(c => c.startsWith('sessionid='));
  if (!rawCookie) throw new Error('No cookie');
  const sessionid = rawCookie.split(';')[0].split('=')[1];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setCookie({ name: 'sessionid', value: sessionid, domain: '127.0.0.1', path: '/' });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('request', req => {
    if (req.url().includes('/api/')) console.log('REQ:', req.method(), req.url());
  });
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log('RES:', res.status(), res.url());
  });

  await page.goto(`${baseUrl}/zh-cn/messages/chatroom_Game/`, { waitUntil: 'networkidle2' });
  const rulesOk = await page.$('.js-test-chat-rules-ok');
  if (rulesOk) await rulesOk.click();
  await page.waitForSelector('textarea', { timeout: 5000 });

  console.log('--- 1. Typing message ---');
  await page.focus('textarea');
  await page.type('textarea', 'Hello World Send Test');

  console.log('--- 2. Checking buttons ---');
  const buttons = await page.$$('button');
  console.log(`Found ${buttons.length} buttons on page`);
  for (let i = 0; i < buttons.length; i++) {
    const html = await page.evaluate(el => el.outerHTML, buttons[i]);
    console.log(`Button ${i}:`, html);
  }

  // Click the last button (the paper plane button)
  if (buttons.length > 0) {
    const lastBtn = buttons[buttons.length - 1];
    console.log('--- 3. Clicking last button ---');
    await lastBtn.click();
  }

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
}

main().catch(console.error);
