import puppeteer from 'puppeteer';

async function runAuthTests() {
  console.log('====================================================');
  console.log(' Starting Auth & Registration E2E Verification Suite');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  // Test Case 1: Sign in with existing default player admin@simcompanies.local
  console.log('\n[Test 1] Login with seeded admin account on /zh-cn/signin/...');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });

    // Dismiss cookie
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('全部接受') || text.includes('仅限必要')) {
        await b.click();
        break;
      }
    }

    const emailInput = await page.$('input[type="email"]');
    const passwordInput = await page.$('input[type="password"]');
    if (!emailInput || !passwordInput) {
      throw new Error('Email or password inputs not found on /zh-cn/signin/');
    }

    await emailInput.type('admin@simcompanies.local');
    await passwordInput.type('admin123');

    // Click login button or press Enter
    await passwordInput.press('Enter');
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});

    console.log('  -> URL after Login:', page.url());
    if (!page.url().includes('/landscape/')) {
      throw new Error(`Expected redirect to /landscape/, but got ${page.url()}`);
    }
    console.log('  [PASS] Test 1: Admin signin successful.');
    await page.close();
  }

  // Test Case 2: Register a brand new player on /zh-cn/signup/ with email and password
  console.log('\n[Test 2] Register brand new player via /zh-cn/signup/...');
  {
    const uniqueEmail = `player_${Date.now()}@testing.local`;
    const uniquePass = 'StrongPass123!';
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:3000/zh-cn/signup/', { waitUntil: 'networkidle2' });

    // Click "使用邮箱地址"
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
        await b.click();
        break;
      }
    }
    await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});

    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (!emailInput || !passwordInput) {
      throw new Error('Signup form inputs not found');
    }

    await emailInput.type(uniqueEmail);
    await passwordInput.type(uniquePass);

    // Submit form
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('开始游戏') || text.includes('注册')) {
        await b.click();
        break;
      }
    }
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});

    console.log('  -> URL after Signup:', page.url());
    if (!page.url().includes('/landscape/')) {
      throw new Error(`Expected redirect to /landscape/, but got ${page.url()}`);
    }
    console.log(`  [PASS] Test 2: Registered new user ${uniqueEmail} successfully.`);

    // Test Case 3: Re-login with the newly created player on /zh-cn/signin/
    console.log('\n[Test 3] Re-login with newly registered user on /zh-cn/signin/...');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1440, height: 900 });

    // Clear cookies on page2 to simulate fresh session
    await page2.goto('http://127.0.0.1:3000/zh-cn/signout/', { waitUntil: 'networkidle2' });
    await page2.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });

    const emailInput2 = await page2.$('input[type="email"]');
    const passwordInput2 = await page2.$('input[type="password"]');
    await emailInput2.type(uniqueEmail);
    await passwordInput2.type(uniquePass);
    await passwordInput2.press('Enter');

    await page2.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    console.log('  -> URL after Re-login:', page2.url());
    if (!page2.url().includes('/landscape/')) {
      throw new Error(`Expected redirect to /landscape/, but got ${page2.url()}`);
    }
    console.log('  [PASS] Test 3: Re-login successful with persisted credentials.');

    await page.close();
    await page2.close();
  }

  // Test Case 4: Guest one-click "开始游戏" on Landing Page
  console.log('\n[Test 4] Guest 1-Click "开始游戏" on Landing Page /zh-cn/...');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:3000/zh-cn/signout/', { waitUntil: 'networkidle2' });
    await page.goto('http://127.0.0.1:3000/zh-cn/', { waitUntil: 'networkidle2' });
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('全部接受') || text.includes('仅限必要')) {
        await b.click();
        break;
      }
    }

    // Submit "开始游戏" form (which triggers full page 302 redirect)
    const formSubmitBtn = await page.$('form[action*="tutorial"] button[type="submit"], form button[type="submit"]');
    if (formSubmitBtn) {
      console.log('  -> Submitting start tutorial / guest play form...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
        formSubmitBtn.click()
      ]);
    } else {
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
          submitBtn.click()
        ]);
      }
    }

    console.log('  -> URL after 1-Click Play:', page.url());
    if (!page.url().includes('/landscape/')) {
      throw new Error(`Expected redirect to /landscape/, but got ${page.url()}`);
    }
    console.log('  [PASS] Test 4: Guest 1-click play successful.');
    await page.close();
  }
  // Test Case 5: Clicking "没有账号吗？" on /zh-cn/signin/
  console.log('\n[Test 5] Clicking "没有账号吗？" on /zh-cn/signin/...');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:3000/zh-cn/signout/', { waitUntil: 'networkidle2' });
    await page.goto('http://127.0.0.1:3000/zh-cn/signin/', { waitUntil: 'networkidle2' });

    // Click "没有账号吗？"
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('没有账号')) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
          b.click()
        ]);
        break;
      }
    }
    console.log('  -> URL after "没有账号吗？":', page.url());
    if (!page.url().includes('/landscape/')) {
      throw new Error(`Expected redirect to /landscape/, but got ${page.url()}`);
    }
    console.log('  [PASS] Test 5: "没有账号吗？" onboarding successful.');
    await page.close();
  }

  await browser.close();
  console.log('\n====================================================');
  console.log(' ALL 5 AUTH & REGISTRATION TESTS PASSED PERFECTLY!');
  console.log('====================================================');
}

runAuthTests().catch(err => {
  console.error('\n❌ AUTH TEST FAILED:', err);
  process.exit(1);
});
