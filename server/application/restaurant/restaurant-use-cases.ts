/**
 * Restaurant application use cases (Issue #105 Phase 5).
 * Thin command layer over the restaurant engine: owns GameContext
 * authorization, consults the domain state machine before mutating, and
 * delegates the transactional work to the engine (single authoritative
 * implementation — engine internals migrate to repositories incrementally).
 */
import type { GameContext } from '../../context/game-context.ts';
import {
  getRestaurantProperties,
  updateRestaurantProperties,
  getRestaurantRuns,
  executeRestaurantRun,
  type RestaurantMenuItem,
  type RestaurantProperties,
  type RestaurantRun
} from '../../game/restaurant.ts';
import { ForbiddenError, NotFoundError } from '../../errors/domain-error.ts';
import { resolveRestaurantState, interpretKeepOpenPatch } from '../../domain/restaurant/restaurant-state-machine.ts';

export type { RestaurantProperties, RestaurantRun, RestaurantMenuItem };

function assertOwnedRestaurant(ctx: GameContext, buildingId: number): void {
  // The engine re-validates ownership inside its transaction; this guard
  // fails fast for authorization before any write path is touched.
  const properties = getRestaurantProperties(buildingId, ctx.companyId);
  if (!properties) {
    throw new NotFoundError(`Restaurant ${buildingId} not found`);
  }
}

export interface StartCycleResultDTO {
  run: RestaurantRun;
  moneyUpdate: number;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
}

/** StartRestaurantCycle command. */
export async function startRestaurantCycleUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<StartCycleResultDTO> {
  assertOwnedRestaurant(ctx, buildingId);
  const result = await executeRestaurantRun(buildingId, ctx.companyId);
  return {
    run: result.run,
    moneyUpdate: result.moneyUpdate,
    resourceTransactions: result.resourceTransactions
  };
}

/** GetRestaurantHistory query (read service; also settles due cycles first). */
export async function getRestaurantRunsQuery(
  ctx: GameContext,
  buildingId: number
): Promise<RestaurantRun[]> {
  assertOwnedRestaurant(ctx, buildingId);
  return getRestaurantRuns(buildingId, ctx.companyId);
}

export interface UpdateRestaurantPropertiesInput {
  goodService?: boolean;
  isLuxury?: boolean;
  professionalStaff?: boolean;
  keepOpen?: boolean;
  menu?: RestaurantMenuItem[];
  menuPrice?: number;
}

export interface UpdateRestaurantPropertiesResult {
  restaurantProperties: RestaurantProperties;
  moneyUpdate: number;
  cycle: RestaurantRun | null;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
}

/**
 * UpdateRestaurantProperties command. keepOpen patches are interpreted
 * through the domain state machine (#102): Running→SCHEDULE_STOP,
 * StopScheduled→RESUME_CONTINUOUS (cancel closure plan), Closed→START_CYCLE.
 */
export async function updateRestaurantPropertiesUseCase(
  ctx: GameContext,
  buildingId: number,
  updates: UpdateRestaurantPropertiesInput
): Promise<UpdateRestaurantPropertiesResult> {
  assertOwnedRestaurant(ctx, buildingId);

  if (updates.keepOpen !== undefined) {
    const current = getRestaurantProperties(buildingId, ctx.companyId);
    const state = resolveRestaurantState({
      keepOpen: current.keepOpen,
      hasActiveRun: current.keepOpen ? current.keepOpen : false,
      busyUntilFuture: false,
      reconstructionFuture: Boolean(
        current.reconstructionUntil && new Date(current.reconstructionUntil).getTime() > Date.now()
      )
    });
    // The active-run bit is authoritative from the runs table, not the
    // properties row; query it through the engine's read path.
    const runs = await getRestaurantRuns(buildingId, ctx.companyId);
    const hasActiveRun = runs.some(run => !run.resolved);
    const effectiveState = resolveRestaurantState({
      keepOpen: current.keepOpen,
      hasActiveRun,
      busyUntilFuture: false,
      reconstructionFuture: Boolean(
        current.reconstructionUntil && new Date(current.reconstructionUntil).getTime() > Date.now()
      )
    });
    void state;
    const event = interpretKeepOpenPatch(effectiveState, Boolean(updates.keepOpen));
    if (event === 'RESUME_CONTINUOUS' && !hasActiveRun) {
      // Closure scheduled but no cycle left to resume into → plain START.
      void event;
    }
    if (event === 'SCHEDULE_STOP' && !hasActiveRun) {
      // Scheduling a stop with no active cycle is a no-op (already closed).
      throw new ForbiddenError('Restaurant is not operating');
    }
  }

  const result = await updateRestaurantProperties(buildingId, ctx.companyId, updates);
  return {
    restaurantProperties: result.restaurantProperties,
    moneyUpdate: result.moneyUpdate,
    cycle: result.cycle,
    resourceTransactions: result.resourceTransactions
  };
}

// --- Read-service facade for the compatibility adapter ----------------------
// building-dto.ts (compatibility layer) must not import the engine directly
// (Issue #105 dependency direction); these re-exports are the sanctioned read
// surface. They are pure/sync reads and settle-due-cycles helpers.
export {
  getRestaurantBusy,
  getLegacyRestaurantProperties,
  resolveDueRestaurantRunsSync,
  getRestaurantProperties,
  getRestaurantMenuGuide,
  getRestaurantRatings,
  getLegacyRestaurantRun,
  RESTAURANT_DISHES,
  validateRestaurantMenuPrice
} from '../../game/restaurant.ts';
