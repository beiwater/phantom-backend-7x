import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import { unlockExecutiveSlot } from '../server/game/simboosts.ts';
import { getAuthData, getCompanyById } from '../server/game/company.ts';
import { handleSimboostRoutes } from '../server/routes/simboost-routes.ts';

console.log('=== Verifying Executive Staff Slots & SimBoosts (Issues #137 & #138) ===');

// Prepare test company with 1000 SimBoosts and 0 extra slots
const testCompanyId = 1;
db.prepare('UPDATE companies SET simboosts = 1000, extra_executive_slots = 0 WHERE id = ? OR company_id = ?')
  .run(testCompanyId, testCompanyId);

// [1/4] Test first slot unlock (costs 50 SimBoosts)
console.log('[1/4] Unlocking first extra executive staff slot...');
const result1 = await unlockExecutiveSlot(testCompanyId);
assert.strictEqual(result1.success, true);
assert.strictEqual(result1.spent, 50, '1st slot must cost 50 SimBoosts');
assert.strictEqual(result1.extraExecutiveSlots, 1, 'extraExecutiveSlots must be 1');
assert.strictEqual(result1.simBoosts, 950, 'simBoosts must be 950 and NOT NaN');
assert.strictEqual(result1.simboosts, 950, 'simboosts must be 950');
assert.ok(!Number.isNaN(result1.simBoosts), 'simBoosts MUST NOT be NaN');
console.log(`  -> Slot 1 unlocked: balance=${result1.simBoosts}, extraSlots=${result1.extraExecutiveSlots}`);

// [2/4] Test second slot unlock (costs 100 SimBoosts)
console.log('[2/4] Unlocking second extra executive staff slot...');
const result2 = await unlockExecutiveSlot(testCompanyId);
assert.strictEqual(result2.success, true);
assert.strictEqual(result2.spent, 100, '2nd slot must cost 100 SimBoosts');
assert.strictEqual(result2.extraExecutiveSlots, 2, 'extraExecutiveSlots must be 2');
assert.strictEqual(result2.simBoosts, 850, 'simBoosts must be 850');
assert.ok(!Number.isNaN(result2.simBoosts), 'simBoosts MUST NOT be NaN');
console.log(`  -> Slot 2 unlocked: balance=${result2.simBoosts}, extraSlots=${result2.extraExecutiveSlots}`);

console.log('[3/4] Verifying slot persistence across auth data refresh...');
const comp = getCompanyById(testCompanyId);
const auth = getAuthData(comp!.player_id);
assert.ok(auth, 'Auth data must be returned');
assert.strictEqual(auth.authCompany.extraExecutiveSlots, 2, 'authCompany.extraExecutiveSlots must persist as 2');
assert.strictEqual(auth.authCompany.simBoosts, 850, 'authCompany.simBoosts must persist as 850');
console.log('  -> Auth data verified on simulated refresh.');

// [4/4] Test HTTP route POST /api/v2/companies/me/executive-slots/
console.log('[4/4] Testing HTTP route POST /api/v2/companies/me/executive-slots/...');
let httpPayload: any = null;
const mockRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { httpPayload = JSON.parse(content); }
};

const handled = await handleSimboostRoutes({} as any, mockRes, '/api/v2/companies/me/executive-slots/', 'POST', testCompanyId, testCompanyId);
assert.strictEqual(handled, true, 'Route must be handled');
assert.strictEqual(httpPayload.success, true);
assert.strictEqual(httpPayload.extraExecutiveSlots, 3, 'HTTP unlock must increment slots to 3');
assert.strictEqual(httpPayload.simBoosts, 650, 'HTTP unlock must debit 200 SimBoosts (850 - 200 = 650)');
assert.ok(!Number.isNaN(httpPayload.simBoosts), 'HTTP payload simBoosts must not be NaN');

console.log('================================================================');
console.log(' [OK] ISSUES #137 & #138 EXECUTIVE SLOTS PASSED ALL TESTS');
console.log('================================================================');
