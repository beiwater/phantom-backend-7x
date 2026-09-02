import assert from 'node:assert';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { FixtureService } from '../server/services/fixture-service.ts';

console.log('=== Testing Virtual Clock & Fixture Generator ===');

// 1. Test Virtual Clock basic operations
console.log('[1/4] Testing VirtualClock advance and reset...');
virtualClock.reset();
const initialMs = virtualClock.nowMs();
assert(Math.abs(Date.now() - initialMs) < 100, 'Initial time must match wall clock');

// Advance by 10 hours
const advanced = virtualClock.advance({ hours: 10 });
assert.strictEqual(advanced.offsetHours, 10, 'Offset hours must be 10');
assert(virtualClock.nowMs() > initialMs + 9.9 * 3600 * 1000, 'Virtual time must be 10 hours ahead');

// Advance by 2 days
virtualClock.advance({ days: 2 });
assert.strictEqual(virtualClock.getOffsetHours(), 58, 'Offset hours must be 58 (10 + 48)');

// Reset clock
virtualClock.reset();
assert.strictEqual(virtualClock.getOffsetHours(), 0, 'Offset must reset to 0');
console.log('  -> OK: Virtual clock advance and reset operate correctly');

// 2. Test Cycle Resolution
console.log('[2/4] Testing cycle resolution during time warp...');
virtualClock.advance({ hours: 99 });
const cycles = await virtualClock.resolveAllOverdue();
assert(typeof cycles.completedConstructions === 'number', 'completedConstructions must be a number');
assert(typeof cycles.completedProductions === 'number', 'completedProductions must be a number');
assert(typeof cycles.resolvedRestaurants === 'number', 'resolvedRestaurants must be a number');
virtualClock.reset();
console.log('  -> OK: Overdue cycle resolution executed without error');

// 3. Test Fixture Preset Application
console.log('[3/4] Testing FixtureService preset creation...');
const result = await FixtureService.applyPreset('restaurant-tycoon', {
  companyName: 'Automated Test Bistro',
  money: 8888888
});
assert.strictEqual(result.companyName, 'Automated Test Bistro');
assert.strictEqual(result.money, 8888888);
assert.strictEqual(result.level, 25);
assert(result.buildingsCount >= 2, 'Should create at least 2 buildings');
assert(result.warehouseRows >= 4, 'Should create at least 4 warehouse rows');
assert(result.sessionToken.startsWith('sess_'), 'Session token must be valid');
console.log('  -> OK: Preset created player, company, buildings, warehouse, and session');

// 4. Test Custom Fixture Scenario
console.log('[4/4] Testing custom fixture scenario...');
const customResult = await FixtureService.applyScenario({
  companyName: 'Custom Energy Corp',
  money: 50000000,
  simboosts: 20000,
  level: 40,
  rating: 'AAA',
  buildings: [
    { kind: 'P', size: 10, slot: 0 },
    { kind: 'E', size: 20, slot: 1 }
  ],
  warehouse: [
    { kind: 1, quality: 3, amount: 500000 }
  ],
  executives: [
    { name: 'Alice', position: 'coo', skills: { management: 30 } }
  ]
});
assert.strictEqual(customResult.companyName, 'Custom Energy Corp');
assert.strictEqual(customResult.money, 50000000);
assert.strictEqual(customResult.simboosts, 20000);
assert.strictEqual(customResult.level, 40);
assert.strictEqual(customResult.buildingsCount, 2);
assert.strictEqual(customResult.warehouseRows, 1);
assert.strictEqual(customResult.executivesCount, 1);
console.log('  -> OK: Custom scenario applied perfectly');

console.log('================================================================');
console.log(' ✅ ALL VIRTUAL CLOCK & FIXTURE TESTS PASSED SUCCESSFULLY');
console.log('================================================================');
