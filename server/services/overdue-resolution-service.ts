import { db } from '../db/database.ts';
import { settleDueAuctions } from '../game/building-auctions.ts';
import { resolveDueRestaurantRunsSync } from '../game/restaurant.ts';
import { NpcMarketService } from './npc-market-service.ts';
import { virtualClock, type VirtualClock, type OverdueResolutionResult } from '../core/virtual-clock.ts';

/**
 * Fast-forwards and resolves all overdue time-gated activities up to the virtual now:
 * 1. Building construction / upgrade completion (busy_until <= now)
 * 2. Production queue completion
 * 3. Retail order completion
 * 4. Restaurant operational runs
 * 5. Building auctions closing
 * 6. Due NPC market restocking
 */
export async function resolveAllOverdue(clock: VirtualClock = virtualClock): Promise<OverdueResolutionResult> {
  const nowTimestamp = clock.nowMs();
  const nowString = clock.nowIso();

  let completedConstructions = 0;
  let completedProductions = 0;
  let completedRetailOrders = 0;
  let resolvedRestaurants = 0;
  let settledAuctions = 0;

  // 1. Resolve building constructions / upgrades
  try {
    const res = db.prepare(
      "UPDATE buildings SET busy_until = NULL WHERE busy_until IS NOT NULL AND busy_until <= ?"
    ).run(nowString);
    completedConstructions = Number(res.changes) || 0;
  } catch {
    // ignore
  }

  // 2. Resolve production queues (ensure finishes_at <= now are available to collect)
  try {
    const prodRows = db.prepare(
      "SELECT COUNT(*) as cnt FROM production_queues WHERE finishes_at <= ?"
    ).get(nowString) as { cnt: number } | undefined;
    completedProductions = Number(prodRows?.cnt) || 0;
  } catch {
    // ignore
  }

  // 3. Retail orders
  try {
    const retailRows = db.prepare(
      "SELECT COUNT(*) as cnt FROM retail_orders WHERE finished_at <= ?"
    ).get(nowString) as { cnt: number } | undefined;
    completedRetailOrders = Number(retailRows?.cnt) || 0;
  } catch {
    // ignore
  }

  // 4. Resolve due restaurant runs
  try {
    const dueRestaurants = db.prepare(
      "SELECT building_id, company_id FROM restaurant_runs WHERE resolved = 0 AND cycle_end <= ?"
    ).all(nowString) as Array<{ building_id: number; company_id: number }>;

    for (const r of dueRestaurants) {
      resolveDueRestaurantRunsSync(r.building_id, r.company_id);
      resolvedRestaurants++;
    }
  } catch {
    // ignore
  }

  // 5. Settle due building auctions
  try {
    const settlements = await settleDueAuctions(nowTimestamp);
    settledAuctions = settlements.length;
  } catch {
    // ignore
  }

  // 6. Resolve due NPC market restocking
  let restockedNpcMarket = false;
  try {
    restockedNpcMarket = await NpcMarketService.checkAndRestockIfNeeded();
  } catch {
    // ignore
  }

  return {
    completedConstructions,
    completedProductions,
    completedRetailOrders,
    resolvedRestaurants,
    settledAuctions,
    restockedNpcMarket
  };
}

// Auto-register this overdue resolver on the core virtual clock
virtualClock.setOverdueResolver(resolveAllOverdue);
