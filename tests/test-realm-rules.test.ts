import assert from 'node:assert';
import {
  getRealmRules,
  isExchangeAllowed,
  isContractsAllowed,
  isBondsAllowed,
  getResourcePurchaseLimit,
  DEFAULT_REALM_RULES,
  CHALLENGE_REALM_RULES
} from '../server/game-data/realm-rules.ts';

function testRealmRules() {
  console.log('--- Testing Realm Rules & Policy Engine ---');

  // 1. Normal Realm (Realm 0)
  const normalRules = getRealmRules(0);
  assert.strictEqual(normalRules.realmId, 0);
  assert.strictEqual(isExchangeAllowed(normalRules), true, 'Exchange must be enabled in Normal Realm');
  assert.strictEqual(isContractsAllowed(normalRules), true, 'Contracts must be enabled in Normal Realm');
  assert.strictEqual(isBondsAllowed(normalRules), true, 'Bonds must be enabled in Normal Realm');
  assert.strictEqual(getResourcePurchaseLimit(normalRules, 1), undefined, 'No purchase limit in Normal Realm');

  // 2. Challenge Realm (Realm 1)
  const challengeRules = getRealmRules(1);
  assert.strictEqual(challengeRules.realmId, 1);
  assert.strictEqual(challengeRules.challenge?.enabled, true, 'Challenge flag must be active');
  assert.strictEqual(isExchangeAllowed(challengeRules), false, 'Exchange must be disabled in Challenge Realm');
  assert.strictEqual(isContractsAllowed(challengeRules), false, 'Contracts must be disabled in Challenge Realm');
  assert.strictEqual(isBondsAllowed(challengeRules), false, 'Bonds must be disabled in Challenge Realm');
  assert.strictEqual(getResourcePurchaseLimit(challengeRules, 1), 50000, 'Water purchase limit must be 50,000');
  assert.strictEqual(getResourcePurchaseLimit(challengeRules, 3), 10000, 'Apples purchase limit must be 10,000');

  console.log('✅ Realm Rules tests passed successfully!');
}

try {
  testRealmRules();
} catch (err) {
  console.error('❌ Realm Rules test failed:', err);
  process.exit(1);
}
