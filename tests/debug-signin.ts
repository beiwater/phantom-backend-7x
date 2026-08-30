import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    window.addEventListener('error', e => {
      console.log('=== WINDOW ERROR ===\n' + e.message + '\nAT ' + e.filename + ':' + e.lineno + ':' + e.colno + '\nSTACK:\n' + (e.error ? e.error.stack : 'no stack'));
    });
  });

  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR STACK:\n', err.stack));

  await page.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });
  await browser.close();
}

main();
