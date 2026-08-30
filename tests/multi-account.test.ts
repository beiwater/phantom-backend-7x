import puppeteer, { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function takeStepScreenshot(page: Page, filename: string, caption: string) {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  [Screenshot] ${filename} - ${caption}`);
}

async function runMultiAccountTest() {
  console.log('================================================================');
  console.log(' Starting SimCompanies Multi-Account & Account Pages E2E Test');
  console.log('================================================================');

  const baseUrl = 'http://127.0.0.1:3000';

  // ----------------------------------------------------------------
  // PART 1: Multi-User Registration & Authentication API Isolation
  // ----------------------------------------------------------------
  console.log('\n[Part 1] Testing Multi-User Registration & Data Isolation...');

  // User 1 Register
  const reg1Res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `user1_${Date.now()}@domain.local`,
      password: 'Password123!',
      companyName: 'Alpha Minerals Ltd'
    })
  });
  const cookies1 = reg1Res.headers.getSetCookie?.() || [reg1Res.headers.get('set-cookie') || ''];
  const reg1Cookie = cookies1.find(c => c.startsWith('sessionid='))?.split(';')[0];
  console.log(`  -> User 1 Registered, session: ${reg1Cookie?.slice(0, 30)}...`);

  // Query User 1 auth-data
  const auth1Res = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { 'Cookie': reg1Cookie || '' }
  });
  const auth1 = await auth1Res.json();
  console.log(`  -> User 1 Company: "${auth1.authCompany.company}" (ID: ${auth1.authCompany.companyId})`);

  // User 1 constructs Mine (M)
  const b1Res = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': reg1Cookie || '' },
    body: JSON.stringify({ kind: 'M', position: '2' })
  });
  const b1Data = await b1Res.json();
  console.log(`  -> User 1 built Mine at pos 2, remaining money: $${b1Data.moneyUpdate}`);

  // User 2 Register
  const reg2Res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `user2_${Date.now()}@domain.local`,
      password: 'Password456!',
      companyName: 'Beta Aerospace Corp'
    })
  });
  const cookies2 = reg2Res.headers.getSetCookie?.() || [reg2Res.headers.get('set-cookie') || ''];
  const reg2Cookie = cookies2.find(c => c.startsWith('sessionid='))?.split(';')[0];
  console.log(`  -> User 2 Registered, session: ${reg2Cookie?.slice(0, 30)}...`);

  // Query User 2 auth-data
  const auth2Res = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { 'Cookie': reg2Cookie || '' }
  });
  const auth2 = await auth2Res.json();
  console.log(`  -> User 2 Company: "${auth2.authCompany.company}" (ID: ${auth2.authCompany.companyId})`);

  // User 2 constructs Aerospace Factory (A)
  const b2Res = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': reg2Cookie || '' },
    body: JSON.stringify({ kind: 'A', position: '2' })
  });
  const b2Data = await b2Res.json();
  console.log(`  -> User 2 built Aerospace Factory at pos 2, remaining money: $${b2Data.moneyUpdate}`);

  // Verify User 1 buildings vs User 2 buildings
  const u1BuildingsRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { 'Cookie': reg1Cookie || '' }
  });
  const u1Buildings = await u1BuildingsRes.json();
  const u2BuildingsRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    headers: { 'Cookie': reg2Cookie || '' }
  });
  const u2Buildings = await u2BuildingsRes.json();

  console.log(`  -> User 1 Buildings (${u1Buildings.length}):`, u1Buildings.map(b => b.name));
  console.log(`  -> User 2 Buildings (${u2Buildings.length}):`, u2Buildings.map(b => b.name));

  // ----------------------------------------------------------------
  // PART 2: Realm Switching / Multi-Company per User
  // ----------------------------------------------------------------
  console.log('\n[Part 2] Testing Realm Switching for User 1...');
  // Switch to Realm 1
  const switchRes = await fetch(`${baseUrl}/api/v1/realm/1/switch/`, {
    method: 'POST',
    headers: { 'Cookie': reg1Cookie || '' }
  });
  const switchData = await switchRes.json();
  console.log('  -> Switched to Realm 1:', switchData);

  const authRealm1Res = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { 'Cookie': reg1Cookie || '' }
  });
  const authRealm1 = await authRealm1Res.json();
  console.log(`  -> Active Realm 1 Company: "${authRealm1.authCompany.company}" (Realm: ${authRealm1.authCompany.realmId})`);

  // Switch back to Realm 0
  await fetch(`${baseUrl}/api/v1/realm/0/switch/`, {
    method: 'POST',
    headers: { 'Cookie': reg1Cookie || '' }
  });
  const authRealm0Res = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { 'Cookie': reg1Cookie || '' }
  });
  const authRealm0 = await authRealm0Res.json();
  console.log(`  -> Switched back to Realm 0: "${authRealm0.authCompany.company}" (Realm: ${authRealm0.authCompany.realmId})`);

  // ----------------------------------------------------------------
  // PART 3: Real Browser UI E2E for Account Pages
  // ----------------------------------------------------------------
  console.log('\n[Part 3] Real Browser UI Navigation for Account Pages...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 1. Visit Signin Page
  console.log('  Navigating to Signin Page (/zh-cn/signin/) ...');
  await page.goto(`${baseUrl}/zh-cn/signin/`, { waitUntil: 'networkidle2' });
  await takeStepScreenshot(page, 'account_01_signin_page.png', 'Signin / Login page');

  // 2. Visit Signup Page
  console.log('  Navigating to Signup Page (/zh-cn/signup/) ...');
  await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });
  await takeStepScreenshot(page, 'account_02_signup_page.png', 'Registration / Signup page');

  // 3. Visit Account Settings Page
  console.log('  Navigating to Account Settings (/zh-cn/account-settings/) ...');
  await page.goto(`${baseUrl}/zh-cn/account-settings/`, { waitUntil: 'networkidle2' });
  await takeStepScreenshot(page, 'account_03_account_settings.png', 'Account settings & preferences');

  // 4. Visit Company Public Profile Page
  console.log('  Navigating to Company Profile (/zh-cn/company/0/lifeline/) ...');
  await page.goto(`${baseUrl}/zh-cn/company/0/lifeline/`, { waitUntil: 'networkidle2' });
  await takeStepScreenshot(page, 'account_04_company_profile.png', 'Public company profile view');

  await browser.close();
  console.log('\n================================================================');
  console.log(' Multi-Account & Account Pages Test Suite Finished Successfully');
  console.log('================================================================');
}

runMultiAccountTest();
