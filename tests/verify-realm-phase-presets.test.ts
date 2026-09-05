import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import { RealmPhaseService, REALM_PHASE_PRESETS } from '../server/services/realm-phase-service.ts';
import { constructBuildingUseCase } from '../server/application/buildings/construct-building.ts';
import { issueBondsUseCase } from '../server/application/finance/bond-use-cases.ts';
import { NpcMarketService, NPC_SELLER_ID } from '../server/services/npc-market-service.ts';
import { ValidationError } from '../server/errors/domain-error.ts';

console.log('=== Verifying Realm Phase Presets & Custom Overrides (realms-guide) ===\n');

// 1. Verify Phase Presets definition
console.log('[1/7] Verifying standard phase presets against realms-guide specifications...');
const p1 = REALM_PHASE_PRESETS.phase_1;
const p2 = REALM_PHASE_PRESETS.phase_2;
const p3 = REALM_PHASE_PRESETS.phase_3;

assert.strictEqual(p1.phase, 0, 'Phase 1 should be phase 0 (0-indexed)');
assert.strictEqual(p1.researchLimit, 0, 'Phase 1 research limit should be Q0');
assert.strictEqual(p1.bonds, false, 'Phase 1 bonds should be disabled');
assert.strictEqual(p1.govOrders, false, 'Phase 1 government orders should be disabled');
assert.strictEqual(p1.executives, false, 'Phase 1 executives should be disabled');

assert.strictEqual(p2.phase, 1, 'Phase 2 should be phase 1 (0-indexed)');
assert.strictEqual(p2.researchLimit, 2, 'Phase 2 research limit should be Q2');
assert.strictEqual(p2.bonds, false, 'Phase 2 bonds should be disabled');

assert.strictEqual(p3.phase, 2, 'Phase 3 should be phase 2 (0-indexed)');
assert.strictEqual(p3.researchLimit, 4, 'Phase 3 research limit should be Q4');
assert.strictEqual(p3.bonds, true, 'Phase 3 bonds should be enabled');
assert.strictEqual(p3.govOrders, true, 'Phase 3 government orders should be enabled');
console.log('  [OK] Preset definitions verified!\n');

// 2. Test Phase 1 (Agriculture) building unlocks
console.log('[2/7] Verifying building unlock filtering in Phase 1 (Agriculture)...');
RealmPhaseService.setPreset('phase_1');
const p1Config = RealmPhaseService.getActiveRealmConfig();
assert.strictEqual(p1Config.phase, 0);

// Basic agricultural buildings (sincePhase 0) must be unlocked
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('P'), true, 'Plantation (P) must be unlocked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('W'), true, 'Reservoir (W) must be unlocked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('E'), true, 'Power Plant (E) must be unlocked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('F'), true, 'Farm (F) must be unlocked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('G'), true, 'Grocery Store (G) must be unlocked in Phase 1');

// Advanced buildings (sincePhase >= 1) must be locked in Phase 1
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('O'), false, 'Oil Rig (O, Phase 2) must be locked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('R'), false, 'Refinery (R, Phase 2) must be locked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('S'), false, 'Shipping Depot (S, Phase 3) must be locked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('M'), false, 'Mine (M, Phase 4) must be locked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('1'), false, 'Car Factory (1, Phase 7) must be locked in Phase 1');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('7'), false, 'Aerospace Factory (7, Phase 8) must be locked in Phase 1');
console.log('  [OK] Phase 1 building unlocks correctly filtered!\n');

// 3. Test Phase 2 (Fashion & Research) building unlocks
console.log('[3/7] Verifying building unlock filtering in Phase 2 (Fashion & Research)...');
RealmPhaseService.setPreset('phase_2');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('O'), true, 'Oil Rig (O) must unlock in Phase 2');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('R'), true, 'Refinery (R) must unlock in Phase 2');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('T'), true, 'Clothes Factory (T) must unlock in Phase 2');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('p'), true, 'Plant Research (p) must unlock in Phase 2');
// Later phase buildings must still be locked
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('S'), false, 'Shipping Depot (S, Phase 3) must still be locked in Phase 2');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('M'), false, 'Mine (M, Phase 4) must still be locked in Phase 2');
console.log('  [OK] Phase 2 building unlocks correctly filtered!\n');

// 4. Test Phase 3 (Energy, Bonds & GO) unlocks
console.log('[4/7] Verifying Phase 3 (Energy, Bonds & Government Orders) unlocks...');
RealmPhaseService.setPreset('phase_3');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('S'), true, 'Shipping Depot (S) must unlock in Phase 3');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('6'), true, 'Beverage Factory (6) must unlock in Phase 3');
assert.strictEqual(RealmPhaseService.isBuildingUnlocked('Q'), true, 'Quarry (Q) must unlock in Phase 3');
assert.strictEqual(RealmPhaseService.getActiveRealmConfig().bonds, true, 'Bonds must be enabled in Phase 3');
assert.strictEqual(RealmPhaseService.getActiveRealmConfig().govOrders, true, 'Government Orders must be enabled in Phase 3');
console.log('  [OK] Phase 3 features and buildings verified!\n');

// 5. Test Backend Construction and Bond gates
console.log('[5/7] Verifying backend construction and bond enforcement gates...');
RealmPhaseService.setPreset('phase_1');
const testComp = db.prepare('SELECT company_id FROM companies LIMIT 1').get() as { company_id: number };
const testCompId = testComp?.company_id || 1;

// Construction gate: attempting to construct an Oil Rig (kind O) in Phase 1 must throw ValidationError
let constructError: unknown = null;
try {
  await constructBuildingUseCase({ companyId: testCompId } as any, { kind: 'O', position: '99' });
} catch (err) {
  constructError = err;
}
assert.ok(constructError instanceof ValidationError, 'Constructing locked building must throw ValidationError');
console.log(`  -> Locked building construct error: ${(constructError as Error).message}`);

// Bond gate: attempting to issue bonds in Phase 1 must throw error
let bondError: unknown = null;
try {
  issueBondsUseCase({ companyId: testCompId } as any, 50000, 0.01);
} catch (err) {
  bondError = err;
}
assert.ok(bondError instanceof Error, 'Issuing bonds in Phase 1 must throw error');
assert.ok((bondError as Error).message.includes('Corporate bonds are not unlocked'), 'Error must specify bonds are locked');
console.log(`  -> Locked bonds error: ${(bondError as Error).message}`);
console.log('  [OK] Backend construction and bond gates verified!\n');
// 6. Test Custom overrides on top of presets ("这个是预设，但是还是可以自己调整的")
console.log('[6/7] Verifying custom parameter overrides on top of presets...');
// User wants Phase 1 preset, but manually allows Bonds and sets Research Limit to Q4
const customized = RealmPhaseService.setPreset('phase_1', {
  bonds: true,
  researchLimit: 4
});

assert.strictEqual(customized.phase, 0, 'Phase remains 0 from preset');
assert.strictEqual(customized.bonds, true, 'Bonds custom override must be true');
assert.strictEqual(customized.researchLimit, 4, 'Research limit custom override must be 4');
assert.strictEqual(customized.govOrders, false, 'Other fields retain preset defaults (govOrders = false)');
console.log(`  -> Customized Config: phase=${customized.phase}, bonds=${customized.bonds}, researchLimit=Q${customized.researchLimit}, govOrders=${customized.govOrders}`);
console.log('  [OK] Custom overrides on top of presets verified!\n');

// 7. Test Frontend Px script generator
console.log('[7/7] Verifying frontend Px script generation...');
RealmPhaseService.setPreset('phase_1');
const p1Script = RealmPhaseService.generateFrontendPxScript();
assert.ok(p1Script.includes('"phase":0'), 'Frontend script must contain "phase":0');
assert.ok(p1Script.includes('"researchLimit":0'), 'Frontend script must contain "researchLimit":0');
assert.ok(p1Script.includes('"bonds":false'), 'Frontend script must contain "bonds":false');

RealmPhaseService.setPreset('phase_3');
const p3Script = RealmPhaseService.generateFrontendPxScript();
assert.ok(p3Script.includes('"phase":2'), 'Frontend script must contain "phase":2');
assert.ok(p3Script.includes('"researchLimit":4'), 'Frontend script must contain "researchLimit":4');
assert.ok(p3Script.includes('"bonds":true'), 'Frontend script must contain "bonds":true');
console.log('  [OK] Frontend Px script injection verified!\n');

console.log('================================================================');
console.log(' [ALL TESTS PASSED] REALM PHASE PRESETS & CUSTOM SWITCH VERIFIED');
console.log('================================================================');
