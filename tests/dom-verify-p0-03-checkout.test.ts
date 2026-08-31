/**
 * DOM-layer verification for P0-03 (checkout purchase) and P1-02 (realign
 * persists) using REAL visible controls on the served frontend at
 * http://127.0.0.1:<PORT>/zh-cn/ — no direct business-API calls, no
 * localStorage injection. State changes must come from clicking buttons and
 * typing into inputs, mirroring the mandated real-DOM regression rule.
 *
 * Run: PORT=3203 DATA_DIR=data/test-run-3203 node --experimental-strip-types tests/dom-verify-p0-03-checkout.test.ts
 */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '3203';
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(import.meta.dirname, '..');

async function launch() {
  const candidates = [
    path.join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell'),
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(p => fs.existsSync(p));
  assert.ok(candidates.length > 0, 'no chromium binary found');
  return puppeteer.launch({
    executablePath: candidates[0],
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900']
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Click a visible element by CSS/text search inside root. */
async function clickByText(page: any, selector: string, text: string) {
  const clicked = await page.evaluate((sel: string, txt: string) => {
    const els = Array.from(document.querySelectorAll(sel));
    const target = els.find(e => (e.textContent || '').trim().toLowerCase().includes(txt.toLowerCase())
      && (e as HTMLElement).offsetParent !== null);
    if (target) { (target as HTMLElement).click(); return true; }
    return false;
  }, selector, text);
  assert.ok(clicked, `no visible ${selector} containing "${text}"`);
}

async function bodyHas(page: any, text: string): Promise<boolean> {
  return page.evaluate((t: string) => document.body.innerText.includes(t), text);
}

async function run() {
  console.log('================================================================');
  console.log(' DOM Verification: checkout purchase updates visible balance');
  console.log(` Target: ${BASE}/zh-cn/`);
  console.log('================================================================');
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e: Error) => console.log('  [pageerror]', e.message.slice(0, 120)));

  // ---- Real signup through the visible form (creates a fresh company) ----
  console.log('[1/5] Signing up through the real signup DOM form...');
  await page.goto(`${BASE}/zh-cn/signup/`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(3000);
  // Dismiss the cookie banner through its own visible button.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(b => /仅限必要|全部接受/.test((b.textContent || '').trim()));
    if (b) (b as HTMLElement).click();
  });
  await sleep(1000);
  // Open the email form via the visible "使用邮箱地址" control.
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, a, span, div')).find(e =>
      /使用邮箱地址/.test((e.textContent || '').trim()) && (e as HTMLElement).offsetParent !== null
      && (e as HTMLElement).children.length === 0);
    if (el) (el as HTMLElement).click();
  });
  await sleep(2000);
  const emailInput = await page.$('input[type="email"]');
  assert.ok(emailInput, 'email input not found on signup page');
  await emailInput.type(`dom_${Date.now()}@test.local`);
  const pwInputs = await page.$$('input[type="password"]');
  assert.ok(pwInputs.length >= 1, 'password input missing');
  for (const p of pwInputs) { await p.type('Test12345!'); }
  await clickByText(page, 'button', '注册');
  await sleep(4500);
  console.log('  -> signup submitted through form');

  // Open the simboosts_large-equivalent package detail page.
  console.log('[2/5] Opening the SimBoosts checkout page via visible navigation...');
  await page.goto(`${BASE}/zh-cn/checkout/`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(3500);
  const pageText1 = await page.evaluate(() => document.body.innerText);
  // The catalog must render real prices from our packages endpoint.
  const catalogOk = /8\.22 AUD|14\.58 AUD|65\.52 AUD/.test(pageText1) && /150|330|1,900/.test(pageText1);
  assert.ok(catalogOk, 'package catalog (8.22/14.58 AUD estimates, SB counts) not rendered — catalog failed to load');
  console.log('  -> package grid rendered with real prices (HAR catalog)');

  console.log('[3/5] Entering a package detail page and reading the HUD balance...');
  await page.goto(`${BASE}/zh-cn/checkout/package/sb-sb330/`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(3500);
  const hudBefore = await page.evaluate(() => {
    // HUD top bar shows raw numbers: simboosts counter is the standalone digit group.
    const m = document.body.innerText.match(/(\d[\d,]*)\s*\n?\s*(?:购买SIM BOOSTS|$)/m)
      || document.body.innerText.match(/SIM BOOSTS?\n(\d[\d,]*)/i);
    return m ? m[1].replace(/,/g, '') : null;
  });
  assert.ok(hudBefore, 'could not read initial SimBoost count from HUD');
  const before = parseInt(hudBefore, 10);
  console.log(`  -> HUD SimBoosts before purchase: ${before}`);

  // Click the real buy/pay button rendered by Stripe Elements.
  console.log('[4/5] Clicking the pay button and watching the balance update...');
  const payClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = (b.textContent || '').trim();
      return /pay|支付|购买|buy/i.test(t) && b.offsetParent !== null;
    });
    if (btn) { btn.click(); return true; }
    return false;
  });
  assert.ok(payClicked, 'pay button not found on package page');
  await sleep(6000);
  const hudAfterText = await page.evaluate(() => document.body.innerText);
  const mAfter = hudAfterText.match(/(\d[\d,]*)\s*\n?\s*(?:购买SIM BOOSTS|$)/m)
    || hudAfterText.match(/SIM BOOSTS?\n(\d[\d,]*)/i);
  const after = mAfter ? parseInt(mAfter[1].replace(/,/g, ''), 10) : null;
  assert.ok(after !== null, 'could not read SimBoost count after purchase');
  assert.ok(after > before, `balance did not increase visually (${before} -> ${after})`);
  console.log(`  -> HUD SimBoosts after purchase: ${before} -> ${after} (+${after - before})`);

  // Refresh — balance must NOT roll back to the old value.
  console.log('[5/5] Refreshing the page: balance must persist...');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(4000);
  const hudRefresh = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d[\d,]*)\s*\n?\s*(?:购买SIM BOOSTS|$)/m)
      || document.body.innerText.match(/SIM BOOSTS?\n(\d[\d,]*)/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  });
  assert.ok(hudRefresh !== null, 'could not read balance after refresh');
  assert.ok(hudRefresh >= after, `balance rolled back on refresh: ${after} -> ${hudRefresh}`);
  console.log(`  -> after refresh HUD shows ${hudRefresh} (persisted, no rollback)`);
  console.log(' DOM VERIFICATION PASSED: real purchase flow updates the');
  console.log(' visible balance immediately and it survives refresh.');
  console.log('================================================================');
}

run().catch(err => {
  console.error('❌ DOM verification failed:', err.message);
  process.exit(1);
});
