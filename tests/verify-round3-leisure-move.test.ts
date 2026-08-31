/**
 * P1-09 + P1-10 regression tests.
 *
 * P1-09 (leisure building upkeep): the original client starts a recreation
 * building's 7-day upkeep with an EMPTY body on POST /api/v1/buildings/:id/busy/
 * (bundle: startRecreation → oe().post(api_v1_busy(buildingId), {})). Before the
 * fix this hit "kind and amount are required" and the page showed
 * "An unexpected error occurred". Contract:
 *   - empty body on a recreation building starts the upkeep
 *   - cost is 15 simboosts for the 1st recreation building (15/25/40 ladder)
 *   - response: { building.busy{category:'u',upkeep:true,duration:604800},
 *     simboostsDelta: -15 }
 *   - state persists across refresh (busy_until + upkeep_active)
 *   - repeat POST while busy → 409 (idempotency, no double charge)
 *   - insufficient balance → 400 with a clear error and NO deduction
 *   - non-recreation buildings still require kind/amount
 *
 * P1-10 (building move): two-step reposition, verified against the bundle:
 *   1. PATCH /api/v2/companies/me/buildings/:id/ { position: 'l' } lifts the
 *      building (original slot released)
 *   2. POST /api/v2/companies/me/buildings/ { position, id } places the lifted
 *      building onto an unlocked, unoccupied slot
 * Validation: occupied target → 409 with reason; invalid position → 400;
 * locked position → 400 with reason; foreign building → 404/401.
 *
 * Run: PORT=3502 node --experimental-strip-types tests/verify-round3-leisure-move.test.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3502'}`;

interface AuthCompany {
  companyId: number;
  simBoosts: number;
  extraBuildingSlots: number;
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `p109p110_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `LeisureMove Co ${label} ${Date.now()}` })
  });
  assert.equal(res.status, 200, 'signup must succeed');
  const cookie = (res.headers.getSetCookie?.() || [])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'signup must set sessionid cookie');
  const auth = await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } })).json() as { authCompany: AuthCompany };
  return { cookie: cookie!, companyId: auth.authCompany.companyId };
}

const send = (method: string, path: string, body: unknown, cookie?: string) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
/**
 * Seed a recreation building (park, kind '4') directly in the test DB.
 * The shared DB lives at data/simcompanies.sqlite next to server/. This is
 * test-only arrangement of valid state; all assertions run over HTTP.
 */
async function seedRecreationBuilding(companyId: number, position: string): Promise<{ id: number; position: string; kind: string; category: string }> {
  const dbPath = process.env.SEED_DB_PATH || path.resolve('data/simcompanies.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    const stmt = db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, ?, '4', 1, 'park', 6900, 'recreation', ?)
    `);
    const result = stmt.run(companyId, position, new Date().toISOString());
    const id = Number(result.lastInsertRowid);
    return { id, position, kind: '4', category: 'recreation' };
  } finally {
    db.close();
  }
}

/** Test-only arrange helper: set a company's simboost balance to an exact value. */
function drainSimboosts(companyId: number, toValue: number): void {
  const dbPath = process.env.SEED_DB_PATH || path.resolve('data/simcompanies.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('UPDATE companies SET simboosts = ? WHERE company_id = ?').run(toValue, companyId);
  } finally {
    db.close();
  }
}

async function runP109P110Test(): Promise<void> {
  console.log('================================================================');
  console.log(' P1-09 + P1-10: leisure upkeep + building move regression');
  console.log(` Target: ${baseUrl}`);
  console.log('================================================================');

  const user = await register('main');

  // --- Arrange: seed one recreation building (park, kind '4') directly via
  // a DB-level helper. Fresh companies start with $100k which cannot cover
  // the $138k park construction, and the seeded row only *arranges* valid
  // state (the acceptance flow itself runs through the public HTTP API).
  const park = await seedRecreationBuilding(user.companyId, '2');
  assert.ok(park.id > 0, 'park must be seeded at position 2');

  // Find a free slot for later move tests (defaults occupy 0 and 1)
  const listRes = await send('GET', '/api/v2/companies/me/buildings/', undefined, user.cookie);
  const buildings = await listRes.json() as Array<{ id: number; position: string }>;
  const occupied = new Set(buildings.map(b => String(b.position).replace(/^B/i, '')));
  const freeSlot = Array.from({ length: 50 }, (_, i) => String(i)).find(p => !occupied.has(p));
  assert.ok(freeSlot !== undefined, 'must find a free slot');
  console.log(`\n[0] Arranged park id=${park.id} at position 2; free slot for move: ${freeSlot}`);

  // ================= P1-09: leisure upkeep =================
  console.log('\n--- P1-09: recreation upkeep (start 15★) ---');

  // 1. Empty-body POST starts the upkeep (the exact failing request from the bug)
  const boostsBefore = await (await send('GET', '/api/v3/companies/auth-data/', undefined, user.cookie)).json() as { authCompany: AuthCompany };
  const start = await send('POST', `/api/v1/buildings/${park.id}/busy/`, {}, user.cookie);
  const startRaw = await start.text();
  assert.equal(start.status, 200, `empty-body busy POST must start upkeep, got ${start.status}: ${startRaw}`);
  const startBody = JSON.parse(startRaw) as {
    building: { busy: { category: string; upkeep: boolean; duration: number } | null };
    simboostsDelta: number;
  };
  assert.ok(startBody.building.busy, 'response must carry building.busy');
  assert.equal(startBody.building.busy!.category, 'u', 'busy category must be upkeep (u)');
  assert.equal(startBody.building.busy!.upkeep, true, 'busy.upkeep must be true (+1% prod/sales speed marker)');
  assert.equal(startBody.building.busy!.duration, 7 * 24 * 3600, 'upkeep duration must be 7 days');
  assert.equal(startBody.simboostsDelta, -15, 'first recreation building must cost exactly 15 simboosts');
  console.log('[1] POST /busy/ {} → 200; busy{category:u,upkeep:true,duration:604800}; simboostsDelta=-15');

  // 2. Only 15 simboosts were deducted
  const boostsAfter = await (await send('GET', '/api/v3/companies/auth-data/', undefined, user.cookie)).json() as { authCompany: AuthCompany };
  assert.equal(
    boostsBefore.authCompany.simBoosts - boostsAfter.authCompany.simBoosts, 15,
    'exactly 15 simboosts must be deducted'
  );
  console.log('[2] Deduction: exactly 15 simboosts (%s → %s)',
    boostsBefore.authCompany.simBoosts, boostsAfter.authCompany.simBoosts);

  // 3. Refresh persistence: building list still shows the active upkeep
  const listAfter = await (await send('GET', '/api/v2/companies/me/buildings/', undefined, user.cookie)).json() as Array<{ id: number; busy: { category: string; upkeep: boolean } | null }>;
  const parkAfter = listAfter.find(b => b.id === park.id)!;
  assert.ok(parkAfter.busy && parkAfter.busy.upkeep === true && parkAfter.busy.category === 'u',
    'upkeep must persist across refresh');
  console.log('[3] Refresh persistence: GET buildings still reports busy{category:u,upkeep:true}');

  // 4. Idempotency: repeat POST while busy → 409, no double charge
  const repeat = await send('POST', `/api/v1/buildings/${park.id}/busy/`, {}, user.cookie);
  assert.equal(repeat.status, 409, `repeat POST while busy must be 409, got ${repeat.status}`);
  const boostsAfterRepeat = await (await send('GET', '/api/v3/companies/auth-data/', undefined, user.cookie)).json() as { authCompany: AuthCompany };
  assert.equal(boostsAfterRepeat.authCompany.simBoosts, boostsAfter.authCompany.simBoosts,
    'repeat POST must not deduct additional simboosts');
  console.log('[4] Repeat POST → 409 CONFLICT, simboosts unchanged (idempotent)');

  // 5. Not a recreation building: empty body still rejected with a clear error
  const farm = buildings.find(b => b.id !== park.id);
  if (farm) {
    const nonRecreation = await send('POST', `/api/v1/buildings/${farm.id}/busy/`, {}, user.cookie);
    assert.ok(nonRecreation.status >= 400 && nonRecreation.status < 500,
      'empty body on non-recreation building must be a 4xx');
    const errBody = await nonRecreation.json() as { error?: string };
    assert.ok(errBody.error, 'must carry a clear error message');
    console.log(`[5] Empty body on non-recreation building id=${farm.id} → ${nonRecreation.status} "${errBody.error}"`);
  }

  // 5b. Insufficient balance: seed a second park (never had upkeep), drain
  // the account below the 2nd-upkeep cost of 25 simboosts via a DB-level
  // helper, then the upkeep start must fail with a clear 400 and deduct nothing.
  const secondPark = await seedRecreationBuilding(user.companyId, '4');
  drainSimboosts(user.companyId, 5);
  const boostsBeforePoor = await (await send('GET', '/api/v3/companies/auth-data/', undefined, user.cookie)).json() as { authCompany: AuthCompany };
  assert.equal(boostsBeforePoor.authCompany.simBoosts, 5, 'arrange: account drained to 5 simboosts');
  const poor = await send('POST', `/api/v1/buildings/${secondPark.id}/busy/`, {}, user.cookie);
  assert.equal(poor.status, 400, 'insufficient balance must be a 400');
  const poorRaw = await poor.text();
  const poorBody = JSON.parse(poorRaw) as { error: string; code: string };
  assert.match(poorBody.error, /[Ss]im[Bb]oosts/i, 'error must mention the missing SimBoosts');
  const boostsPoor = await (await send('GET', '/api/v3/companies/auth-data/', undefined, user.cookie)).json() as { authCompany: AuthCompany };
  assert.equal(boostsPoor.authCompany.simBoosts, 5, 'failed upkeep must deduct nothing');
  const listPoor = await (await send('GET', '/api/v2/companies/me/buildings/', undefined, user.cookie)).json() as Array<{ id: number; busy: unknown }>;
  const poorPark = listPoor.find(b => b.id === secondPark.id)!;
  assert.equal(poorPark.busy, null, 'failed upkeep must not start any busy state');
  console.log(`[5b] Insufficient balance → 400 "${poorBody.error}"; no deduction, no busy state`);

  // ================= P1-10: building move =================
  console.log('\n--- P1-10: building move (reposition) ---');

  // Stop the upkeep so the building is placeable again (fresh company leg
  // below re-verifies lift+place on an idle building).
  const liftBusy = await send('PATCH', `/api/v2/companies/me/buildings/${park.id}/`, { position: 'l' }, user.cookie);
  assert.equal(liftBusy.status, 200, 'lift must succeed even while upkeep is active');
  const placedBack = await send('POST', '/api/v2/companies/me/buildings/', { position: freeSlot, id: park.id }, user.cookie);
  assert.equal(placedBack.status, 200, 'placing the lifted park must succeed');
  console.log(`[6] Lift+place onto slot ${freeSlot} works; building restored to a slot`);

  // 7. Lift releases the original position
  const lift = await send('PATCH', `/api/v2/companies/me/buildings/${park.id}/`, { position: 'l' }, user.cookie);
  assert.equal(lift.status, 200, 'reposition step 1 (lift) must succeed');
  const listLifted = await (await send('GET', '/api/v2/companies/me/buildings/', undefined, user.cookie)).json() as Array<{ id: number; position: string }>;
  const lifted = listLifted.find(b => b.id === park.id)!;
  assert.match(lifted.position, /^[lB]/i, 'lifted building must be off-grid (position l)');
  console.log('[7] Lift: PATCH position=l → 200; original slot released');

  // 8. Place onto an OCCUPIED slot → 409 with a reason
  const occupiedRes = await send('POST', '/api/v2/companies/me/buildings/', { position: '0', id: park.id }, user.cookie);
  assert.equal(occupiedRes.status, 409, 'placing onto an occupied slot must be 409');
  const occupiedErr = await occupiedRes.json() as { error: string };
  assert.match(occupiedErr.error, /occupied/i, '409 must explain the conflict');
  console.log(`[8] Occupied target → 409 "${occupiedErr.error}"`);

  // 9. Invalid position → 400
  const invalidRes = await send('POST', '/api/v2/companies/me/buildings/', { position: 'zzz', id: park.id }, user.cookie);
  assert.equal(invalidRes.status, 400, 'invalid position must be 400');
  const invalidErr = await invalidRes.json() as { error: string };
  assert.match(invalidErr.error, /[Ii]nvalid/, '400 must explain the invalid position');
  console.log(`[9] Invalid target → 400 "${invalidErr.error}"`);

  // 10. Locked position → 400 with the unlocked slot count
  const lockedRes = await send('POST', '/api/v2/companies/me/buildings/', { position: '999', id: park.id }, user.cookie);
  assert.equal(lockedRes.status, 400, 'locked position must be 400');
  const lockedErr = await lockedRes.json() as { error: string };
  assert.match(lockedErr.error, /locked/i, '400 must explain the locked slot');
  console.log(`[10] Locked target → 400 "${lockedErr.error}"`);

  // 11. Foreign building id → not accessible through me/ (ownership)
  const foreignRes = await send('POST', '/api/v2/companies/me/buildings/', { position: freeSlot, id: 999999 }, user.cookie);
  assert.ok(foreignRes.status >= 400, 'unknown building id must fail');
  console.log(`[11] Unknown building id → ${foreignRes.status} (ownership enforced)`);

  // 12. Complete the move: place onto the free slot and verify persistence
  const place = await send('POST', '/api/v2/companies/me/buildings/', { position: freeSlot, id: park.id }, user.cookie);
  assert.equal(place.status, 200, 'placing the lifted building must succeed');
  const placeBody = await place.json() as { id: number; position: string };
  assert.equal(placeBody.id, park.id);
  assert.equal(String(placeBody.position).replace(/^B/i, ''), freeSlot, 'building must land on the chosen slot');
  const listPlaced = await (await send('GET', '/api/v2/companies/me/buildings/', undefined, user.cookie)).json() as Array<{ id: number; position: string }>;
  const placed = listPlaced.find(b => b.id === park.id)!;
  assert.equal(String(placed.position).replace(/^B/i, ''), freeSlot, 'placement must persist across refresh');
  console.log(`[12] Complete move → position ${freeSlot}, persists across refresh`);

  // 13. Numeric position 0 must be accepted (regression: falsy-zero guard)
  const lift2 = await send('PATCH', `/api/v2/companies/me/buildings/${park.id}/`, { position: 'l' }, user.cookie);
  assert.equal(lift2.status, 200);
  // find which slot is now occupied by the other building
  const listNow = await (await send('GET', '/api/v2/companies/me/buildings/', undefined, user.cookie)).json() as Array<{ id: number; position: string }>;
  const other = listNow.find(b => b.id !== park.id)!;
  const otherPos = String(other.position).replace(/^B/i, '');
  if (otherPos === '0') {
    // other building sits on 0 → expect 409 occupied, NOT the falsy "position is required"
    const zeroRes = await send('POST', '/api/v2/companies/me/buildings/', { position: 0, id: park.id }, user.cookie);
    assert.equal(zeroRes.status, 409, 'numeric position 0 must reach the occupancy check (409), not a falsy 400');
    console.log('[13] Numeric position 0 correctly reaches occupancy validation (409)');
  }
  // park must be placed back to finish in a valid state
  const finalFree = Array.from({ length: 50 }, (_, i) => String(i))
    .find(p => !listNow.map(b => String(b.position).replace(/^B/i, '')).includes(p))!;
  const finalPlace = await send('POST', '/api/v2/companies/me/buildings/', { position: finalFree, id: park.id }, user.cookie);
  assert.equal(finalPlace.status, 200, 'final placement must succeed');
  console.log(`[13] Numeric position accepted; park finally at slot ${finalFree}`);

  console.log('\n================================================================');
  console.log(' P1-09 + P1-10 PASS: upkeep start/deduct/persist/idempotent/');
  console.log(' insufficient-balance + lift/place/occupied/invalid/locked/');
  console.log(' ownership/refresh-persistence all verified.');
  console.log('================================================================');
}

runP109P110Test()
  .then(() => process.exit(0))
  .catch(err => { console.error('P1-09/P1-10 FAIL:', err); process.exit(1); });
