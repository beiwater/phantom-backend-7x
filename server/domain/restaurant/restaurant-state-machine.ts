/**
 * Restaurant lifecycle state machine (Issue #105 Phase 5).
 * Formalizes the transition table that was previously implicit in
 * updateRestaurantProperties / settle logic (including the #102 resume fix).
 * Pure: zero IO. The application layer enforces these guards inside its
 * transactions; the persistence layer never decides transitions itself.
 */

export type RestaurantState =
  | 'Closed'
  | 'Running'
  | 'StopScheduled'
  | 'Reconstruction';

export interface RestaurantStateSnapshot {
  /** keep_open flag persisted on restaurant_properties. */
  keepOpen: boolean;
  /** Whether a resolved=0 restaurant_runs row exists. */
  hasActiveRun: boolean;
  /** busy_until in the future (reconstruction or an active cycle window). */
  busyUntilFuture: boolean;
  /** reconstruction_until in the future. */
  reconstructionFuture: boolean;
}

export function resolveRestaurantState(snapshot: RestaurantStateSnapshot): RestaurantState {
  if (snapshot.reconstructionFuture || (snapshot.busyUntilFuture && !snapshot.hasActiveRun)) {
    return 'Reconstruction';
  }
  if (snapshot.hasActiveRun) {
    return snapshot.keepOpen ? 'Running' : 'StopScheduled';
  }
  return 'Closed';
}

export type RestaurantLifecycleEvent =
  | 'START_CYCLE'        // keepOpen=true with no active run (or first open)
  | 'SCHEDULE_STOP'      // keepOpen=false while Running
  | 'RESUME_CONTINUOUS'  // keepOpen=true while StopScheduled (#102)
  | 'CYCLE_SETTLED'      // a run resolves (auto: keepOpen ? next cycle : Closed)
  | 'BEGIN_RECONSTRUCTION'
  | 'RECONSTRUCTION_DONE';

export interface TransitionDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Guard table: (from, event) → allowed. The application layer consults this
 * before mutating persistence, so every legal path is declared exactly once.
 */
const TRANSITIONS: Record<string, boolean> = {
  'Closed|START_CYCLE': true,
  'Closed|BEGIN_RECONSTRUCTION': true,
  'Running|SCHEDULE_STOP': true,
  'Running|CYCLE_SETTLED': true, // settle keeps it Running via next cycle when keepOpen
  'StopScheduled|CYCLE_SETTLED': true, // settle closes the restaurant
  'StopScheduled|RESUME_CONTINUOUS': true, // #102: cancel closure plan mid-cycle
  'Reconstruction|RECONSTRUCTION_DONE': true,
  'Reconstruction|CYCLE_SETTLED': false
};

export function checkTransition(from: RestaurantState, event: RestaurantLifecycleEvent): TransitionDecision {
  const allowed = TRANSITIONS[`${from}|${event}`] === true;
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `Illegal restaurant transition: ${from} --${event}-->` };
}

/**
 * #102 semantics: PATCH keepOpen=true while a cycle is active is a RESUME
 * (cancel the scheduled stop), never a second cycle start.
 */
export function interpretKeepOpenPatch(
  state: RestaurantState,
  keepOpenRequested: boolean
): RestaurantLifecycleEvent | null {
  if (!keepOpenRequested) {
    return state === 'Running' ? 'SCHEDULE_STOP' : null;
  }
  if (state === 'StopScheduled') return 'RESUME_CONTINUOUS';
  if (state === 'Closed') return 'START_CYCLE';
  // Running + keepOpen=true is a no-op (already continuous).
  return null;
}
