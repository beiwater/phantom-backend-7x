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

  private overdueResolver?: OverdueResolver;

  /**
   * Register a custom or default overdue resolution engine.
   * Keeps core/virtual-clock independent from higher-layer business domains.
   */
  setOverdueResolver(resolver: OverdueResolver): void {
    this.overdueResolver = resolver;
  }

  /**
   * Fast-forwards and resolves all overdue time-gated activities up to the virtual now:
   * 1. Building construction / upgrade completion (busy_until <= now)
   * 2. Production queue completion
   * 3. Retail order completion
   * 4. Restaurant operational runs
   * 5. Building auctions closing
   *
   * Delegates to the registered resolver (e.g. overdue-resolution-service.ts).
   */
  async resolveAllOverdue(): Promise<OverdueResolutionResult> {
    if (this.overdueResolver) {
      return this.overdueResolver(this);
    }
    return {
      completedConstructions: 0,
      completedProductions: 0,
      completedRetailOrders: 0,
      resolvedRestaurants: 0,
      settledAuctions: 0,
      restockedNpcMarket: false
    };
  }
}

export type OverdueResolutionResult = {
  completedConstructions: number;
  completedProductions: number;
  completedRetailOrders: number;
  resolvedRestaurants: number;
  settledAuctions: number;
  restockedNpcMarket: boolean;
};

export type OverdueResolver = (clock: VirtualClock) => Promise<OverdueResolutionResult>;

export const virtualClock = VirtualClock.getInstance();
