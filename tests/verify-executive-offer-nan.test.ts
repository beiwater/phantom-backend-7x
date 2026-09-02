import assert from 'node:assert';
import { formatOffer, formatHostileOffer } from '../server/game/executives.ts';

console.log('=== Verifying Executive Found & Standing Offer Timestamps (Issue #150 / #144) ===');

// [1/4] Test 'found' status with null extended_at
console.log('[1/4] Testing found status offer with null extended_at...');
const foundOffer: any = {
  id: 101,
  slot_position: 'cfo',
  skill_position: 'o',
  agency: 1,
  status: 'found',
  expected_salary: 450,
  salary: null,
  agency_fee: 100,
  target_executive_id: 1,
  accelerated: 0,
  extended_at: null,
  created_at: '2026-09-02T08:00:00.000Z',
  research_poacher: null
};

const formattedFound = formatOffer(foundOffer, null);
assert.ok(typeof formattedFound.extended === 'string', 'extended MUST be a string ISO date');
assert.strictEqual(formattedFound.extended, '2026-09-02T08:00:00.000Z', 'extended should fallback to created_at');
assert.ok(!Number.isNaN(Date.parse(formattedFound.extended)), 'Date.parse(extended) MUST NOT be NaN');
console.log(`  -> Found offer extended: ${formattedFound.extended}`);

// [2/4] Test 'standing' status with null extended_at
console.log('[2/4] Testing standing status offer with null extended_at...');
const standingOffer: any = {
  id: 102,
  slot_position: 'cto',
  skill_position: 'o',
  agency: 2,
  status: 's',
  expected_salary: 500,
  salary: 500,
  agency_fee: 200,
  target_executive_id: 2,
  accelerated: 1,
  extended_at: null,
  created_at: '2026-09-02T08:30:00.000Z',
  research_poacher: null
};

const formattedStanding = formatOffer(standingOffer, null);
assert.ok(typeof formattedStanding.extended === 'string', 'extended MUST be a string ISO date');
assert.strictEqual(formattedStanding.extended, '2026-09-02T08:30:00.000Z');
assert.ok(!Number.isNaN(Date.parse(formattedStanding.extended)), 'Date.parse(extended) MUST NOT be NaN');
console.log(`  -> Standing offer extended: ${formattedStanding.extended}`);

// [3/4] Test corrupted date strings (e.g. invalid date text)
console.log('[3/4] Testing corrupt date strings fallback...');
const corruptOffer: any = {
  id: 103,
  slot_position: 'coo',
  skill_position: 'o',
  agency: 1,
  status: 'found',
  expected_salary: 400,
  salary: null,
  agency_fee: 100,
  target_executive_id: 3,
  accelerated: 0,
  extended_at: 'INVALID_TIMESTAMP_GARBAGE',
  created_at: 'ALSO_INVALID',
  research_poacher: null
};

const formattedCorrupt = formatOffer(corruptOffer, null);
assert.ok(typeof formattedCorrupt.extended === 'string', 'extended MUST be a valid ISO string');
assert.ok(!Number.isNaN(Date.parse(formattedCorrupt.extended)), 'Date.parse(extended) MUST NOT be NaN');
console.log(`  -> Corrupt offer safely fell back to: ${formattedCorrupt.extended}`);

// [4/4] Test hostile offer format
console.log('[4/4] Testing hostile offer format...');
const hostileOffer: any = {
  id: 104,
  target_executive_id: 4,
  expected_salary: 600,
  salary: 600,
  status: 'pending',
  extended_at: null,
  created_at: '2026-09-02T09:00:00.000Z',
  target_company_id: 1,
  poacher_company_id: 2,
  research_employer: null
};

const formattedHostile = formatHostileOffer(hostileOffer, null);
assert.ok(typeof formattedHostile.extended === 'string');
assert.strictEqual(formattedHostile.extended, '2026-09-02T09:00:00.000Z');

console.log('================================================================');
console.log(' [OK] ISSUE #150 EXECUTIVE OFFER TIMESTAMPS PASSED ALL TESTS');
console.log('================================================================');
