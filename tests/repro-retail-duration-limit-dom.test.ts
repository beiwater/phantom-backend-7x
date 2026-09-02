/**
 * Browser/DOM reproduction for the retail duration-limit error.
 *
 * Prerequisites:
 *   - a running server (default http://127.0.0.1:3000)
 *   - an authenticated session, or TEST_EMAIL/TEST_PASSWORD for UI login
 *   - a level-60 company with Fashion store building 34 and underwear stock
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3000 \
 *   TEST_EMAIL='...' TEST_PASSWORD='...' \
 *   node --experimental-strip-types tests/repro-retail-duration-limit-dom.test.ts
 *
 * This deliberately uses visible-page DOM actions only. It does not call the
 * retail API directly and does not mutate the server source.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const BUILDING_URL = `${BASE_URL}/zh-cn/b/34/`;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
page.setViewport({ width: 1440, height: 900 });

try {
  await page.goto(BUILDING_URL, { waitUntil: 'networkidle2' });

  // Reuse an existing browser session when available. Otherwise log in using
  // the same form a player uses in the browser.
  if ((await page.$('input[type="email"], input[name="email"]')) && email && password) {
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (!emailInput || !passwordInput) throw new Error('Login form inputs not found');
    await emailInput.type(email);
    await passwordInput.type(password);
    await passwordInput.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await page.goto(BUILDING_URL, { waitUntil: 'networkidle2' });
  }

  await page.waitForFunction(() => document.body.innerText.includes('FASHION STORE'), { timeout: 10000 });
  await new Promise(resolve => setTimeout(resolve, 1000));

  const quantity = await page.$('input[name="amount"], input[name="quantity"]');
  const numberInputs = await page.$$('input[type="number"]');
  const quantityInput = quantity || numberInputs[0];
  const priceInput = numberInputs[1];
  if (!quantityInput || !priceInput) {
    throw new Error('Retail quantity/price inputs were not rendered. The page may be stuck in the retail-data loading state.');
  }

  // DOM actions matching the user repro: underwear, 2,663 units, price $10.
  await quantityInput.click({ clickCount: 3 });
  await quantityInput.type('2663');
  await priceInput.click({ clickCount: 3 });
  await priceInput.type('10');
  await page.keyboard.press('Tab');
  await new Promise(resolve => setTimeout(resolve, 500));

  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasGenericError = bodyText.includes('An unexpected error occurred');
  const hasActionableDurationError = /duration|48.?hours|48.?小?时|队列/.test(bodyText);
  const artifactDir = path.resolve('artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, 'repro-retail-duration-limit.png'), fullPage: false });
  fs.writeFileSync(path.join(artifactDir, 'repro-retail-duration-limit-dom.txt'), bodyText);

  console.log(JSON.stringify({
    url: page.url(),
    quantity: 2663,
    price: 10,
    hasGenericError,
    hasActionableDurationError,
    result: hasGenericError && !hasActionableDurationError ? 'REPRODUCED' : 'NOT_REPRODUCED'
  }, null, 2));

  if (!hasGenericError) process.exitCode = 1;
} finally {
  await browser.close();
}
