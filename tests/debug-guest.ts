import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  page.on('console', msg => {
    console.log(`[Browser ${msg.type()}]:`, msg.text());
  });

  await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2' });

  const errorDetails = await page.evaluate(() => {
    // Look for error boundary rendered content
    const errorText = document.querySelector('pre, textarea, [class*="error"]')?.textContent || '';
    return {
      errorText,
      bodyText: document.body.innerText
    };
  });

  console.log('Error Details from page:\n', errorDetails.errorText || errorDetails.bodyText);

  await browser.close();
}

main();
