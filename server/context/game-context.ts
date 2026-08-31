import { getRealmRules, type RealmRules } from '../game-data/realm-rules.ts';
import { UnauthorizedError } from '../errors/domain-error.ts';

export interface GameContext {
  playerId: number;
  companyId: number;
  realmId: number;
  rules: RealmRules;
}

export function createGameContext(
  companyId: number,
  playerId: number,
  realmId: number = 0
): GameContext {
  return {
    companyId,
    playerId,
    realmId,
    rules: getRealmRules(realmId)
  };
}

export function requireGameContext(
  companyId: number | null | undefined,
  playerId: number | null | undefined,
  realmId: number = 0
): GameContext {
  if (!companyId || !playerId) {
    throw new UnauthorizedError('Authentication required to perform this action');
  }
  return createGameContext(companyId, playerId, realmId);
}
