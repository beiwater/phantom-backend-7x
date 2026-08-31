import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const baseUrl = 'http://127.0.0.1:3000';

async function runAvatarProfileTest() {
  const suffix = Date.now();
  const companyName = `Avatar/Smoke ${suffix}`;
  const registration = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `avatar_route_${suffix}@domain.local`,
      password: 'Password123!',
      name: companyName
    })
  });
  assert.equal(registration.status, 200);

  const cookies = registration.headers.getSetCookie?.() || [registration.headers.get('set-cookie') || ''];
  const sessionCookie = cookies.find(cookie => cookie.startsWith('sessionid='))?.split(';')[0];
  assert.ok(sessionCookie, 'registration did not return a session cookie');
  const sessionValue = sessionCookie.slice('sessionid='.length);

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: sessionCookie }
  });
  const authData = await authResponse.json() as { authCompany: { company: string; companyId: number } };
  assert.equal(authResponse.status, 200);
  assert.equal(authData.authCompany.company, `Avatar-Smoke ${suffix}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.stack || String(error)));

  try {
    await page.setCookie({
      name: 'sessionid',
      value: sessionValue,
      domain: '127.0.0.1',
      path: '/'
    });
    await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('nav a[aria-label="简介"]', { timeout: 10000 });

    const avatarHref = await page.$eval('nav a[aria-label="简介"]', element => element.getAttribute('href'));
    assert.equal(avatarHref, `/zh-cn/company/0/Avatar-Smoke-${suffix}/`);

    const avatar = await page.$('nav a[aria-label="简介"]');
    assert.ok(avatar, 'avatar link is missing');
    pageErrors.length = 0;
    await avatar.click();
    await page.waitForSelector('h1', { timeout: 10000 });

    assert.match(page.url(), /\/zh-cn\/company\/0\/Avatar-Smoke-/);
    assert.ok((await page.$eval('body', body => body.textContent || '')).includes(companyName));
    assert.doesNotMatch(await page.$eval('body', body => body.textContent || ''), /网页定向无结果/);
    assert.deepEqual(pageErrors, []);

    console.log('AVATAR PROFILE PASSED');
  } finally {
    await browser.close();
  }
}

runAvatarProfileTest().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
