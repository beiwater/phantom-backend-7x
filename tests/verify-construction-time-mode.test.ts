import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import {
  getBuildingBuildDuration,
  calculateConstructionDurationSeconds,
  formatDurationHuman
} from '../server/domain/buildings/building-rules.ts';
import { constructBuildingUseCase } from '../server/application/buildings/construct-building.ts';
import { rushBuildingConstructionUseCase } from '../server/application/buildings/rush-construction.ts';
import { toSimCompaniesBuildingDTO } from '../server/compatibility/simcompanies/building-dto.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { addResource } from '../server/game/warehouse.ts';
import { handleDebugRoutes } from '../server/routes/debug-routes.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';
console.log('=== Verifying Realistic Construction Time & One-Click Toggle ===');

// -----------------------------------------------------------------------------
// PART 1: Encyclopedia Formulas & Pure Domain Rules
// -----------------------------------------------------------------------------
console.log('\n[1/6] Verifying encyclopedia build durations & calculation formulas...');

assert.equal(getBuildingBuildDuration('P'), 3600, 'Plantation buildDuration must be 3600s (1h)');
assert.equal(getBuildingBuildDuration('W'), 7200, 'Water reservoir buildDuration must be 7200s (2h)');
assert.equal(getBuildingBuildDuration('E'), 10800, 'Power plant buildDuration must be 10800s (3h)');
assert.equal(getBuildingBuildDuration('1'), 21600, 'Car factory buildDuration must be 21600s (6h)');
assert.equal(getBuildingBuildDuration('l'), 32400, 'Launchpad buildDuration must be 32400s (9h)');
assert.equal(getBuildingBuildDuration('3'), 43200, 'Castle buildDuration must be 43200s (12h)');

// Test mode is always flat 10s
assert.equal(calculateConstructionDurationSeconds('P', 1, 'test'), 10, 'Test mode must return 10s');
assert.equal(calculateConstructionDurationSeconds('W', 1, 'test'), 10, 'Test mode must return 10s');

// Realistic mode uses encyclopedia buildDuration
assert.equal(calculateConstructionDurationSeconds('P', 1, 'realistic'), 3600, 'Realistic new build must be 3600s');
assert.equal(calculateConstructionDurationSeconds('W', 1, 'realistic'), 7200, 'Realistic new build must be 7200s');
assert.equal(calculateConstructionDurationSeconds('P', 2, 'realistic'), 7200, 'Realistic upgrade (2 levels) must be 7200s');

// Speed multiplier accelerates real construction time
assert.equal(calculateConstructionDurationSeconds('P', 1, 'realistic', 2), 1800, '2x speed must halve construction time');
assert.equal(calculateConstructionDurationSeconds('P', 1, 'realistic', 4), 900, '4x speed must quarter construction time');

// Human formatting
assert.equal(formatDurationHuman(10), '10s');
assert.equal(formatDurationHuman(3600), '1h');
assert.equal(formatDurationHuman(5400), '1h 30m');
assert.equal(formatDurationHuman(32400), '9h');

console.log('  ✔ All encyclopedia formulas and duration calculations passed.');

// -----------------------------------------------------------------------------
// PART 2: One-Click Toggle & Mode Persistence
// -----------------------------------------------------------------------------
console.log('\n[2/6] Verifying one-click toggle and persistence...');

const initialMode = FixtureService.getConstructionTimeMode();
console.log(`  Initial mode: ${initialMode.mode}`);

// Toggle to realistic
const realisticRes = await FixtureService.setConstructionTimeMode('realistic');
assert.equal(realisticRes.mode, 'realistic', 'Mode must be realistic');
assert.equal(FixtureService.getActiveConstructionTimeMode(), 'realistic');
assert.ok(realisticRes.description.includes('Realistic'));
assert.equal(realisticRes.samples.length, 5);
assert.equal(realisticRes.samples.find(s => s.kind === 'P')?.durationSeconds, 3600);

// Check DB persistence directly
const savedRow = db.prepare("SELECT value FROM company_settings WHERE company_id = 0 AND key = 'construction_time_mode'").get() as { value: string };
assert.equal(savedRow.value, 'realistic', 'Mode must be persisted in company_settings');

console.log('  ✔ One-click toggle switched mode and persisted to DB.');

// -----------------------------------------------------------------------------
// PART 3: Constructing in Realistic Mode (Real Encyclopedia Duration)
// -----------------------------------------------------------------------------
console.log('\n[3/6] Verifying actual building construction in realistic mode...');

// Set up test company
const fixture = await FixtureService.applyPreset('fresh-account', {
  companyName: 'Construction Test Corp',
  money: 5000000,
  simboosts: 100
});
const companyId = fixture.companyId;
const ctx = {
  companyId,
  auth: { companyId, playerId: fixture.playerId, realmId: 0 }
} as any;
// Seed warehouse with construction materials (planks 101, bricks 102, concrete 108, steel 111)
addResource(companyId, 101, 0, 1000);
addResource(companyId, 102, 0, 1000);
addResource(companyId, 108, 0, 1000);
addResource(companyId, 111, 0, 1000);

virtualClock.reset();
const nowMs = virtualClock.nowMs();

// Construct Plantation (kind 'P', buildDuration = 3600s = 1 hour)
const constructResult = await constructBuildingUseCase(ctx, {
  kind: 'P',
  position: '20'
});

assert.ok(constructResult.building.busyUntil, 'Constructed building must have busyUntil');
const busyUntilMs = new Date(constructResult.building.busyUntil!).getTime();
const actualDurationSec = Math.round((busyUntilMs - nowMs) / 1000);
console.log(`  Constructed Plantation: duration = ${actualDurationSec}s (expected ~3600s)`);
assert.ok(
  Math.abs(actualDurationSec - 3600) <= 2,
  `Plantation construction duration should be 3600s, got ${actualDurationSec}s`
);

// Check building DTO representation
const freshEntity = buildingRepository.findById(constructResult.building.id, companyId)!;
const dto = toSimCompaniesBuildingDTO(freshEntity);
assert.ok(dto.busy, 'Building DTO must have busy object');
assert.equal(dto.busy.category, 'b', 'Category must be building (b)');
assert.equal(dto.busy.expanding, true, 'Expanding must be true');
assert.equal(dto.busy.duration, 3600, 'DTO busy.duration must match 3600s');

console.log('  ✔ Realistic construction correctly occupied 1-hour busy window in DB and DTO.');

// -----------------------------------------------------------------------------
// PART 4: Time Acceleration (Time Warp) on Real Construction Time
// -----------------------------------------------------------------------------
console.log('\n[4/6] Verifying time acceleration (time warp) resolves real construction...');

// Advance virtual clock by 30 minutes (1800s) — building should STILL be busy
virtualClock.advance({ minutes: 30 });
const midCheckEntity = buildingRepository.findById(constructResult.building.id, companyId)!;
const midDto = toSimCompaniesBuildingDTO(midCheckEntity);
assert.ok(midDto.busy, 'After 30 minutes, 1-hour construction must still be in progress');
console.log('  ✔ After +30m time warp: construction remains properly busy (50% progress)');

// Advance another 35 minutes (total +65 minutes > 60 minutes) — building must finish!
virtualClock.advance({ minutes: 35 });
const cycles = await virtualClock.resolveAllOverdue();
console.log(`  Resolved overdue cycles: ${cycles.completedConstructions} construction(s) completed`);
assert.ok(cycles.completedConstructions >= 1, 'Virtual clock must have resolved the completed construction');

// Check DB and DTO state
const finishedEntity = buildingRepository.findById(constructResult.building.id, companyId)!;
assert.equal(finishedEntity.busyUntil, null, 'busy_until in DB must be cleared to null');
const finishedDto = toSimCompaniesBuildingDTO(finishedEntity);
assert.equal(finishedDto.busy, null, 'DTO busy state must be null after time acceleration');
assert.equal(finishedDto.level, 1, 'Building is now completed at level 1');

console.log('  ✔ Time warp acceleration successfully advanced and completed real construction time!');

// -----------------------------------------------------------------------------
// PART 5: SimBoost Rush Acceleration on Real Construction Time
// -----------------------------------------------------------------------------
console.log('\n[5/6] Verifying SimBoost rush instantly finishes real construction...');

// Construct Water Reservoir (kind 'W', buildDuration = 7200s = 2 hours)
const waterConstructResult = await constructBuildingUseCase(ctx, {
  kind: 'W',
  position: '21'
});
assert.ok(waterConstructResult.building.busyUntil, 'Water reservoir must have busyUntil');
const waterBusyUntilMs = new Date(waterConstructResult.building.busyUntil!).getTime();
const waterDurationSec = Math.round((waterBusyUntilMs - virtualClock.nowMs()) / 1000);
assert.ok(
  Math.abs(waterDurationSec - 7200) <= 2,
  `Water reservoir construction duration should be 7200s, got ${waterDurationSec}s`
);
console.log(`  Constructed Water Reservoir: 2-hour build window active (${waterDurationSec}s)`);

// Rush with 5 SimBoosts
const initialSb = companyRepository.findById(companyId)?.simboosts || 0;
const rushResult = await rushBuildingConstructionUseCase(ctx, {
  buildingId: waterConstructResult.building.id
});

const waterAfterRush = buildingRepository.findById(waterConstructResult.building.id, companyId)!;
assert.equal(waterAfterRush.busyUntil, null, 'DB busy_until must be null');
const waterDtoAfterRush = toSimCompaniesBuildingDTO(waterAfterRush);
assert.equal(waterDtoAfterRush.busy, null, 'DTO busy must be null');

console.log('  ✔ SimBoost rush acceleration instantly completed real 2-hour construction!');

// -----------------------------------------------------------------------------
// PART 6: Switching Back to Test Mode & Teardown
// -----------------------------------------------------------------------------
console.log('\n[6/6] Verifying switch back to test mode (10s fast build)...');

await FixtureService.setConstructionTimeMode('test');
assert.equal(FixtureService.getActiveConstructionTimeMode(), 'test');

// Construct in test mode
const testBuildResult = await constructBuildingUseCase(ctx, {
  kind: 'P',
  position: '22'
});
const testBusyUntilMs = new Date(testBuildResult.building.busyUntil!).getTime();
const testDurationSec = Math.round((testBusyUntilMs - virtualClock.nowMs()) / 1000);
assert.ok(
  Math.abs(testDurationSec - 10) <= 2,
  `Test mode construction duration should be 10s, got ${testDurationSec}s`
);
console.log(`  Constructed Plantation in test mode: ${testDurationSec}s (expected 10s)`);

// -----------------------------------------------------------------------------
// PART 7: HTTP API Endpoints (/api/v2/debug/construction-mode/)
// -----------------------------------------------------------------------------
console.log('\n[7/7] Verifying HTTP API endpoints for construction mode toggle...');

function createMockRes(): { res: any; getStatus: () => number; getBody: () => any } {
  let status = 200;
  let data: any = null;
  const res: any = {
    writeHead: (s: number, _headers?: any) => { status = s; return res; },
    setHeader: () => res,
    getHeader: () => null,
    end: (content: string) => {
      try { data = JSON.parse(content); } catch { data = content; }
    }
  };
  return { res, getStatus: () => status, getBody: () => data };
}

// Test GET /api/v2/debug/construction-mode/
const mockGet = createMockRes();
await handleDebugRoutes({ headers: {} } as any, mockGet.res, '/api/v2/debug/construction-mode/', 'GET', null, null);
assert.equal(mockGet.getStatus(), 200);
assert.equal(mockGet.getBody().mode, 'test');
assert.ok(Array.isArray(mockGet.getBody().samples));

// Test POST with toggle: true -> switches to realistic
const mockToggle1 = createMockRes();
const reqToggle1: any = { headers: {} };
setPreparsedBody(reqToggle1, { toggle: true });
await handleDebugRoutes(reqToggle1, mockToggle1.res, '/api/v2/debug/construction-mode/', 'POST', null, null);
assert.equal(mockToggle1.getStatus(), 200);
assert.equal(mockToggle1.getBody().mode, 'realistic');
assert.equal(FixtureService.getActiveConstructionTimeMode(), 'realistic');

// Test POST with toggle: true -> switches back to test
const mockToggle2 = createMockRes();
const reqToggle2: any = { headers: {} };
setPreparsedBody(reqToggle2, { toggle: true });
await handleDebugRoutes(reqToggle2, mockToggle2.res, '/api/v2/debug/construction-mode/', 'POST', null, null);
assert.equal(mockToggle2.getStatus(), 200);
assert.equal(mockToggle2.getBody().mode, 'test');
assert.equal(FixtureService.getActiveConstructionTimeMode(), 'test');

console.log('  ✔ HTTP GET and POST /api/v2/debug/construction-mode/ verified successfully.');

virtualClock.reset();
console.log('\n================================================================');
console.log(' ✅ ALL REALISTIC CONSTRUCTION TIME & TIME WARP TESTS PASSED!');
console.log('================================================================');
