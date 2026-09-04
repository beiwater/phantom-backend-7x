async function runTests() {
  const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
  const auth = await fetch(`${base}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `route_probe_${Date.now()}@simcompanies.local`,
      password: 'Password123!',
      company: `Route Probe ${Date.now()}`
    })
  });
  if (!auth.ok) {
    throw new Error(`Test session bootstrap failed: ${auth.status}`);
  }
  const setCookie = auth.headers.get('set-cookie');
  const cookie = setCookie?.split(';', 1)[0];
  if (!cookie) {
    throw new Error('Test session bootstrap did not return a cookie');
  }
  const authDataResponse = await fetch(`${base}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  if (!authDataResponse.ok) {
    throw new Error(`Authenticated company bootstrap failed: ${authDataResponse.status}`);
  }
  const authData = await authDataResponse.json() as {
    authCompany?: { companyId?: number; realmId?: number; company?: string };
  };
  const authCompany = authData.authCompany;
  if (!authCompany?.companyId || authCompany.realmId === undefined || !authCompany.company) {
    throw new Error('Authenticated company bootstrap returned incomplete authCompany');
  }
  const companySlug = authCompany.company.replace(/[\/\\\s]/g, '-');
  const companyLookupUrl =
    `/api/v2/company-lookup/${authCompany.companyId}/${authCompany.realmId}/${encodeURIComponent(companySlug)}/`;

  const endpoints = [
    { url: '/version/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/time-millis/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/fpa/custom-reports/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/administration-overhead/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/administration-overhead/plus-one/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/balance-sheet/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/income-statement/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/cashflow-statement/', method: 'GET', expectStatus: 200 },
    { url: '/api/v3/companies/me/past-finances/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/display-case/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/contracts-incoming/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/contracts-outgoing/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/contracts-history-incoming/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/contracts-history-outgoing/', method: 'GET', expectStatus: 200 },
    { url: companyLookupUrl, method: 'GET', expectStatus: 200 },
    { url: '/api/v2/contracts-history/999999999/', method: 'GET', expectStatus: 404 },
    { url: '/api/v2/warehouse-contracts-summary/me/1/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/market-ticker/', method: 'GET', expectStatus: 200 },
    { url: '/api/v3/market-ticker/0/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/market/limits/0/1/0/', method: 'GET', expectStatus: 200 },
    { url: '/api/v3/market/buy/0/1/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/market-collectibles/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/warehouse/tags/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/game-notifications/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/error-announcement/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/captcha/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/chatroom/N/from-id/1/', method: 'GET', expectStatus: 200 },
    { url: '/api/v4/0/0/encyclopedia/ranking/0/0/', method: 'GET', expectStatus: 200 },
    { url: '/api/v4/0/0/encyclopedia/eva-ranking/0/0/', method: 'GET', expectStatus: 200 },
    { url: '/api/v1/sales-orders/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/weather/0/', method: 'GET', expectStatus: 200 },
    { url: '/api/v3/contracts-outgoing/me/', method: 'GET', expectStatus: 200 },
    { url: '/api/v3/contracts-incoming/me/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/past-finances-overview/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/companies/me/game-notifications/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/help-chatroom/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/zh-cn/0/articles/top-by-reaction/1/', method: 'GET', expectStatus: 200 }
  ];

  let passed = 0;
  let failed = 0;

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${base}${ep.url}`, {
        method: ep.method,
        headers: { Cookie: cookie }
      });
      const text = await res.text();
      if (res.status === ep.expectStatus) {
        console.log(`[PASS] ${ep.method} ${ep.url} -> ${res.status}`);
        passed++;
      } else {
        console.error(`[FAIL] ${ep.method} ${ep.url} -> ${res.status} (expected ${ep.expectStatus}) - Body: ${text.slice(0, 100)}`);
        failed++;
      }
    } catch (err) {
      console.error(`[ERR] ${ep.method} ${ep.url} -> ${err}`);
      failed++;
    }
  }
  const unauthenticatedEndpoints = [
    { url: '/api/v2/companies/me/balance-sheet/', method: 'GET', expectStatus: 401 },
    { url: '/api/v2/companies/me/administration-overhead/', method: 'GET', expectStatus: 401 },
    { url: '/api/v2/contracts-history/999999999/', method: 'GET', expectStatus: 401 },
    { url: '/version/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/captcha/', method: 'GET', expectStatus: 200 },
    { url: '/api/v2/company-lookup/not-a-number/0/name/', method: 'GET', expectStatus: 400 }
  ];

  for (const ep of unauthenticatedEndpoints) {
    try {
      const res = await fetch(`${base}${ep.url}`, { method: ep.method });
      const text = await res.text();
      if (res.status === ep.expectStatus) {
        console.log(`[PASS unauth] ${ep.method} ${ep.url} -> ${res.status}`);
        passed++;
      } else {
        console.error(`[FAIL unauth] ${ep.method} ${ep.url} -> ${res.status} (expected ${ep.expectStatus}) - Body: ${text.slice(0, 100)}`);
        failed++;
      }
    } catch (err) {
      console.error(`[ERR unauth] ${ep.method} ${ep.url} -> ${err}`);
      failed++;
    }
  }

  console.log(`\n=============================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`=============================`);
  if (failed > 0) process.exit(1);
}

runTests();
