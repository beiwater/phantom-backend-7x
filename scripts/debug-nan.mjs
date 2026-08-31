import puppeteer from 'puppeteer';

async function debugNaN() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('response', async res => {
    if (res.url().includes('balance-sheet') || res.url().includes('income-statement') || res.url().includes('bonds') || res.url().includes('finance')) {
      try {
        console.log(`[API ${res.status()}] ${res.url()}`);
        const data = await res.json();
        console.log('  Payload:', JSON.stringify(data));
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

  console.log('\n--- Checking /zh-cn/headquarters/accounting/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/headquarters/accounting/', { waitUntil: 'networkidle2' });
  const accountingText = await page.evaluate(() => document.body.innerText);
  console.log('Accounting Text:\n', accountingText);

  const nanNodes = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue?.includes('NaN')) {
        nodes.push({
          parentTag: walker.currentNode.parentElement?.tagName,
          className: walker.currentNode.parentElement?.className,
          text: walker.currentNode.nodeValue,
          outerHTML: walker.currentNode.parentElement?.outerHTML
        });
      }
    }
    return nodes;
  });
  console.log('NaN Nodes in Accounting:', nanNodes);

  console.log('\n--- Checking /zh-cn/headquarters/finance/ ---');
  await page.goto('http://127.0.0.1:3000/zh-cn/headquarters/finance/', { waitUntil: 'networkidle2' });
  const financeText = await page.evaluate(() => document.body.innerText);
  console.log('Finance Text:\n', financeText);

  const nanNodesFinance = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue?.includes('NaN')) {
        nodes.push({
          parentTag: walker.currentNode.parentElement?.tagName,
          className: walker.currentNode.parentElement?.className,
          text: walker.currentNode.nodeValue,
          outerHTML: walker.currentNode.parentElement?.outerHTML
        });
      }
    }
    return nodes;
  });
  console.log('NaN Nodes in Finance:', nanNodesFinance);

  await browser.close();
}

debugNaN().catch(console.error);
