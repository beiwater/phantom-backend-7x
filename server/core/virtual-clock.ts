/**
 * Virtual Clock Service (Server-side time manipulation and fast-forward engine).
 *
 * Enables dynamic time-warping without restarting the server:
 * - Maintains runtime offset in ms
 * - Synchronizes with /api/v2/time-millis/ and domain queries
 * - Resolves overdue cycles (construction, production, retail, restaurant, auctions)
 */

export class VirtualClock {
  private static instance: VirtualClock;
  private offsetMs = 0;

  private constructor() {
    // Check if initial offset was passed via env
    const envOffset = Number(process.env.CLOCK_OFFSET_MS ?? 0);
    if (Number.isFinite(envOffset)) {
      this.offsetMs = envOffset;
    }
  }

  static getInstance(): VirtualClock {
    if (!VirtualClock.instance) {
      VirtualClock.instance = new VirtualClock();
    }
    return VirtualClock.instance;
  }

  /** Current virtual timestamp in milliseconds. */
  nowMs(): number {
    return Date.now() + this.offsetMs;
  }

  /** Current virtual Date object. */
  now(): Date {
    return new Date(this.nowMs());
  }

  /** Current virtual ISO string. */
  nowIso(): string {
    return this.now().toISOString();
  }

  /** Current time offset in milliseconds. */
  getOffsetMs(): number {
    return this.offsetMs;
  }

  /** Current time offset in hours. */
  getOffsetHours(): number {
    return Math.round((this.offsetMs / 3600000) * 100) / 100;
  }

  /** Advance virtual clock by a relative delta. */
  advance(options: { hours?: number; days?: number; minutes?: number; seconds?: number }): {
    previousIso: string;
    newIso: string;
    offsetHours: number;
  } {
    const previousIso = this.nowIso();
    const addMs =
      (options.days ?? 0) * 86400000 +
      (options.hours ?? 0) * 3600000 +
      (options.minutes ?? 0) * 60000 +
      (options.seconds ?? 0) * 1000;

    this.offsetMs += addMs;
    return {
      previousIso,
      newIso: this.nowIso(),
      offsetHours: this.getOffsetHours()
    };
  }

  /** Set virtual clock to an exact target time. */
  setTime(target: Date | string | number): {
    previousIso: string;
    newIso: string;
    offsetHours: number;
  } {
    const previousIso = this.nowIso();
    const targetMs = typeof target === 'number' ? target : new Date(target).getTime();
    if (!Number.isFinite(targetMs)) {
      throw new Error('Invalid target timestamp');
    }
    this.offsetMs = targetMs - Date.now();
    return {
      previousIso,
      newIso: this.nowIso(),
      offsetHours: this.getOffsetHours()
    };
  }

  /** Reset virtual clock to real wall-clock time. */
  reset(): { previousIso: string; newIso: string } {
    const previousIso = this.nowIso();
    this.offsetMs = 0;
    return {
      previousIso,
      newIso: this.nowIso()
    };
  }

  /**
   * Fast-forwards and resolves all overdue time-gated activities up to the virtual now:
   * 1. Building construction / upgrade completion (busy_until <= now)
   * 2. Production queue completion
   * 3. Retail order completion
   * 4. Restaurant operational runs
   * 5. Building auctions closing
   */
  async resolveAllOverdue(): Promise<{
    completedConstructions: number;
    completedProductions: number;
    completedRetailOrders: number;
    resolvedRestaurants: number;
    settledAuctions: number;
  }> {
    const { db } = await import('../db/database.ts');
    const { settleDueAuctions } = await import('../game/building-auctions.ts');
    const { resolveDueRestaurantRunsSync } = await import('../game/restaurant.ts');
    const nowTimestamp = this.nowMs();
    const nowString = this.nowIso();

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

    // Retail orders stay persisted until collection, while revenue is credited
    // when the sale starts. A due finished_at is therefore the completion
    // marker; revenue_credited is not an in-progress status.
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

    return {
      completedConstructions,
      completedProductions,
      completedRetailOrders,
      resolvedRestaurants,
      settledAuctions
    };
  }
}

export const virtualClock = VirtualClock.getInstance();
