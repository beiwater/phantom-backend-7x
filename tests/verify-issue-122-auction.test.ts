import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import { listBuildingForAuction, getActiveAuctions, getAuctionById, settleDueAuctions } from '../server/game/building-auctions.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';

console.log('=== Verifying Issue #122: Building Auction Settlement & Route Resolution ===');

// 1. Setup a test company with level 25 and an eligible level 5 building
console.log('[1/3] Creating test company with level 5 building for auction...');
const seller = await FixtureService.applyScenario({
  companyName: 'Auction Test Corp',
  money: 5000000,
  level: 25,
  buildings: [
    { kind: 'P', size: 5, slot: 0 }
  ]
});

const buildingRow = db.prepare('SELECT id FROM buildings WHERE company_id = ?').get(seller.companyId) as { id: number };
assert(buildingRow, 'Building must exist');

// 2. List the building for auction
console.log('[2/3] Listing building for auction...');
const auctionRes = await listBuildingForAuction(seller.companyId, buildingRow.id);
assert(auctionRes.id > 0, 'Auction must be created with valid ID');
console.log(`  -> Auction created with ID: ${auctionRes.id}, closes_at: ${auctionRes.closesAt}`);

// Verify active auctions list contains the new auction
const activeBefore = getActiveAuctions(0);
assert(activeBefore.some(a => a.id === auctionRes.id), 'Auction should be in active list');

// 3. Fast-forward virtual clock by 25 hours (past 24h auction close window)
console.log('[3/3] Warping time +25h and checking auto-settlement...');
virtualClock.advance({ hours: 25 });

// Settle due auctions
const settlements = await settleDueAuctions(virtualClock.nowMs());
console.log(`  -> Settle result count: ${settlements.length}`);

// Verify auction is no longer active
const activeAfter = getActiveAuctions(0);
assert(!activeAfter.some(a => a.id === auctionRes.id), 'Expired auction must no longer be active');

// Verify auction status in DB is settled
const dbAuction = db.prepare('SELECT status FROM building_auctions WHERE id = ?').get(auctionRes.id) as { status: string };
assert.strictEqual(dbAuction.status, 'settled', 'Auction status must be settled');

// Reset virtual clock
virtualClock.reset();

console.log('================================================================');
console.log(' ✅ ISSUE #122 BUILDING AUCTION CHECKS PASSED ALL TESTS');
console.log('================================================================');
