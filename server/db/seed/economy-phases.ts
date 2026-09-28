import type { DatabaseSync } from 'node:sqlite';
import { SchedulerStateRepository } from '../../repositories/scheduler-state-repository.ts';
import { DEFAULT_REALM_RULES, CHALLENGE_REALM_RULES } from '../../game-data/realm-rules.ts';

/** Explicit boot initialization replaces the old write-on-GET bootstrap (#179). */
export function seedEconomyPhases(database: DatabaseSync): void {
  const repository = new SchedulerStateRepository(database);
  const realmIds = new Set([
    DEFAULT_REALM_RULES.realmId, CHALLENGE_REALM_RULES.realmId,
    ...repository.listEconomyRealms()
  ]);
  const now = new Date().toISOString();
  for (const realmId of realmIds) {
    if (!repository.getEconomyPhase(realmId)) {
      repository.upsertEconomyPhase(realmId, 1, now, 'bootstrap');
    }
  }
}
