import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const time = Date.now();
  const email = `bond_${label}_${time}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Bond Co ${label} ${Date.now()}` })
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

async function runIssue42BondsTest() {
  console.log('================================================================');
  console.log(' Starting Issue #42 Bonds Lifecycle Verification');
  console.log('================================================================');

  const seller = await register('seller');
  const buyer = await register('buyer');
  const sellerHeaders = { 'Content-Type': 'application/json', Cookie: seller.cookie };
  const buyerHeaders = { 'Content-Type': 'application/json', Cookie: buyer.cookie };

  // Fund seller and buyer
  db.prepare('UPDATE companies SET money = 100000 WHERE company_id = ?').run(seller.companyId);
  db.prepare('UPDATE companies SET money = 100000 WHERE company_id = ?').run(buyer.companyId);

  // 1. Issue Unsold Bond
  console.log('[1/4] Seller issues an unsold bond of $25,000...');
  const issueRes = await fetch(`${baseUrl}/api/v2/bonds/sell/`, {
    method: 'POST',
    headers: sellerHeaders,
    body: JSON.stringify({ amount: 25000, interest: 0.005 })
  });
  assert.equal(issueRes.status, 200);
  const issueData = (await issueRes.json()) as { bond: { id: number; amount: number }; money: number; moneyDelta: number };
  const unsoldBondId = issueData.bond.id;
  assert.equal(issueData.moneyDelta, 0, 'Issuing bond must not mint money');
  console.log(`  -> Unsold bond #${unsoldBondId} issued (money unchanged: $100,000)`);

  // 2. Call/Cancel Unsold Bond
  console.log('[2/4] Verifying calling unsold bond does NOT deduct seller money...');
  const callUnsoldRes = await fetch(`${baseUrl}/api/v2/bonds/${unsoldBondId}/call/`, {
    method: 'POST',
    headers: sellerHeaders
  });
  assert.equal(callUnsoldRes.status, 200);
  const callUnsoldData = (await callUnsoldRes.json()) as { success: boolean; money: number; moneyDelta: number };
  assert.equal(callUnsoldData.success, true);
  assert.equal(callUnsoldData.money, 100000, 'Seller money must remain $100,000');
  assert.equal(callUnsoldData.moneyDelta, 0, 'Money delta must be 0 on unsold call');
  console.log('  -> Unsold bond called with $0 burned');

  // 3. Issue Sold Bond and Buyer Purchases It
  console.log('[3/4] Testing bond purchase transfer between buyer and seller...');
  const issue2Res = await fetch(`${baseUrl}/api/v2/bonds/sell/`, {
    method: 'POST',
    headers: sellerHeaders,
    body: JSON.stringify({ amount: 30000, interest: 0.005 })
  });
  assert.equal(issue2Res.status, 200);
  const soldBondId = ((await issue2Res.json()) as { bond: { id: number } }).bond.id;

  const buyRes = await fetch(`${baseUrl}/api/v2/bonds/${soldBondId}/buy/`, {
    method: 'POST',
    headers: buyerHeaders
  });
  assert.equal(buyRes.status, 200);

  const sellerAuthAfterBuy = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: sellerHeaders })).json()) as { authCompany: { money: number } };
  const buyerAuthAfterBuy = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: buyerHeaders })).json()) as { authCompany: { money: number } };

  assert.equal(sellerAuthAfterBuy.authCompany.money, 130000, 'Seller received $30,000 face value');
  assert.equal(buyerAuthAfterBuy.authCompany.money, 70000, 'Buyer spent $30,000 purchase price');
  console.log('  -> Bond purchased: Seller=$130,000, Buyer=$70,000');

  // 4. Calling Sold Bond Early Transfers Repayment
  console.log('[4/4] Calling sold bond early: transfers $30,000 back to buyer...');
  const callSoldRes = await fetch(`${baseUrl}/api/v2/bonds/${soldBondId}/call/`, {
    method: 'POST',
    headers: sellerHeaders
  });
  assert.equal(callSoldRes.status, 200);

  const sellerAuthAfterCall = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: sellerHeaders })).json()) as { authCompany: { money: number } };
  const buyerAuthAfterCall = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: buyerHeaders })).json()) as { authCompany: { money: number } };

  assert.equal(sellerAuthAfterCall.authCompany.money, 100000, 'Seller repaid $30,000');
  assert.equal(buyerAuthAfterCall.authCompany.money, 100000, 'Buyer received $30,000 repayment');
  console.log('  -> Bond called: Seller=$100,000, Buyer=$100,000');

  console.log('================================================================');
  console.log(' ✅ ISSUE #42 BONDS PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue42BondsTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
