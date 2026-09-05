import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { RealmPhaseService, REALM_PHASE_PRESETS, PRESET_ALIASES } from '../server/services/realm-phase-service.ts';

console.log('================================================================');
console.log(' Verifying Full 9-Era Realm Progression System (Phases 0 to 8)');
console.log('================================================================');

// 1. Verify all 9 eras are defined
console.log('[1/4] Verifying all 9 eras are defined and match phase_progression.json...');
const expectedEras = [
  { key: 'phase_1', phase: 0, researchLimit: 0, bonds: false, gov: false, execs: false, rec: false, robots: false, col: false },
  { key: 'phase_2', phase: 1, researchLimit: 2, bonds: false, gov: false, execs: false, rec: false, robots: false, col: false },
  { key: 'phase_3', phase: 2, researchLimit: 4, bonds: true,  gov: true,  execs: false, rec: false, robots: false, col: false },
  { key: 'phase_4', phase: 3, researchLimit: 6, bonds: true,  gov: true,  execs: false, rec: false, robots: false, col: false },
  { key: 'phase_5', phase: 4, researchLimit: 8, bonds: true,  gov: true,  execs: false, rec: false, robots: false, col: false },
  { key: 'phase_6', phase: 5, researchLimit: 10, bonds: true, gov: true,  execs: true,  rec: true,  robots: false, col: false },
  { key: 'phase_7', phase: 6, researchLimit: 12, bonds: true, gov: true,  execs: true,  rec: true,  robots: true,  col: true },
  { key: 'phase_8', phase: 7, researchLimit: 12, bonds: true, gov: true,  execs: true,  rec: true,  robots: true,  col: true },
  { key: 'full',    phase: 8, researchLimit: 12, bonds: true, gov: true,  execs: true,  rec: true,  robots: true,  col: true }
];

for (const exp of expectedEras) {
  const preset = REALM_PHASE_PRESETS[exp.key];
  assert.ok(preset, `Preset '${exp.key}' must exist`);
  assert.equal(preset.phase, exp.phase, `${exp.key} phase mismatch`);
  assert.equal(preset.researchLimit, exp.researchLimit, `${exp.key} researchLimit mismatch`);
  assert.equal(preset.bonds, exp.bonds, `${exp.key} bonds mismatch`);
  assert.equal(preset.govOrders, exp.gov, `${exp.key} govOrders mismatch`);
  assert.equal(preset.executives, exp.execs, `${exp.key} executives mismatch`);
  assert.equal(preset.recBuildings, exp.rec, `${exp.key} recBuildings mismatch`);
  assert.equal(preset.robots, exp.robots, `${exp.key} robots mismatch`);
  assert.equal(preset.collectibles, exp.col, `${exp.key} collectibles mismatch`);
  console.log(`  ✔ Era ${exp.phase + 1} (${exp.key}): Phase ${exp.phase}, Research Q${exp.researchLimit} - verified`);
}
console.log(' [OK] All 9 eras preset definitions verified!\n');

// 2. Verify Building Unlocks per era
console.log('[2/4] Verifying exact building unlocks across all 9 progressive eras...');

// Phase 0 (Agriculture)
RealmPhaseService.setPreset('phase_1');
assert.equal(RealmPhaseService.isBuildingUnlocked('P'), true, 'Farm/Plantation P must be unlocked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('O'), false, 'Oil Rig O must be locked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('S'), false, 'Shipping Depot S must be locked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('M'), false, 'Mine M must be locked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('g'), false, 'General Contractor g must be locked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('n'), false, 'Bank n must be locked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('1'), false, 'Car Factory 1 must be locked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('l'), false, 'Launch Pad l must be locked in Phase 0');
assert.equal(RealmPhaseService.isBuildingUnlocked('r'), false, 'Restaurant r must be locked in Phase 0');
console.log('  ✔ Phase 0: Only Agriculture buildings unlocked');

// Phase 1 (Fashion & Research)
RealmPhaseService.setPreset('phase_2');
assert.equal(RealmPhaseService.isBuildingUnlocked('O'), true, 'Oil Rig O must be unlocked in Phase 1');
assert.equal(RealmPhaseService.isBuildingUnlocked('T'), true, 'Clothes Factory T must be unlocked in Phase 1');
assert.equal(RealmPhaseService.isBuildingUnlocked('S'), false, 'Shipping Depot S must be locked in Phase 1');
console.log('  ✔ Phase 1: Oil Rig & Clothes Factory unlocked');

// Phase 2 (Energy, Bonds & GO)
RealmPhaseService.setPreset('phase_3');
assert.equal(RealmPhaseService.isBuildingUnlocked('S'), true, 'Shipping Depot S must be unlocked in Phase 2');
assert.equal(RealmPhaseService.isBuildingUnlocked('Q'), true, 'Quarry Q must be unlocked in Phase 2');
assert.equal(RealmPhaseService.isBuildingUnlocked('M'), false, 'Mine M must be locked in Phase 2');
console.log('  ✔ Phase 2: Shipping Depot & Quarry unlocked, Bonds/GO enabled');

// Phase 3 (Mining & Electronics)
RealmPhaseService.setPreset('phase_4');
assert.equal(RealmPhaseService.isBuildingUnlocked('M'), true, 'Mine M must be unlocked in Phase 3');
assert.equal(RealmPhaseService.isBuildingUnlocked('L'), true, 'Electronics Factory L must be unlocked in Phase 3');
assert.equal(RealmPhaseService.isBuildingUnlocked('g'), false, 'General Contractor g must be locked in Phase 3');
console.log('  ✔ Phase 3: Mine & Electronics unlocked');

// Phase 4 (Luxury & Car Parts)
RealmPhaseService.setPreset('phase_5');
assert.equal(RealmPhaseService.isBuildingUnlocked('g'), true, 'General Contractor g must be unlocked in Phase 4');
assert.equal(RealmPhaseService.isBuildingUnlocked('n'), false, 'Bank n must be locked in Phase 4');
console.log('  ✔ Phase 4: General Contractor unlocked');

// Phase 5 (Executives & Recreation & Banking)
RealmPhaseService.setPreset('phase_6');
assert.equal(RealmPhaseService.isBuildingUnlocked('n'), true, 'Bank n must be unlocked in Phase 5');
assert.equal(RealmPhaseService.isBuildingUnlocked('y'), true, 'Academy y must be unlocked in Phase 5');
assert.equal(RealmPhaseService.isBuildingUnlocked('3'), true, 'Castle 3 must be unlocked in Phase 5');
assert.equal(RealmPhaseService.isBuildingUnlocked('1'), false, 'Car Factory 1 must be locked in Phase 5');
console.log('  ✔ Phase 5: Banking & Castle/Park/Lake unlocked, Executives enabled');

// Phase 6 (Automotive & Robotics)
RealmPhaseService.setPreset('phase_7');
assert.equal(RealmPhaseService.isBuildingUnlocked('1'), true, 'Car Factory 1 must be unlocked in Phase 6');
assert.equal(RealmPhaseService.isBuildingUnlocked('2'), true, 'Car Dealership 2 must be unlocked in Phase 6');
assert.equal(RealmPhaseService.isBuildingUnlocked('a'), true, 'Race Track a must be unlocked in Phase 6');
assert.equal(RealmPhaseService.isBuildingUnlocked('l'), false, 'Launch Pad l must be locked in Phase 6');
console.log('  ✔ Phase 6: Car Factory & Dealership unlocked, Robots & Collectibles enabled');

// Phase 7 (Aerospace)
RealmPhaseService.setPreset('phase_8');
assert.equal(RealmPhaseService.isBuildingUnlocked('0'), true, 'Horizontal Integration 0 must be unlocked in Phase 7');
assert.equal(RealmPhaseService.isBuildingUnlocked('7'), true, 'Aerospace Factory 7 must be unlocked in Phase 7');
assert.equal(RealmPhaseService.isBuildingUnlocked('l'), true, 'Launch Pad l must be unlocked in Phase 7');
assert.equal(RealmPhaseService.isBuildingUnlocked('B'), true, 'Sales Offices B must be unlocked in Phase 7');
assert.equal(RealmPhaseService.isBuildingUnlocked('r'), false, 'Restaurant r must be locked in Phase 7');
console.log('  ✔ Phase 7: Aerospace Factory & Launch Pad unlocked');

// Phase 8 (Full Unlocked / Restaurants)
RealmPhaseService.setPreset('full');
assert.equal(RealmPhaseService.isBuildingUnlocked('j'), true, 'Bakery j must be unlocked in Phase 8');
assert.equal(RealmPhaseService.isBuildingUnlocked('m'), true, 'Catering m must be unlocked in Phase 8');
assert.equal(RealmPhaseService.isBuildingUnlocked('r'), true, 'Restaurant r must be unlocked in Phase 8');
assert.equal(RealmPhaseService.isBuildingUnlocked('z'), true, 'Beach Market z must be unlocked in Phase 8');
console.log('  ✔ Phase 8 (Full): Bakery, Catering & Restaurants fully unlocked');
console.log(' [OK] All building unlocks verified across all 9 progressive eras!\n');

// 3. Verify Alias Normalization
console.log('[3/4] Verifying alias normalization across all formats...');
const aliasTests: Array<[string, string]> = [
  ['0', 'phase_1'],
  ['1', 'phase_1'],
  ['agriculture', 'phase_1'],
  ['start', 'phase_1'],
  ['2', 'phase_2'],
  ['fashion', 'phase_2'],
  ['3', 'phase_3'],
  ['bonds', 'phase_3'],
  ['4', 'phase_4'],
  ['electronics', 'phase_4'],
  ['5', 'phase_5'],
  ['luxury', 'phase_5'],
  ['6', 'phase_6'],
  ['executives', 'phase_6'],
  ['7', 'phase_7'],
  ['automotive', 'phase_7'],
  ['robots', 'phase_7'],
  ['8', 'phase_8'],
  ['aerospace', 'phase_8'],
  ['9', 'full'],
  ['full', 'full'],
  ['restaurants', 'full']
];

for (const [input, expected] of aliasTests) {
  const norm = RealmPhaseService.normalizePresetName(input);
  assert.equal(norm, expected, `Alias '${input}' must resolve to '${expected}', got '${norm}'`);
}
console.log(' [OK] Alias normalization verified for all 9 eras!\n');

// 4. Verify generated Px keeps the original realm identities and dynamic phase settings
console.log('[4/4] Verifying frontend Px script generation uses real realm names...');
const script = RealmPhaseService.generateFrontendPxScript();
assert.ok(script.includes('"idx":0'), 'Script must include realm index 0');
assert.ok(script.includes('"textId":"magnates"'), 'Script must identify realm 0 as Magnates');
assert.ok(script.includes('"name":"Magnates"'), 'Script must use the real Magnates realm name');
assert.ok(script.includes('"idx":1'), 'Script must include realm index 1');
assert.ok(script.includes('"textId":"entrepreneurs"'), 'Script must identify realm 1 as Entrepreneurs');
assert.ok(script.includes('"name":"Entrepreneurs"'), 'Script must use the real Entrepreneurs realm name');
assert.ok(script.includes('"idx":2'), 'Script must include realm index 2');
assert.ok(script.includes('"textId":"challenge"'), 'Script must identify realm 2 as Challenge');
assert.ok(script.includes('"name":"Challenge"'), 'Script must use the real Challenge realm name');
assert.ok(!script.includes('账号1') && !script.includes('账号2') && !script.includes('账号3'), 'Script must not relabel realms as accounts');
assert.ok(script.includes('"phase":8'), 'Script must retain dynamic phase settings');
console.log(' [OK] Real realm identities and dynamic Px settings verified!\n');

console.log('================================================================');
console.log(' [ALL TESTS PASSED] 9-ERA PROGRESSION & REALM IDENTITIES VERIFIED');
console.log('================================================================');
