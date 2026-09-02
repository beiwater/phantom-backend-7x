import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import {
  formatExecutive,
  formatOffer,
  seedDefaultExecutives,
  createPoachingOffer,
  getPoachingOffers,
  getCompanyExecutives,
  getExecutiveCandidates
} from '../server/game/executives.ts';
import { FixtureService } from '../server/services/fixture-service.ts';

console.log('=== Verifying Issue #144: Boardroom Candidate Genome Diversity & Safe Extended Dates ===');

// 1. Setup test company
const { companyId } = await FixtureService.applyScenario({
  companyName: 'Executive Candidate Test Co',
  money: 1000000,
  level: 30
});

// [1/4] Test genome diversity on candidates and executives
console.log('[1/4] Testing genome diversity across executives and candidates...');
seedDefaultExecutives(companyId);

const executives = getCompanyExecutives(companyId);
const candidates = getExecutiveCandidates(companyId);

const allPeople = [...executives, ...candidates];
assert.ok(allPeople.length >= 4, 'Should have at least 4 executives and candidates');

const genomes = new Set<string>();
const ages = new Set<number>();

for (const p of allPeople) {
  console.log(`-> Person: ${p.name} | Age: ${p.age} | Genome: ${p.genome}`);
  assert.match(p.genome, /^(male|female)-\d{2}-\d+-\d+-\d+-\d+-\d+$/, `Genome ${p.genome} must match valid format`);
  assert.ok(p.age >= 25 && p.age <= 65, `Age ${p.age} should be between 25 and 65`);
  genomes.add(p.genome);
  ages.add(p.age);
}

assert.ok(genomes.size > 1, 'Candidates and executives must not all look identical (Issue #144)');
console.log(`[OK] Generated ${genomes.size} unique appearances and ${ages.size} distinct ages across ${allPeople.length} people.`);

// [2/4] Test standing offers date format (no NaN)
console.log('[2/4] Testing standing offers date format (preventing NaN in DOM)...');

// Create a headhunting offer
const offer = await createPoachingOffer(companyId, {
  agency: 1, // staffing agency
  slotPosition: 'coo',
  skillPosition: 'o'
});

// Format with standing status and null extended_at
const rawStandingOffer = {
  id: 99,
  poacher_company_id: companyId,
  target_company_id: 99999,
  target_executive_id: executives[0].id,
  slot_position: 'cfo',
  skill_position: 'f',
  agency: 1,
  status: 's', // standing
  expected_salary: 450,
  salary: 450,
  agency_fee: 450,
  extended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  accelerated: 0,
  research_poacher: null
};

const formatted = formatOffer(rawStandingOffer as any, executives[0] as any);
console.log('-> Formatted standing offer extended timestamp:', formatted.extended);
assert.ok(formatted.extended, 'Standing offer extended field must be present');
const parsed = Date.parse(formatted.extended!);
assert.strictEqual(Number.isNaN(parsed), false, 'Date.parse(extended) must NOT be NaN (Issue #144)');

// [3/4] Verify getPoachingOffers returns valid non-NaN timestamps
console.log('[3/4] Verifying getPoachingOffers returns valid timestamps...');
const offers = getPoachingOffers(companyId);
for (const off of offers) {
  if (off.status === 's') {
    assert.ok(off.extended, 'Standing offer must have extended timestamp');
    assert.strictEqual(Number.isNaN(Date.parse(off.extended)), false, 'Extended date must be a valid timestamp');
  }
}

console.log('================================================================');
console.log(' [OK] ISSUE #144 CANDIDATE DIVERSITY & DATES PASSED ALL CHECKS');
console.log('================================================================');
