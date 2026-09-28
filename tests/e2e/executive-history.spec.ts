import { expect, test as base } from '@playwright/test';
import { attachDiagnostics, type DiagnosticsController } from './support/diagnostics.ts';
import { apiJson, createIsolatedAccount, password, signIn } from './support/building-matrix-helpers.ts';

const test = base.extend<{ diagnostics: DiagnosticsController }>({
  diagnostics: async ({ page }, use, testInfo) => {
    const diagnostics = attachDiagnostics(page);
    try {
      await use(diagnostics);
    } finally {
      await diagnostics.write(testInfo);
    }
  },
});

test('firing an executive through the visible boardroom preserves history after refresh', async ({ page, diagnostics }) => {
  const email = `former_exec_${Date.now()}@example.local`;
  const companyName = `Former Exec ${Date.now()}`;
  await createIsolatedAccount(page, email, companyName);
  const fixture = await apiJson(page, 'POST', '/api/v2/debug/fixture/', {
    email, password, companyName, money: 1_000_000, level: 60,
    clearExistingExecutives: false
  });
  expect(fixture.status, fixture.text).toBe(200);
  const fixtureBody = fixture.body as { fixture?: { companyId?: number } };
  expect(Number.isInteger(fixtureBody.fixture?.companyId)).toBe(true);
  const companyId = fixtureBody.fixture?.companyId as number;
  // The original executive royalty formula/tenure contract remains unavailable
  // upstream. This test permits only its own exact GET with the proven response
  // code, while every other 501, console error, and Axios rejection stays fatal.
  diagnostics.audit.expectExecutiveRoyaltiesContractBlock(companyId);
  await signIn(page, email);

  const active = await apiJson<{ executives: Array<{ id: number; name: string; currentWorkHistory?: unknown }> }>(
    page, 'GET', '/api/v4/executives/');
  expect(active.status, active.text).toBe(200);
  const executive = active.body.executives[0];
  expect(executive, 'the isolated account starts with a seeded, employed executive').toBeTruthy();
  expect(executive.currentWorkHistory, 'the seeded executive has an active employment-history record').toBeTruthy();

  await page.goto('/zh-cn/headquarters/executives/');
  const historyHeading = page.getByRole('heading', { name: /前任高管|Former Executives/i });
  await expect(historyHeading).toBeVisible();
  await page.getByText(executive.name, { exact: false }).first().click();
  await expect(page).toHaveURL(/\/zh-cn\/headquarters\/executives\/[^/]+\/$/);
  await page.getByRole('button', { name: '解雇', exact: true }).click();

  const fireResponsePromise = page.waitForResponse(response => {
    const request = response.request();
    return request.method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/v4/executives/${executive.id}/`;
  });
  await page.getByRole('button', { name: '是的，解雇', exact: true }).click();
  const fireResponse = await fireResponsePromise;
  expect(fireResponse.status()).toBe(200);

  const historyResponsePromise = page.waitForResponse(response =>
    response.request().method() === 'GET'
      && /\/api\/v2\/companies\/\d+\/former-executives\/?$/.test(new URL(response.url()).pathname));
  await page.getByRole('link', { name: '公司高管', exact: true }).click();
  const historyResponse = await historyResponsePromise;
  expect(historyResponse.status()).toBe(200);
  const history = await historyResponse.json() as { executives: Array<{ id: number; status?: string }> };
  expect(history.executives.some(entry => entry.id === executive.id && entry.status === 'former')).toBe(true);
  await expect(historyHeading).toBeVisible();
  await expect(page.getByText(executive.name, { exact: false })).toBeVisible();

  const refreshedHistoryPromise = page.waitForResponse(response =>
    response.request().method() === 'GET'
      && /\/api\/v2\/companies\/\d+\/former-executives\/?$/.test(new URL(response.url()).pathname));
  await page.reload();
  const refreshedHistory = await refreshedHistoryPromise;
  expect(refreshedHistory.status()).toBe(200);
  await expect(historyHeading).toBeVisible();
  await expect(page.getByText(executive.name, { exact: false })).toBeVisible();

  await diagnostics.flush();
  const royaltiesBlockEvidence = diagnostics.audit.snapshot().ignored.filter(entry =>
    entry.message.includes(`/api/v2/companies/${companyId}/royalties/`)
      && entry.message.includes('SOURCE_CONTRACT_BLOCKED'));
  expect(royaltiesBlockEvidence.length, 'exact self-company royalties contract block is reported in attached audit evidence').toBeGreaterThan(0);
  expect(royaltiesBlockEvidence.length, 'executive-history test reports a bounded number of blocked-dependency events').toBeLessThanOrEqual(4);
});
