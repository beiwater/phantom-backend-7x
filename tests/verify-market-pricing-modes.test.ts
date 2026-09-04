import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';

console.log('=== Verifying Market Pricing Mode Switcher (Realistic vs Test) ===');

// 1. Switch to Realistic mode
console.log('[1/4] Switching marketplace to [REALISTIC] mode...');
const resReal = await FixtureService.setMarketPricingMode('realistic');
assert.strictEqual(resReal.mode, 'realistic');
assert.ok(resReal.ordersUpdated > 1000, 'Should update orders for all resources');

const stateReal = FixtureService.getMarketPricingMode();
assert.strictEqual(stateReal.mode, 'realistic');

// Check realistic prices for specific items
const powerQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 1 AND quality = 0').get() as { price: number };
const applesQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 3 AND quality = 0').get() as { price: number };
const steakQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 7 AND quality = 0').get() as { price: number };
const smartphoneQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 24 AND quality = 0').get() as { price: number };

console.log(`  -> Realistic Prices: Power=$${powerQ0.price}, Apples=$${applesQ0.price}, Steak=$${steakQ0.price}, Smartphone=$${smartphoneQ0.price}`);
assert.ok(powerQ0.price < 0.3, 'Power realistic price should be < $0.30');
assert.ok(applesQ0.price > 1.0 && applesQ0.price < 6.0, 'Apples realistic price should provide ~$300 building profit');
assert.ok(steakQ0.price > 20.0, 'Steak realistic price should be > $20.00');
assert.ok(smartphoneQ0.price > 200.0, 'Smartphone realistic price should be > $200.00');

// Verify building hourly profit is around $300
const appleProfit = (applesQ0.price - 1.386) * 121.7;
console.log(`  -> Calculated Hourly Profit for Apples: $${appleProfit.toFixed(1)} (compressed by demand/sat to ~$200-240)`);
assert.ok(appleProfit >= 180 && appleProfit <= 260, `Hourly profit for apples should reflect compressed demand, got ${appleProfit}`);
const powerProfit = (powerQ0.price - 0.161) * 2566.9;
console.log(`  -> Calculated Hourly Profit for Power: $${powerProfit.toFixed(1)} (target: ~$300)`);
assert.ok(powerProfit >= 270 && powerProfit <= 350, `Hourly profit for power should be around $300 target, got ${powerProfit}`);
// 2. Switch to Test mode
console.log('[2/4] Switching marketplace to [TEST] mode...');
const resTest = await FixtureService.setMarketPricingMode('test');
assert.strictEqual(resTest.mode, 'test');
assert.ok(resTest.ordersUpdated > 1000);

const stateTest = FixtureService.getMarketPricingMode();
assert.strictEqual(stateTest.mode, 'test');

const powerTestQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 1 AND quality = 0').get() as { price: number };
const smartphoneTestQ0 = db.prepare('SELECT price FROM market_orders WHERE seller_id = 999900 AND kind = 24 AND quality = 0').get() as { price: number };

console.log(`  -> Test Prices: Power=$${powerTestQ0.price}, Smartphone=$${smartphoneTestQ0.price}`);
assert.strictEqual(powerTestQ0.price, 1.0, 'Power test price should be flat $1.00');
assert.strictEqual(smartphoneTestQ0.price, 1.0, 'Smartphone test price should be flat $1.00');

// 3. Switch back to Realistic mode
console.log('[3/4] Switching back to [REALISTIC] mode...');
await FixtureService.setMarketPricingMode('realistic');
const finalState = FixtureService.getMarketPricingMode();
assert.strictEqual(finalState.mode, 'realistic');

console.log('================================================================');
console.log(' [OK] MARKET PRICING MODE SWITCHER PASSED ALL TESTS');
console.log('================================================================');
