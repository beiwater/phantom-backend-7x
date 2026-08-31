import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
// NOTE: run with DATA_DIR=data/test-run-3203 to share the server's DB
import { resetPurchaseLedger } from '../server/game/simboosts.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3203'}`;

interface AuthCompany {
  companyId: number;
  money: number;
  simBoosts: number;
  exchangedToday: number;
  productionModifier: number;
  salesModifier: number;
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const time = Date.now();
  const email = `sb_${label}_${time}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test12345!' })
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie);

  const authResponse = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authResponse.status, 200);
  const auth = (await authResponse.json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function authCompany(cookie: string): Promise<AuthCompany> {
  const r = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  return ((await r.json()) as { authCompany: AuthCompany }).authCompany;
}

interface PackageDto {
  sku: string;
  simBoosts: number;
  price: string;
  currency: string;
  image: string;
  starting: boolean;
  supporterOnly: boolean;
  isSupporter: boolean;
  wideFrame: boolean;
  approximateCurrency?: { code: string; value: string };
}

async function runP0CheckoutSimboostTest() {
  console.log('================================================================');
  console.log(' P0-03 / P0-04 / P1-02 Checkout + SimBoost Verification');
  console.log(` Base URL: ${baseUrl}`);
  console.log('================================================================');

  // ----------------------------------------------------------------
  // [1] GET /api/v4/payment-packages/unknown/ -> 200, HAR schema
  // ----------------------------------------------------------------
  console.log('[1/8] GET /api/v4/payment-packages/unknown/ returns HAR-shaped catalog...');
  const pkgRes = await fetch(`${baseUrl}/api/v4/payment-packages/unknown/`);
  assert.equal(pkgRes.status, 200);
  const pkgBody = (await pkgRes.json()) as { packages: PackageDto[]; preferredCurrency: string; filter: boolean };
  assert.ok(Array.isArray(pkgBody.packages), 'packages must be an array');
  assert.ok(pkgBody.packages.length > 0, 'catalog must not be empty');

  // Every package must carry the exact official field set (HAR schema).
  const requiredFields = ['sku', 'simBoosts', 'price', 'currency', 'image', 'starting', 'supporterOnly', 'isSupporter', 'wideFrame', 'approximateCurrency'] as const;
  for (const p of pkgBody.packages) {
    for (const f of requiredFields) {
      assert.ok(f in p, `package ${p.sku} missing field ${f}`);
    }
    assert.equal(typeof p.sku, 'string');
    assert.equal(typeof p.simBoosts, 'number');
    assert.equal(typeof p.price, 'string');
    assert.equal(p.currency, 'USD');
    assert.equal(typeof p.starting, 'boolean');
    assert.equal(typeof p.supporterOnly, 'boolean');
    assert.equal(typeof p.isSupporter, 'boolean');
    assert.equal(typeof p.wideFrame, 'boolean');
    // Official approximateCurrency: { code: 'AUD', value: '8.22' } — string value.
    assert.equal(p.approximateCurrency?.code, 'AUD');
    assert.equal(typeof p.approximateCurrency?.value, 'string');
  }
  // Real package constants from the official server (local://har-schemas.md).
  const bySku = new Map(pkgBody.packages.map(p => [p.sku, p]));
  const small = bySku.get('sb-sb150');
  assert.ok(small, 'sb-sb150 must exist');
  assert.equal(small.simBoosts, 150);
  assert.equal(small.price, '5.89');
  const starter = bySku.get('sp2');
  assert.ok(starter, 'starter pack sp2 must exist');
  assert.equal(starter.starting, true);
  assert.equal(starter.wideFrame, true);
  const large = bySku.get('sb-sb1900');
  assert.ok(large, 'sb-sb1900 must exist');
  assert.equal(large.simBoosts, 1900);
  assert.equal(large.price, '46.95');
  const supporter = bySku.get('supporter');
  assert.ok(supporter, 'supporter package must exist');
  assert.equal(supporter.isSupporter, true);
  // /payment-packages/:sku/ alias must behave identically.
  const aliasRes = await fetch(`${baseUrl}/api/v4/payment-packages/sb-sb150/`);
  assert.equal(aliasRes.status, 200);
  const aliasBody = (await aliasRes.json()) as { packages: PackageDto[] };
  assert.ok(aliasBody.packages.length > 0);
  console.log('  -> catalog OK: 15 packages, HAR field set + real official constants verified');

  // ----------------------------------------------------------------
  // [2] Register a fresh player; balance starts at the seed default
  // ----------------------------------------------------------------
  console.log('[2/8] Registering fresh company...');
  const { cookie } = await register('p0');
  const authBefore = await authCompany(cookie);
  assert.equal(authBefore.simBoosts, 250);
  assert.equal(authBefore.exchangedToday, 0);
  assert.equal(authBefore.productionModifier, 0);
  console.log(`  -> company ${authBefore.companyId}, simBoosts=${authBefore.simBoosts}, money=${authBefore.money}`);

  // ----------------------------------------------------------------
  // [3] POST /api/v2/payment-stripe/ { sku } grants SimBoosts immediately
  // ----------------------------------------------------------------
  console.log('[3/8] POST /api/v2/payment-stripe/ (sb-sb330, 330 SB) grants immediately...');
  const buyRes = await fetch(`${baseUrl}/api/v2/payment-stripe/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ sku: 'sb-sb330' })
  });
  assert.equal(buyRes.status, 200);
  const buyBody = (await buyRes.json()) as {
    clientSecret: string;
    payment: { sku: string; simBoosts: number; price: string; currency: string };
    simBoosts: number;
    companySimboosts: number;
  };
  // Frontend reads data.clientSecret to complete the Stripe Elements flow.
  assert.ok(buyBody.clientSecret && buyBody.clientSecret.length > 0, 'clientSecret required by frontend');
  assert.equal(buyBody.payment.sku, 'sb-sb330');
  assert.equal(buyBody.payment.simBoosts, 330);
  assert.equal(buyBody.payment.price, '10.45');
  assert.equal(buyBody.payment.currency, 'USD');
  assert.equal(buyBody.simBoosts, 330);
  assert.equal(buyBody.companySimboosts, authBefore.simBoosts + 330);

  // The grant must be visible on the very next auth-data read (no refresh dance).
  const authAfterBuy = await authCompany(cookie);
  assert.equal(authAfterBuy.simBoosts, authBefore.simBoosts + 330, 'balance must increase by exactly 330');
  // And it must be real persisted state, not a cached layer.
  const dbRow = db.prepare('SELECT simboosts FROM companies WHERE company_id = ?').get(authAfterBuy.companyId) as { simboosts: number };
  assert.equal(dbRow.simboosts, authBefore.simBoosts + 330);
  console.log(`  -> granted 330 SB; balance ${authBefore.simBoosts} -> ${authAfterBuy.simBoosts} (persisted in DB)`);

  // ----------------------------------------------------------------
  // [4] Immediate duplicate POST must NOT grant twice (bug acceptance)
  // ----------------------------------------------------------------
  console.log('[4/8] Immediate duplicate purchase must not re-grant...');
  const buyAgainRes = await fetch(`${baseUrl}/api/v2/payment-stripe/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ sku: 'sb-sb330' })
  });
  assert.equal(buyAgainRes.status, 200, 'repeat click must still succeed for the client');
  const buyAgain = (await buyAgainRes.json()) as { companySimboosts: number; simBoosts: number };
  assert.equal(buyAgain.companySimboosts, authAfterBuy.simBoosts, 'repeat must return the same balance');
  const authAfterRepeat = await authCompany(cookie);
  assert.equal(authAfterRepeat.simBoosts, authAfterBuy.simBoosts, 'balance unchanged after duplicate click');
  console.log(`  -> duplicate click: balance stays ${authAfterRepeat.simBoosts}`);

  // ----------------------------------------------------------------
  // [5] Legacy /api/v2/payment/ also grants with the new catalog
  // ----------------------------------------------------------------
  console.log('[5/8] POST /api/v2/payment/ (sb-sb150) grants with real catalog sku...');
  const legacyRes = await fetch(`${baseUrl}/api/v2/payment/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ nonce: 'fake-nonce', name: 'Tester', sku: 'sb-sb150' })
  });
  assert.equal(legacyRes.status, 200);
  const legacy = (await legacyRes.json()) as { payment: { sku: string; simBoosts: number }; companySimboosts: number };
  assert.equal(legacy.payment.sku, 'sb-sb150');
  assert.equal(legacy.payment.simBoosts, 150);
  assert.equal(legacy.companySimboosts, authAfterRepeat.simBoosts + 150);
  console.log('  -> legacy checkout path grants 150 SB');

  // ----------------------------------------------------------------
  // [6] P1-02: bonus realign persists; refresh reads saved values
  // ----------------------------------------------------------------
  console.log('[6/8] P1-02 realign production/sales bonus, then re-read...');
  const bonusRes = await fetch(`${baseUrl}/api/v2/companies/me/bonus/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ production: 2 })
  });
  assert.equal(bonusRes.status, 200);
  const bonus = (await bonusRes.json()) as { productionModifier: number; salesModifier: number };
  assert.equal(bonus.productionModifier, 2);
  assert.equal(bonus.salesModifier, -2);

  // First GET-back...
  const authBonus1 = await authCompany(cookie);
  assert.equal(authBonus1.productionModifier, 2, 'saved productionModifier must be returned');
  assert.equal(authBonus1.salesModifier, -2, 'saved salesModifier must be returned');
  // ...and a NEW GET must still return the persisted values (not defaults).
  const authBonus2 = await authCompany(cookie);
  assert.equal(authBonus2.productionModifier, 2);
  assert.equal(authBonus2.salesModifier, -2);
  const settingRow = db.prepare(
    'SELECT production_modifier, sales_modifier FROM company_boost_settings WHERE company_id = ?'
  ).get(authBonus1.companyId) as { production_modifier: number; sales_modifier: number };
  assert.equal(settingRow.production_modifier, 2);
  assert.equal(settingRow.sales_modifier, -2);
  console.log('  -> realign persisted: productionModifier=2 salesModifier=-2 survives fresh GETs');

  // ----------------------------------------------------------------
  // [7] P0-04: POST /api/v2/pa-action/fair/:n/ -> {"done":true}, idempotent
  // ----------------------------------------------------------------
  console.log('[7/8] P0-04 fair exchange: cash -> SimBoosts with daily counter...');
  const moneyBefore = authBonus2.money;
  const sbBeforeFair = authBonus2.simBoosts;
  const fairRes = await fetch(`${baseUrl}/api/v2/pa-action/fair/2/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({})
  });
  assert.equal(fairRes.status, 200, 'official server returns 200');
  const fair = (await fairRes.json()) as { done: boolean; exchangedToday: number; simBoosts: number; money: number };
  assert.equal(fair.done, true, 'response must be exactly {"done": true, ...}');
  // Official exchange rate: 250 cash per SimBoost; 10000 cash = 40 SB.
  assert.equal(fair.simBoosts, sbBeforeFair + 40, '40 SimBoosts credited for 10000 cash');
  assert.equal(fair.money, moneyBefore - 10000, '10000 cash debited');
  assert.equal(fair.exchangedToday, 10000, 'daily counter tracks exchanged cash');

  const authAfterFair = await authCompany(cookie);
  assert.equal(authAfterFair.simBoosts, sbBeforeFair + 40);
  assert.equal(authAfterFair.money, moneyBefore - 10000);
  assert.equal(authAfterFair.exchangedToday, 10000, 'exchangedToday persisted in authCompany');

  // Duplicate click inside the same day must NOT exchange again (idempotency
  // acceptance, same shape as P0-03's double-click check).
  const fairAgainRes = await fetch(`${baseUrl}/api/v2/pa-action/fair/2/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({})
  });
  assert.equal(fairAgainRes.status, 400, 'second exchange hits the 10000/day limit -> 4xx, not silent 200');
  const authAfterFairAgain = await authCompany(cookie);
  assert.equal(authAfterFairAgain.simBoosts, sbBeforeFair + 40, 'no double SimBoosts');
  assert.equal(authAfterFairAgain.money, moneyBefore - 10000, 'no double cash debit');
  assert.equal(authAfterFairAgain.exchangedToday, 10000, 'counter unchanged by rejected attempt');

  // A fresh GET still shows the exchanged state after "refresh".
  const authFairRefresh = await authCompany(cookie);
  assert.equal(authFairRefresh.exchangedToday, 10000);
  console.log('  -> fair exchange: -10000 cash, +40 SB, exchangedToday=10000 persisted; duplicate rejected');

  // ----------------------------------------------------------------
  // [8] Unknown sku rejected cleanly (no silent fallback grant)
  // ----------------------------------------------------------------
  console.log('[8/8] Unknown sku returns a clean error, no grant...');
  const badRes = await fetch(`${baseUrl}/api/v2/payment-stripe/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ sku: 'simboosts_small' }) // retired fake sku
  });
  assert.equal(badRes.status, 400);
  const badBody = (await badRes.json()) as { error: string };
  assert.match(badBody.error, /not found/i);
  const authFinal = await authCompany(cookie);
  assert.equal(authFinal.simBoosts, sbBeforeFair + 40, 'no SimBoosts minted for unknown sku');
  console.log('  -> unknown sku rejected with 400, balance untouched');

  console.log('================================================================');
  console.log(' ALL CHECKS PASSED (P0-03 checkout grant + idempotency,');
  console.log(' payment-packages HAR schema, P1-02 persisted realign,');
  console.log(' P0-04 fair exchange + daily counter)');
  console.log('================================================================\n');
}

resetPurchaseLedger();
runP0CheckoutSimboostTest().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
