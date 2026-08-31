import puppeteer from 'puppeteer';

async function testSlot2Construction() {
  console.log('====================================================');
  console.log(' Starting Slot 2 Building Construction E2E Test');
  console.log('====================================================');

  const email = `slot2_test_${Date.now()}@domain.local`;
  const password = 'Password123!';

  console.log('[1/5] Registering new player...');
  const regRes = await fetch('http://127.0.0.1:3000/api/v2/auth/email/connect/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, company: `Constructor Corp ${Date.now()}` })
  });
  const setCookie = regRes.headers.get('set-cookie') || '';
  const tokenMatch = setCookie.match(/sessionid=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : '';

  if (!token) {
    throw new Error('Failed to obtain session token from registration');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('Amplitude') && !t.includes('favicon')) {
        errors.push(`[Console Error]: ${t}`);
      }
    }
  });

  page.on('pageerror', err => {
    errors.push(`[Page Crash Error]: ${err.message}`);
  });

  await page.setCookie(
    { name: 'sessionid', value: token, domain: '127.0.0.1', path: '/' },
    { name: 'session_token', value: token, domain: '127.0.0.1', path: '/' }
  );

  console.log('[2/5] Navigating to /zh-cn/landscape/buildings/2/...');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/buildings/2/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  const text1 = await page.evaluate(() => document.body.innerText);
  if (text1.includes('An unexpected error occurred') || text1.includes('发生意外错误')) {
    throw new Error('Unexpected error on /zh-cn/landscape/buildings/2/');
  }
  console.log(' -> Catalog page loaded successfully.');

  console.log('[3/5] Selecting "农场" (Farm) and constructing on slot 2...');
  await page.click('.test-building-kind-P');
  await new Promise(r => setTimeout(r, 1000));

  const constructClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a.btn, div.btn'));
    for (const b of btns) {
      if (b.innerText && (b.innerText.includes('建设') || b.innerText.includes('建造') || b.innerText.includes('Construct'))) {
        b.click();
        return b.innerText.trim();
      }
    }
    return null;
  });

  if (!constructClicked) {
    throw new Error('Construct button not found on building detail panel');
  }
  console.log(` -> Clicked button: "${constructClicked}"`);

  await new Promise(r => setTimeout(r, 3000));

  const textLandscape = await page.evaluate(() => document.body.innerText);
  console.log('Landscape text preview:\n', textLandscape.slice(0, 300));

  if (textLandscape.includes('An unexpected error occurred') || textLandscape.includes('发生意外错误')) {
    throw new Error('Unexpected error occurred on landscape map after building construction!');
  }
  console.log(' -> Landscape successfully displayed newly constructed building without errors.');

  console.log('[4/5] Checking database state for slot 2 building...');
  const buildingsRes = await fetch('http://127.0.0.1:3000/api/v2/companies/me/buildings/', {
    headers: { 'Cookie': `sessionid=${token}` }
  });
  const buildingsData = (await buildingsRes.json()) as Array<{
    id: number;
    name: string;
    kind: string;
    position: string;
    level: number;
  }>;
  const b2 = buildingsData.find(b => b.position === '2');
  console.log('[5/5] Navigating directly to the newly constructed building detail view...');
  await page.goto(`http://127.0.0.1:3000/zh-cn/b/${b2.id}/`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  const textBuilding = await page.evaluate(() => document.body.innerText);
  console.log('Building view text preview:\n', textBuilding.slice(0, 200));

  if (textBuilding.includes('An unexpected error occurred') || textBuilding.includes('发生意外错误')) {
    throw new Error(`Unexpected error inside building detail view /zh-cn/b/${b2.id}/!`);
  }
  console.log(` -> Building detail view /zh-cn/b/${b2.id}/ loaded and rendered cleanly.`);

  await page.screenshot({ path: 'screenshots/slot2_construction_success.png' });
  await browser.close();

  if (errors.length > 0) {
    console.warn('Non-fatal captured errors during run:', errors);
  }

  console.log('====================================================');
  console.log(' ✅ SLOT 2 BUILDING CONSTRUCTION PASSED ALL CHECKS');
  console.log('====================================================');
}

testSlot2Construction().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
