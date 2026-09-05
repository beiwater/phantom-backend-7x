import assert from 'node:assert';
import { db } from '../server/db/database.ts';
import { CONFIG } from '../server/config.ts';
import { NpcMarketService, NPC_SELLER_ID } from '../server/services/npc-market-service.ts';
import { marketRepository } from '../server/repositories/market-repository.ts';
import { RealmPhaseService } from '../server/services/realm-phase-service.ts';
import { virtualClock } from '../server/core/virtual-clock.ts';

console.log('=== Verifying NPC Market Dynamic Restock & Q0-Only Features ===\n');

// 1. Verify Q0-only constraint
console.log('[1/6] Verifying Q0-Only constraint enforcement...');
CONFIG.NPC_MARKET_Q0_ONLY = true;
CONFIG.NPC_MARKET_MAX_QUALITY = 0;
CONFIG.NPC_MARKET_INFINITE = false;

RealmPhaseService.setPreset('full');
const restockOutcome = await NpcMarketService.restock({ force: true });
console.log(`  -> Restock completed: ${restockOutcome.ordersUpdated} updated, ${restockOutcome.ordersCreated} created, ${restockOutcome.ordersDeactivated} deactivated`);

const qAboveZeroCount = (db.prepare(`
  SELECT COUNT(*) as cnt FROM market_orders
  WHERE seller_id = ? AND active = 1 AND quality > 0
`).get(NPC_SELLER_ID) as { cnt: number }).cnt;

const qZeroCount = (db.prepare(`
  SELECT COUNT(*) as cnt FROM market_orders
  WHERE seller_id = ? AND active = 1 AND quality = 0
`).get(NPC_SELLER_ID) as { cnt: number }).cnt;

console.log(`  -> Active NPC orders: Q=0 count=${qZeroCount}, Q>0 count=${qAboveZeroCount}`);
assert.strictEqual(qAboveZeroCount, 0, 'All Q>0 NPC orders must be deactivated in Q0-only mode');
assert.ok(qZeroCount > 100, 'Must have active Q0 orders for all tradable resources');
console.log('  [OK] Q0-only constraint verified!\n');

// 2. Verify dynamic item quantities based on realistic production models
console.log('[2/6] Verifying dynamic resource batch quantities...');
const powerBatch = NpcMarketService.calculateBaseBatch(1, 0); // Electricity: raw 6000/hr * 24 = 144,000
const waterBatch = NpcMarketService.calculateBaseBatch(2, 0); // Water: raw 3300/hr * 24 = 79,200
const applesBatch = NpcMarketService.calculateBaseBatch(3, 0); // Apples: raw 250/hr * 24 = 6,000
const phoneBatch = NpcMarketService.calculateBaseBatch(24, 0); // Smartphones: 25/hr * 24 = 600
const truckBatch = NpcMarketService.calculateBaseBatch(57, 0); // Trucks: 12/hr * 24 = 288

console.log(`  -> Power base batch:       ${powerBatch}`);
console.log(`  -> Water base batch:       ${waterBatch}`);
console.log(`  -> Apples base batch:      ${applesBatch}`);
console.log(`  -> Smartphones base batch: ${phoneBatch}`);
console.log(`  -> Trucks base batch:      ${truckBatch}`);

assert.ok(powerBatch > waterBatch, 'Power batch should be greater than Water batch');
assert.ok(waterBatch > applesBatch, 'Water batch should be greater than Apples batch');
assert.ok(applesBatch > phoneBatch, 'Apples batch should be greater than Smartphone batch');
assert.ok(phoneBatch > truckBatch, 'Smartphones batch should be greater than Truck batch');
console.log('  [OK] Dynamic resource quantities verified!\n');

// 3. Verify that NPC stock is NOT infinite (sold out when purchased)
console.log('[3/6] Verifying stock exhaustion upon purchase (Not infinite)...');
const sampleOrder = db.prepare(`
  SELECT id, quantity, active FROM market_orders
  WHERE seller_id = ? AND kind = 3 AND quality = 0 AND active = 1
`).get(NPC_SELLER_ID) as { id: number; quantity: number; active: number };

assert.ok(sampleOrder, 'Must have active sample order for apples');
const initialQty = sampleOrder.quantity;

// Simulate partial fill
const partialFillSuccess = marketRepository.applyFill(sampleOrder.id, 100, initialQty - 100);
assert.strictEqual(partialFillSuccess, true, 'Partial fill should succeed');
const afterPartial = marketRepository.findById(sampleOrder.id);
assert.strictEqual(afterPartial?.quantity, initialQty - 100, 'Quantity should decrease by takeAmount');
assert.strictEqual(afterPartial?.active, true, 'Order should remain active while quantity > 0');

// Simulate complete fill (exhaustion)
const completeFillSuccess = marketRepository.applyFill(sampleOrder.id, afterPartial!.quantity, 0);
assert.strictEqual(completeFillSuccess, true, 'Complete fill should succeed');
const afterComplete = marketRepository.findById(sampleOrder.id);
assert.strictEqual(afterComplete?.quantity, 0, 'Quantity must become 0 upon total fill');
assert.strictEqual(afterComplete?.active, false, 'Order must become inactive upon total fill (not magically infinite)');
console.log('  [OK] Stock exhaustion verified! Item stays sold out until restock.\n');

// 4. Verify replenishment upper limit cap
console.log('[4/6] Verifying replenishment upper limit cap (Max stock cap)...');
const applesCap = NpcMarketService.calculateMaxCap(3, 0);
console.log(`  -> Apples base batch: ${applesBatch}, Cap (3x): ${applesCap}`);
assert.strictEqual(applesCap, Math.round(applesBatch * CONFIG.NPC_RESTOCK_CAP_MULTIPLIER));

// Manually set an order to cap
db.prepare(`
  UPDATE market_orders
  SET quantity = ?, active = 1
  WHERE id = ?
`).run(applesCap, sampleOrder.id);

// Restock should NOT add more than the cap
await NpcMarketService.restock({ force: true });
const atCapOrder = marketRepository.findById(sampleOrder.id);
assert.ok(atCapOrder!.quantity <= applesCap, `Stock must not exceed cap of ${applesCap}, got ${atCapOrder!.quantity}`);
console.log('  [OK] Upper limit stock cap verified!\n');

// 5. Verify real-time player purchase volume demand scaling
console.log('[5/6] Verifying real-time player purchase volume demand adjustment...');
const initialDynamic = NpcMarketService.calculateDynamicBatch(3, 0);
console.log(`  -> Before player purchases: dynamic batch = ${initialDynamic.adjustedBatch}, demandFactor = ${initialDynamic.demandFactor}`);

// Record simulated player purchase of 12,000 units (2x base batch)
NpcMarketService.recordPlayerPurchase(3, 12000);
const boostedDynamic = NpcMarketService.calculateDynamicBatch(3, 0);
console.log(`  -> After player purchased 12,000 units: dynamic batch = ${boostedDynamic.adjustedBatch}, demandFactor = ${boostedDynamic.demandFactor.toFixed(2)}`);

assert.ok(boostedDynamic.demandFactor > initialDynamic.demandFactor, 'Demand factor must increase after player purchases');
assert.ok(boostedDynamic.adjustedBatch > initialDynamic.adjustedBatch, 'Replenishment batch must scale up with player demand');
console.log('  [OK] Real-time demand scaling verified!\n');

// 6. Verify time acceleration and virtual clock restock triggering
console.log('[6/6] Verifying time acceleration & virtual clock restock triggering...');
const status = NpcMarketService.getNpcMarketStatus();
console.log(`  -> Restock interval (game): ${status.restockIntervalHours}h (${status.restockIntervalSeconds}s)`);
console.log(`  -> Current Speed multiplier: ${status.speedMultiplier}x`);
console.log(`  -> Effective real-time interval: ${status.effectiveRealIntervalMs}ms`);

assert.strictEqual(status.q0Only, true);
assert.strictEqual(status.maxQuality, 0);
assert.strictEqual(status.infiniteStock, false);

// Advance virtual clock by 25 hours (past 24h interval)
const prevRestockCount = status.restockCount;
virtualClock.advance({ hours: 25 });
const didRestock = await NpcMarketService.checkAndRestockIfNeeded();
assert.strictEqual(didRestock, true, 'Restock should trigger when virtual clock advances past interval');
const newStatus = NpcMarketService.getNpcMarketStatus();
assert.ok(newStatus.restockCount > prevRestockCount, 'Restock count must increment');
console.log(`  -> Restock count incremented to ${newStatus.restockCount}`);
console.log('  [OK] Time acceleration and scheduled restock triggering verified!\n');

console.log('================================================================');
console.log(' [ALL TESTS PASSED] NPC MARKET DYNAMIC RESTOCK & Q0-ONLY VERIFIED');
console.log('================================================================');
