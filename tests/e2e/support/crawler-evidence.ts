import assert from 'node:assert/strict';
import type { Page } from 'puppeteer';
import { assertBusinessInvariants, waitForUiStable } from './browser-audit.ts';

export interface PersistedAccountState {
  companyId: number;
  money: number;
  simBoosts: number;
}

async function readPersistedAccountState(page: Page): Promise<PersistedAccountState> {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/v3/companies/auth-data/');
    return { status: result.status, body: await result.json() as { authCompany?: Partial<PersistedAccountState> } };
  });
  assert.equal(response.status, 200, 'authenticated company read must succeed');
  const company = response.body.authCompany;
  assert.ok(company && Number.isInteger(company.companyId) && company.companyId! > 0, 'authenticated company id must be persisted');
  assert.ok(Number.isFinite(company.money) && company.money! >= 0, 'company money must be a finite non-negative number');
  assert.ok(Number.isFinite(company.simBoosts) && company.simBoosts! >= 0, 'company SimBoosts must be finite and non-negative');
  return {
    companyId: company.companyId!,
    money: company.money!,
    simBoosts: company.simBoosts!,
  };
}

async function readVisibleMoney(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (document.body?.innerText ?? '').match(/\$[\d,]+(?:\.\d+)?/)?.[0]);
}

/** Registration is the crawler's only setup mutation; prove the resulting account survives a real reload. */
export async function verifyCrawlerAccountPersists(page: Page): Promise<{
  beforeRefresh: PersistedAccountState;
  afterRefresh: PersistedAccountState;
  visibleBeforeRefresh: { url: string; money?: string };
  visibleAfterRefresh: { url: string; money?: string };
}> {
  const beforeRefresh = await readPersistedAccountState(page);
  await assertBusinessInvariants(page, { expectedMoney: beforeRefresh.money, context: 'crawler account immediately after registration' });
  const visibleBeforeRefresh = { url: page.url(), money: await readVisibleMoney(page) };
  assert.ok(visibleBeforeRefresh.money, 'registered balance must be visible before refresh');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForUiStable(page, { action: 'refresh registered crawler account' });

  const afterRefresh = await readPersistedAccountState(page);
  assert.deepEqual(afterRefresh, beforeRefresh, 'company id, money, and SimBoosts must survive refresh unchanged');
  await assertBusinessInvariants(page, { expectedMoney: beforeRefresh.money, context: 'crawler account after refresh' });
  const visibleAfterRefresh = { url: page.url(), money: await readVisibleMoney(page) };
  assert.equal(visibleAfterRefresh.money, visibleBeforeRefresh.money, 'displayed balance must survive refresh unchanged');
  return { beforeRefresh, afterRefresh, visibleBeforeRefresh, visibleAfterRefresh };
}
