import puppeteer from 'puppeteer';
import path from 'node:path';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[Browser Error]:', msg.text());
  });

  console.log('Navigating to http://127.0.0.1:3000/zh-cn/ ...');
  await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 4000));

  const buttons = await page.$$eval('a, button', els =>
    els.map(e => ({
      tag: e.tagName,
      text: e.textContent?.trim() || '',
      href: e.getAttribute('href') || '',
      class: e.className
    })).filter(e => e.text.includes('lifeline') || e.text.includes('继续') || e.text.includes('进入'))
  );
  console.log('Found continue buttons:', buttons);

  // Click on the first link/button containing 'lifeline'
  const continueLink = await page.$('a[href*="realm"], a[href*="landscape"], button');
  const allLinks = await page.$$('a, button');
  for (const l of allLinks) {
    const text = await l.evaluate(el => el.textContent || '');
    if (text.includes('lifeline') || text.includes('继续')) {
      console.log(`Clicking button with text: "${text.trim()}"`);
      await l.click();
      break;
    }
  }

  await new Promise(r => setTimeout(r, 5000));
  console.log('Current URL after click:', page.url());
  await page.screenshot({ path: path.resolve('screenshots/after_click.png'), fullPage: true });
  console.log('Saved screenshot after_click.png');

  // Check top bar and game state
  const topText = await page.$$eval('*', els => els.map(e => e.textContent?.trim()).filter(Boolean).slice(0, 30));
  console.log('DOM sample after click:', topText.slice(0, 10));

  await browser.close();
}

main();
