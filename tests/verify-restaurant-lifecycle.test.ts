import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import {
  getRestaurantProperties,
  updateRestaurantProperties,
  getRestaurantRuns,
  resolveDueRestaurantRuns
} from '../server/game/restaurant.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';

console.log('=== Verifying Restaurant Rating Lifecycle & Closure Mechanics ===');

// 1. Setup test company with a Level 2 Restaurant
const { companyId } = await FixtureService.applyScenario({
  companyName: 'Restaurant Lifecycle Test Co',
  money: 500000,
  level: 25,
  buildings: [
    { kind: 'r', size: 2, position: 1 } // Restaurant
  ],
  warehouse: [
    { kind: 117, amount: 5000, quality: 2 }, // Milk
    { kind: 129, amount: 200, quality: 2 },  // Hamburger
    { kind: 132, amount: 200, quality: 2 }   // Cocktails
  ]
});

const building = db.prepare('SELECT id FROM buildings WHERE company_id = ? AND kind = ?').get(companyId, 'r') as { id: number };
const buildingId = building.id;

// [1/6] Check initial properties of new restaurant
console.log('[1/6] Checking initial restaurant state (rating should be 0.00)...');
let props = getRestaurantProperties(buildingId, companyId);
assert.strictEqual(props.rating, 0, 'Initial restaurant rating must be 0');

// [2/6] Configure menu and price
console.log('[2/6] Configuring menu and price...');
await updateRestaurantProperties(buildingId, companyId, {
  keepOpen: false, // configure without starting
  menu: [
    { resource: 117, quality: 2, qualityMode: 'exact' },
    { resource: 129, quality: 2, qualityMode: 'exact' },
    { resource: 132, quality: 2, qualityMode: 'exact' }
  ],
  menuPrice: 85,
  goodService: true
});
props = getRestaurantProperties(buildingId, companyId);
assert.strictEqual(props.rating, 0, 'Configuring menu must NOT overwrite rating before first cycle finishes (Issue #136)');
console.log('-> Rating after menu setup:', props.rating, '(correct: 0.00)');

// [3/6] Start 12h cycle
console.log('[3/6] Starting 12-hour cycle with keepOpen=true...');
await updateRestaurantProperties(buildingId, companyId, { keepOpen: true });
let runs = await getRestaurantRuns(buildingId, companyId);
assert.strictEqual(runs.length, 1, 'Should have 1 active run');
assert.strictEqual(runs[0].resolved, false, 'Active run should be unresolved');
assert.strictEqual(runs[0].newRating, null, 'Active run newRating should be null during execution');
assert.strictEqual(runs[0].rating, 0, 'Active run initial rating should be 0');

// [4/6] Schedule stop during active cycle and then cancel it
console.log('[4/6] Testing closure scheduling and cancellation during active cycle...');
await updateRestaurantProperties(buildingId, companyId, { keepOpen: false });
props = getRestaurantProperties(buildingId, companyId);
assert.strictEqual(props.rating, 0, 'Scheduling stop must NOT apply instant penalty while cycle is still running');
assert.strictEqual(props.keepOpen, false, 'keepOpen should be false');

// Cancel closure before cycle finishes:
await updateRestaurantProperties(buildingId, companyId, { keepOpen: true });
props = getRestaurantProperties(buildingId, companyId);
assert.strictEqual(props.rating, 0, 'Canceling closure before cycle end must retain current rating');
assert.strictEqual(props.keepOpen, true, 'keepOpen should be true again');

// [5/6] Fast-forward 12.5 hours to settle first cycle
console.log('[5/6] Fast-forwarding time +12.5 hours to settle first cycle...');
virtualClock.advance({ hours: 12.5 });
await resolveDueRestaurantRuns(buildingId, companyId, new Date(virtualClock.nowMs()));

props = getRestaurantProperties(buildingId, companyId);
console.log('-> Settled Rating after 1st cycle:', props.rating);
assert.ok(props.rating > 2, 'Settled rating should be calculated from customer feedback');

runs = await getRestaurantRuns(buildingId, companyId);
const firstRun = runs.find(r => r.resolved);
assert.ok(firstRun, 'First run should be resolved');
assert.strictEqual(firstRun!.rating, 0, 'First run rating_before should be 0');
assert.strictEqual(firstRun!.newRating, props.rating, 'First run newRating should match settled properties rating');
console.log(`-> First run rating delta: ${firstRun!.rating} -> ${firstRun!.newRating} (delta: +${props.rating})`);

// [6/6] Schedule closure on cycle 2 and let it actually close
console.log('[6/6] Scheduling closure and letting cycle 2 actually close at settlement...');
const ratingBeforeClose = props.rating;
await updateRestaurantProperties(buildingId, companyId, { keepOpen: false });

virtualClock.advance({ hours: 12.5 });
await resolveDueRestaurantRuns(buildingId, companyId, new Date(virtualClock.nowMs()));

props = getRestaurantProperties(buildingId, companyId);
console.log('-> Settled Rating after actual closure:', props.rating);
const expectedClosedRating = Math.round(ratingBeforeClose * 0.875 * 100) / 100;
console.log(`-> Expected closed rating (12.5% penalty): ~${expectedClosedRating}, Actual: ${props.rating}`);

// Reopening restaurant preserves penalized rating until a new cycle runs
await updateRestaurantProperties(buildingId, companyId, { keepOpen: true });
props = getRestaurantProperties(buildingId, companyId);
assert.strictEqual(props.rating, Math.round(ratingBeforeClose * 0.875 * 100) / 100, 'Reopening must not erase closure penalty (Issue #143)');

console.log('================================================================');
console.log(' [OK] RESTAURANT LIFECYCLE & CLOSURE MECHANICS PASSED ALL CHECKS');
console.log('================================================================');
