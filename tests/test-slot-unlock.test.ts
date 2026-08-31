import puppeteer from 'puppeteer';

type AuthCompany = {
  simBoosts: number;
  extraBuildingSlots: number;
};

type AuthData = {
  authCompany: AuthCompany;
};

function isAuthData(value: unknown): value is AuthData {
  if (typeof value !== 'object' || value === null || !('authCompany' in value)) {
    return false;
  }
  const company = value.authCompany;
  if (typeof company !== 'object' || company === null) {
    return false;
  }
  const record = company as Record<string, unknown>;
  return typeof record.simBoosts === 'number' && typeof record.extraBuildingSlots === 'number';
}

async function testSlotUnlock() {
  const baseUrl = 'http://127.0.0.1:3000';
  const email = `unlock_test_${Date.now()}@domain.local`;
  const password = 'Password123!';

  console.log('====================================================');
  console.log(' Starting Building Slot Unlock E2E Test');
  console.log('====================================================');

  console.log('[1/7] Checking that unauthenticated unlocks are rejected...');
  const unauthenticated = await fetch(`${baseUrl}/api/v2/unlock/`, { method: 'POST' });
  if (unauthenticated.status !== 401) {
    throw new Error(`Expected unauthenticated unlock to return 401, got ${unauthenticated.status}`);
  }

  console.log('[2/7] Registering new player with SimBoosts...');
  const regRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, company: 'Unlocker Corp' })
  });
  if (!regRes.ok) {
    throw new Error(`Registration failed with HTTP ${regRes.status}`);
  }
  const setCookie = regRes.headers.get('set-cookie') || '';
  const tokenMatch = setCookie.match(/sessionid=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : '';
  if (!token) {
    throw new Error('No session token');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors: string[] = [];
  let unlockRequests = 0;
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Amplitude') && !text.includes('favicon')) {
        errors.push(`[Console Error]: ${text}`);
      }
    }
  });
  page.on('pageerror', err => {
    errors.push(`[Page Error]: ${err.message}`);
  });
  page.on('request', request => {
    if (request.url() === `${baseUrl}/api/v2/unlock/` && request.method() === 'POST') {
      unlockRequests += 1;
    }
  });

  await page.setCookie({ name: 'sessionid', value: token, domain: '127.0.0.1', path: '/' });

  const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
  const getAuthCompany = async (): Promise<AuthCompany> => {
    const response = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
      headers: { Cookie: `sessionid=${token}` }
    });
    if (!response.ok) {
      throw new Error(`Auth data request failed with HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!isAuthData(payload)) {
      throw new Error(`Invalid auth data response: ${JSON.stringify(payload)}`);
    }
    return payload.authCompany;
  };

  const clickLockedSlot = async (): Promise<string> => {
    const label = await page.evaluate(() => {
      const leaves = Array.from(document.querySelectorAll('*')).filter(element => {
        const text = element.textContent?.trim() || '';
        return element.children.length === 0 && text.includes('解锁');
      });
      const leaf = leaves[0];
      if (!leaf) {
        return null;
      }
      let target = leaf as HTMLElement;
      while (target.parentElement && target.tagName !== 'BUTTON' && target.tagName !== 'DIV') {
        target = target.parentElement;
      }
      target.click();
      return leaf.textContent?.trim() || '解锁';
    });
    if (!label) {
      throw new Error('No locked building slot was found');
    }
    await delay(800);
    return label;
  };

  const modalText = async (): Promise<string> => page.evaluate(() => document.body.innerText);

  const clickModalConfirm = async (): Promise<void> => {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button.btn-primary, .modal-dialog button, div[role="dialog"] button')) as HTMLElement[];
      const button = buttons.find(candidate => {
        const text = candidate.innerText.trim();
        return text === '解锁' || text === '确定' || text === 'Unlock' || text === 'Yes';
      });
      if (!button) {
        return false;
      }
      button.click();
      return true;
    });
    if (!clicked) {
      throw new Error('Unlock modal confirmation button was not found');
    }
    await delay(1800);
  };

  const clickModalCancel = async (): Promise<void> => {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, .btn')) as HTMLElement[];
      const button = buttons.find(candidate => {
        const text = candidate.innerText.trim();
        return text === '算了吧' || text === '取消' || text === 'Cancel';
      });
      if (!button) {
        return false;
      }
      button.click();
      return true;
    });
    if (!clicked) {
      await page.keyboard.press('Escape');
      await delay(500);
      if ((await modalText()).includes('解锁多个地块')) {
        throw new Error(`Unlock modal could not be closed. Body: ${await modalText()}`);
      }
      return;
    }
    await delay(500);
  };

  console.log('[3/7] Opening the landscape map and checking the locked-slot modal...');
  await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2' });
  await delay(1200);
  const initialText = await modalText();
  if (initialText.includes('An unexpected error occurred') || initialText.includes('发生意外错误')) {
    throw new Error('Landscape map rendered an unexpected error before unlock');
  }

  const initialCompany = await getAuthCompany();
  if (initialCompany.simBoosts !== 250 || initialCompany.extraBuildingSlots !== 0) {
    throw new Error(`Unexpected initial slot state: ${JSON.stringify(initialCompany)}`);
  }

  const firstLockedLabel = await clickLockedSlot();
  const firstModalText = await modalText();
  if (!firstModalText.includes('解锁多个地块') || !firstModalText.includes('50')) {
    throw new Error(`First unlock modal did not show the expected 50 SimBoost cost: ${firstModalText}`);
  }
  console.log(` -> Opened first locked slot (${firstLockedLabel}); cancelling without spending.`);
  await clickModalCancel();
  if ((await modalText()).includes('解锁多个地块')) {
    throw new Error('Unlock modal remained open after cancellation');
  }
  const afterCancel = await getAuthCompany();
  if (afterCancel.simBoosts !== 250 || afterCancel.extraBuildingSlots !== 0 || unlockRequests !== 0) {
    throw new Error(`Cancel changed slot state or sent a request: ${JSON.stringify(afterCancel)}, requests=${unlockRequests}`);
  }

  console.log('[4/7] Confirming the first unlock (50 SimBoosts)...');
  await clickLockedSlot();
  if (!(await modalText()).includes('50')) {
    throw new Error('First unlock confirmation did not show 50 SimBoosts');
  }
  await clickModalConfirm();
  const afterFirstUnlock = await getAuthCompany();
  if (afterFirstUnlock.simBoosts !== 200 || afterFirstUnlock.extraBuildingSlots !== 1 || unlockRequests !== 1) {
    throw new Error(`First unlock state is incorrect: ${JSON.stringify(afterFirstUnlock)}, requests=${unlockRequests}`);
  }
  const afterFirstText = await modalText();
  if (afterFirstText.includes('An unexpected error occurred') || afterFirstText.includes('发生意外错误') || !afterFirstText.includes('100')) {
    throw new Error('Landscape did not render the next 100-SimBoost locked slot cleanly');
  }
  console.log(' -> First slot unlocked; next locked slot now costs 100 SimBoosts.');

  console.log('[5/7] Confirming the second unlock (100 SimBoosts)...');
  await clickLockedSlot();
  const secondModalText = await modalText();
  if (!secondModalText.includes('解锁多个地块') || !secondModalText.includes('100')) {
    throw new Error(`Second unlock modal did not show the expected 100 SimBoost cost: ${secondModalText}`);
  }
  await clickModalConfirm();
  const afterSecondUnlock = await getAuthCompany();
  if (afterSecondUnlock.simBoosts !== 100 || afterSecondUnlock.extraBuildingSlots !== 2 || unlockRequests !== 2) {
    throw new Error(`Second unlock state is incorrect: ${JSON.stringify(afterSecondUnlock)}, requests=${unlockRequests}`);
  }
  const afterSecondText = await modalText();
  if (afterSecondText.includes('An unexpected error occurred') || afterSecondText.includes('发生意外错误')) {
    throw new Error('Landscape rendered an unexpected error after the second unlock');
  }
  console.log(' -> Second slot unlocked and persisted with 100 SimBoosts remaining.');

  console.log('[6/7] Checking insufficient-balance handling for the next 500-SimBoost slot...');
  await clickLockedSlot();
  const insufficientModalText = await modalText();
  if (!insufficientModalText.includes('500')) {
    throw new Error(`Next unlock modal did not show the 500 SimBoost cost: ${insufficientModalText}`);
  }
  await clickModalCancel();
  const insufficientResponse = await fetch(`${baseUrl}/api/v2/unlock/`, {
    method: 'POST',
    headers: { Cookie: `sessionid=${token}` }
  });
  if (insufficientResponse.status !== 400) {
    throw new Error(`Expected insufficient-balance unlock to return 400, got ${insufficientResponse.status}`);
  }
  const afterRejectedUnlock = await getAuthCompany();
  if (afterRejectedUnlock.simBoosts !== 100 || afterRejectedUnlock.extraBuildingSlots !== 2 || unlockRequests !== 2) {
    throw new Error(`Rejected unlock changed state: ${JSON.stringify(afterRejectedUnlock)}, requests=${unlockRequests}`);
  }

  console.log('[7/7] Verifying no browser errors were captured...');
  if (errors.length > 0) {
    throw new Error(`Browser errors during slot unlock flow: ${errors.join('; ')}`);
  }

  await page.screenshot({ path: 'screenshots/slot_unlock_success.png' });
  await browser.close();
  console.log('====================================================');
  console.log(' ✅ BUILDING SLOT UNLOCK PASSED ALL CHECKS');
  console.log('====================================================');
}

testSlotUnlock().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
