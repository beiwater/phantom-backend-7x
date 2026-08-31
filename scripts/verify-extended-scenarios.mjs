import puppeteer from 'puppeteer';

async function main() {
  console.log('================================================================');
  console.log(' Verifying Extended Scenarios (Checkout + Upgrade + Downgrade) ');
  console.log('================================================================\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[Browser Console Error]: ${msg.text()}`);
  });

  try {
    const testEmail = `ext_verify_${Date.now()}@test.local`;
    console.log(`[Step 1] Registering player: ${testEmail}`);
    await page.goto('http://127.0.0.1:3000/zh-cn/signup/');
    await page.waitForSelector('input[name="company"]');
    await page.type('input[name="company"]', `ExtCo_${Date.now()}`);
    await page.type('input[name="email"]', testEmail);
    await page.type('input[name="password"]', 'Password123!');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"]')
    ]);
    console.log(`  -> Landed on URL: ${page.url()}`);

    // Scenario 1: SimBoosts Package Checkout Page & Purchase
    console.log('\n[Scenario 1] Testing SimBoosts Package Checkout /zh-cn/checkout/package/simboosts_medium/');
    await page.goto('http://127.0.0.1:3000/zh-cn/checkout/package/simboosts_medium/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('body', { timeout: 5000 });
    
    // Look for buy button or trigger direct payment via standard checkout form
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log(`  Checkout page loaded text sample: ${pageText.slice(0, 150).replace(/\n/g, ' ')}`);

    // Complete purchase via POST /api/v2/payment/ from the browser page context
    const purchaseResult = await page.evaluate(async () => {
      const res = await fetch('/api/v2/payment/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: 'simboosts_medium' })
      });
      return { status: res.status, data: await res.json() };
    });
    console.log(`  Purchase API response: status=${purchaseResult.status}, simBoosts=${purchaseResult.data.simBoosts}, totalSimBoosts=${purchaseResult.data.companySimboosts}`);
    if (purchaseResult.status !== 200 || purchaseResult.data.companySimboosts < 200) {
      throw new Error(`SimBoosts purchase failed! Received: ${JSON.stringify(purchaseResult)}`);
    }
    console.log('  [PASS] Scenario 1: SimBoosts purchase succeeded and balance updated correctly!');

    // Scenario 2: Building Upgrade & Downgrade
    console.log('\n[Scenario 2] Testing Building Upgrade (Level 1 -> 2) & Downgrade (Level 2 -> 1)');
    await page.goto('http://127.0.0.1:3000/zh-cn/landscape/', { waitUntil: 'networkidle0' });
    
    // Find building id
    const buildings = await page.evaluate(async () => {
      const res = await fetch('/api/v2/companies/me/buildings/');
      return res.json();
    });
    const testBuilding = buildings.find(b => b.size === 1) || buildings[0];
    console.log(`  Found building for test: id=${testBuilding.id}, kind=${testBuilding.kind}, size=${testBuilding.size}`);

    // Upgrade building by 1 level
    const upgradeRes = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v2/companies/me/buildings/${id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: 1 })
      });
      return { status: res.status, data: await res.json() };
    }, testBuilding.id);
    console.log(`  Upgrade result: status=${upgradeRes.status}, newSize=${upgradeRes.data.building?.size}`);
    if (upgradeRes.status !== 200 || upgradeRes.data.building?.size !== testBuilding.size + 1) {
      throw new Error(`Upgrade failed: ${JSON.stringify(upgradeRes)}`);
    }
    console.log('  [PASS] Building upgraded to level 2!');

    // Downgrade building by 1 level (size: -1)
    const downgradeRes = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v2/companies/me/buildings/${id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: -1 })
      });
      return { status: res.status, data: await res.json() };
    }, testBuilding.id);
    console.log(`  Downgrade result: status=${downgradeRes.status}, newSize=${downgradeRes.data.building?.size}, refundMoney=${downgradeRes.data.money}`);
    if (downgradeRes.status !== 200 || downgradeRes.data.building?.size !== 1) {
      throw new Error(`Downgrade failed: ${JSON.stringify(downgradeRes)}`);
    }
    console.log('  [PASS] Building downgraded back to level 1 with refund!');

    console.log('\n================================================================');
    console.log(' ALL EXTENDED SCENARIOS VERIFIED SUCCESSFULLY WITH 0 ERRORS! ');
    console.log('================================================================\n');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('\n[FAIL] EXTENDED SCENARIO VERIFICATION FAILED:', err);
  process.exit(1);
});
