import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { listUnlockedHqs, unlockHq, getSelectedHq, HQ_SKINS } from '../server/application/social/unlockables.ts';
import { getPaymentPackagesList, purchasePaymentPackage } from '../server/game/simboosts.ts';
import { getCompanyHqImage } from '../server/game/company.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';

async function run() {
  console.log('=== Verifying Unlocked HQs & HQ Packages ===');

  // Create a temporary test company
  const companyId = 99901;
  db.prepare('DELETE FROM player_unlocked_hqs WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM company_settings WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM companies WHERE company_id = ?').run(companyId);
  db.prepare('INSERT INTO companies (company_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(companyId, 'Test HQ Co', 100000, 500, 10, 'AA', 1000, 0, '', 'old', '');

  // 1. Initial listUnlockedHqs
  const initialHqs = listUnlockedHqs(companyId);
  console.log(`[1] listUnlockedHqs returns ${initialHqs.length} HQs`);
  assert.equal(initialHqs.length, 22, 'Selectable HQ list must contain 22 items (17 official + 5 added)');

  // Verify the 5 newly added HQs are in the list
  const atc = initialHqs.find(h => h.idx === 25);
  assert.ok(atc, 'ATC Tower (idx 25) must be present');
  assert.equal(atc.simboosts, 250);
  assert.equal(atc.unlocked, false);

  const obsidian = initialHqs.find(h => h.idx === 11);
  assert.ok(obsidian, 'Obsidian (idx 11) must be present');
  assert.equal(obsidian.simboosts, 250);

  const ariake = initialHqs.find(h => h.idx === 6);
  assert.ok(ariake, 'Ariake (idx 6) must be present');
  assert.equal(ariake.simboosts, 200);

  const xmasTownHall = initialHqs.find(h => h.idx === 10);
  assert.ok(xmasTownHall, 'Town Hall with Xmas tree (idx 10) must be present');
  assert.equal(xmasTownHall.simboosts, 190);

  const cabin = initialHqs.find(h => h.idx === 8);
  assert.ok(cabin, 'The Cabin (idx 8) must be present');
  assert.equal(cabin.simboosts, 150);
  const defaultHq = initialHqs.find(h => h.idx === 0);
  assert.ok(defaultHq, 'idx 0 must be present');
  assert.equal(defaultHq.unlocked, true, 'idx 0 must be unlocked by default');
  assert.equal(defaultHq.simboosts, 0);

  const golfHq = initialHqs.find(h => h.idx === 1);
  assert.ok(golfHq, 'idx 1 must be present');
  assert.equal(golfHq.unlocked, false, 'idx 1 must be locked initially');
  assert.equal(golfHq.simboosts, 100);

  // 2. Unlock Golf HQ (idx 1, 100 SimBoosts)
  console.log('[2] Unlocking Golf HQ (idx 1)...');
  const updatedHqs = await unlockHq(companyId, 1);
  const updatedGolf = updatedHqs.find(h => h.idx === 1);
  assert.ok(updatedGolf);
  assert.equal(updatedGolf.unlocked, true, 'idx 1 must now be unlocked');

  // Check SimBoosts deducted (500 - 100 = 400)
  const remainingSimboosts = companyRepository.findById(companyId).simboosts;
  assert.equal(remainingSimboosts, 400, 'SimBoosts should be debited by 100');

  // Check active HQ image is updated
  assert.equal(getSelectedHq(companyId), 'images/landscape/hq/hq-golf.png');
  assert.equal(getCompanyHqImage(companyId), 'images/landscape/hq/hq-golf.png');

  // 3. Switch back to default HQ (idx 0)
  console.log('[3] Switching back to default HQ (idx 0)...');
  const switchedHqs = await unlockHq(companyId, 0);
  assert.equal(getSelectedHq(companyId), '');
  assert.equal(companyRepository.findById(companyId).simboosts, 400);

  // 3b. Unlock ATC Tower (idx 25, 250 SimBoosts)
  console.log('[3b] Unlocking ATC Tower (idx 25)...');
  const atcUnlockedHqs = await unlockHq(companyId, 25);
  const atcAfter = atcUnlockedHqs.find(h => h.idx === 25);
  assert.equal(atcAfter?.unlocked, true);
  assert.equal(companyRepository.findById(companyId).simboosts, 150); // 400 - 250 = 150
  assert.equal(getSelectedHq(companyId), 'images/buildings/other/hq_atc_tower.png');
  assert.equal(getCompanyHqImage(companyId), 'images/buildings/other/hq_atc_tower.png');

  // 4. Payment packages include Cyber Tower
  console.log('[4] Verifying Payment Packages...');
  const packagesList = getPaymentPackagesList('web');
  const cyber1 = packagesList.packages.find(p => p.sku === 'sb-hqcybert1');
  assert.ok(cyber1, 'sb-hqcybert1 must be in payment packages');
  assert.equal(cyber1.hq, 12);
  assert.equal(cyber1.wideFrame, true);

  // 5. Purchase Cyber Tower package unlocks idx 12
  console.log('[5] Purchasing Cyber Tower package...');
  await purchasePaymentPackage(companyId, 'sb-hqcybert1');
  const withCyber = listUnlockedHqs(companyId);
  const cyberHq = withCyber.find(h => h.idx === 12);
  assert.ok(cyberHq, 'idx 12 Cyber Tower must now appear in unlocked HQs');
  assert.equal(cyberHq.unlocked, true, 'idx 12 must be unlocked');

  // Cleanup
  db.prepare('DELETE FROM player_unlocked_hqs WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM company_settings WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM companies WHERE company_id = ?').run(companyId);

  console.log('✅ ALL CHECKS PASSED!');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
