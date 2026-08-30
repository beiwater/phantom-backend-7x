import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('pageerror', err => {
    console.log('=== PAGE ERROR STACK ===\n', err.stack);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('=== CONSOLE ERROR ===\n', msg.text());
    }
  });

  await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 4000));
  await browser.close();
}

main();
