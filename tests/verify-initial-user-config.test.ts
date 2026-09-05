import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { CONFIG, parseInitialWarehouseStock, getInitialCompanySettings } from '../server/config.ts';
import { createCompanyForPlayer } from '../server/game/company.ts';
import { computeLevelInfo } from '../server/domain/leveling/level-rules.ts';

console.log('================================================================');
console.log(' Verifying New User Initial Config (.env: Level, XP, Slots, Stars, Stock)');
console.log('================================================================');

// 1. Verify Warehouse Stock Parsers
console.log('[1/4] Verifying warehouse stock parser presets & custom strings...');
const standardStock = parseInitialWarehouseStock('standard');
assert.ok(standardStock.length >= 10, 'Standard stock must contain base & construction resources');
assert.equal(standardStock.find(s => s.kind === 1)?.amount, 20000, 'Power should be 20,000');

const richStock = parseInitialWarehouseStock('rich');
assert.equal(richStock.find(s => s.kind === 1)?.amount, 100000, 'Rich stock should have 100,000 power');
assert.equal(richStock.find(s => s.kind === 111)?.amount, 20000, 'Rich stock should have 20,000 construction units');

const builderStock = parseInitialWarehouseStock('builder');
assert.equal(builderStock.find(s => s.kind === 101)?.amount, 50000, 'Builder stock should have 50,000 planks');

const emptyStock = parseInitialWarehouseStock('empty');
assert.equal(emptyStock.length, 0, 'Empty stock must be empty array');

const customStock = parseInitialWarehouseStock('1:55555,2:66666,101:77777:2');
assert.equal(customStock.length, 3, 'Custom stock must have 3 items');
assert.deepEqual(customStock[0], { kind: 1, amount: 55555, quality: 0 });
assert.deepEqual(customStock[1], { kind: 2, amount: 66666, quality: 0 });
assert.deepEqual(customStock[2], { kind: 101, amount: 77777, quality: 2 });
console.log('  ✔ All warehouse stock presets and custom parsers verified!\n');

// 2. Verify Config Settings Calculation
console.log('[2/4] Verifying getInitialCompanySettings() calculations...');

// Test Level 10 with automatic cumulative XP calculation
CONFIG.INITIAL_LEVEL = 10;
CONFIG.INITIAL_EXPERIENCE = undefined;
CONFIG.INITIAL_EXTRA_BUILDING_SLOTS = 5;
CONFIG.INITIAL_BUILDING_SLOTS = undefined;
CONFIG.INITIAL_MONEY = 888888;
CONFIG.INITIAL_SIMBOOSTS = 9999;
CONFIG.INITIAL_WAREHOUSE_STOCK = 'rich';

const init1 = getInitialCompanySettings();
assert.equal(init1.level, 10);
assert.equal(init1.experience, 550, 'Level 10 automatic cumulative XP must be 550');
assert.equal(init1.extraBuildingSlots, 5);
assert.equal(init1.money, 888888);
assert.equal(init1.simboosts, 9999);
assert.equal(init1.warehouseStock.length, richStock.length);
console.log('  ✔ Level 10 with auto XP & extra slots verified');
// Explicit zero is a valid override and must not trigger automatic XP calculation.
CONFIG.INITIAL_EXPERIENCE = 0;
const initExplicitZero = getInitialCompanySettings();
assert.equal(initExplicitZero.experience, 0, 'Explicit INITIAL_EXPERIENCE=0 must remain zero');
CONFIG.INITIAL_EXPERIENCE = undefined;

// Test Target Building Slots (几块地 total target)
CONFIG.INITIAL_LEVEL = 0; // base maxBuildings = 4
CONFIG.INITIAL_BUILDING_SLOTS = 20; // target 20 -> extra should be 20 - 4 = 16
const init2 = getInitialCompanySettings();
assert.equal(init2.extraBuildingSlots, 16, 'Target 20 building slots at Level 0 must yield 16 extra slots');

// LevelInfo computation check
const lvlInfo = computeLevelInfo({ level: 0, extra_building_slots: init2.extraBuildingSlots });
assert.equal(lvlInfo.maxBuildings, 20, 'Total max buildings (几块地) on company map must equal 20');
console.log('  ✔ Target total building slots (几块地) calculation verified!\n');

// 3. Verify End-to-End Company Creation with Custom Initial Settings
console.log('[3/4] Verifying createCompanyForPlayer() applies all initial attributes to DB...');
CONFIG.INITIAL_LEVEL = 5;
CONFIG.INITIAL_EXPERIENCE = 12345;
CONFIG.INITIAL_EXTRA_BUILDING_SLOTS = 8;
CONFIG.INITIAL_BUILDING_SLOTS = undefined;
CONFIG.INITIAL_MONEY = 2500000;
CONFIG.INITIAL_SIMBOOSTS = 7777;
CONFIG.INITIAL_WAREHOUSE_STOCK = '1:99999,2:88888,66:77777';

const testPlayerId = Math.floor(1000000 + Math.random() * 9000000);
const newCompany = createCompanyForPlayer(testPlayerId, `CustomInit-${Date.now()}`, 0);
assert.ok(newCompany, 'Company must be created');

// Check DB row directly
const dbRow = db.prepare('SELECT * FROM companies WHERE company_id = ?').get(newCompany.company_id) as any;
assert.equal(dbRow.money, 2500000, 'Initial money in DB must match CONFIG.INITIAL_MONEY');
assert.equal(dbRow.simboosts, 7777, 'Initial SimBoosts (星星) in DB must match CONFIG.INITIAL_SIMBOOSTS');
assert.equal(dbRow.level, 5, 'Initial level in DB must match CONFIG.INITIAL_LEVEL');
assert.equal(dbRow.experience, 12345, 'Initial experience in DB must match CONFIG.INITIAL_EXPERIENCE');
assert.equal(dbRow.extra_building_slots, 8, 'Extra building slots in DB must match CONFIG.INITIAL_EXTRA_BUILDING_SLOTS');

// Check total building slots via computeLevelInfo
const compLvlInfo = computeLevelInfo({
  level: dbRow.level,
  experience: dbRow.experience,
  extra_building_slots: dbRow.extra_building_slots
});
// Level 5 base is 5 slots, plus 8 extra = 13 total slots
assert.equal(compLvlInfo.maxBuildings, 13, 'Level 5 (5 slots) + 8 extra slots must equal 13 total building plots');
console.log(`  ✔ Company #${newCompany.company_id} created with:`);
console.log(`     - Level: ${dbRow.level}, Experience: ${dbRow.experience}`);
console.log(`     - Money: $${dbRow.money.toLocaleString()}, SimBoosts (星星): ${dbRow.simboosts}`);
console.log(`     - Building Slots (几块地): ${compLvlInfo.maxBuildings} total (${dbRow.extra_building_slots} extra)`);

// 4. Verify Warehouse stock in DB
console.log('[4/4] Verifying warehouse stock seeded in DB...');
const stockRows = db.prepare('SELECT kind, amount, quality FROM warehouse WHERE company_id = ?').all(newCompany.company_id) as any[];
assert.equal(stockRows.length, 3, 'Warehouse must have 3 seeded items');
assert.equal(stockRows.find(s => s.kind === 1)?.amount, 99999);
assert.equal(stockRows.find(s => s.kind === 2)?.amount, 88888);
assert.equal(stockRows.find(s => s.kind === 66)?.amount, 77777);
console.log('  ✔ Configured warehouse stock successfully seeded in database!\n');

// Restore default test configuration
CONFIG.INITIAL_LEVEL = 0;
CONFIG.INITIAL_EXPERIENCE = undefined;
CONFIG.INITIAL_EXTRA_BUILDING_SLOTS = 0;
CONFIG.INITIAL_BUILDING_SLOTS = undefined;
CONFIG.INITIAL_MONEY = 100000;
CONFIG.INITIAL_SIMBOOSTS = 250;
CONFIG.INITIAL_WAREHOUSE_STOCK = 'standard';

console.log('================================================================');
console.log(' [ALL TESTS PASSED] NEW USER INITIAL CONFIG VERIFIED');
console.log('================================================================');
