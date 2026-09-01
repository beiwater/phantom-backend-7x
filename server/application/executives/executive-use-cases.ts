/**
 * Executives application layer (Issue #105 Phase 6 / Issue #104 Stage 5).
 * Single command/query surface for executive lifecycle (hire, fire, assign,
 * update, train), poaching offers and hostile offers. Each command forwards
 * to the authoritative engine implementation inside its own transaction and
 * adds the GameContext ownership contract; the repository split of the
 * engine internals is incremental (executive-repository next slice).
 *
 * GET/query helpers are re-exported read-only for the compatibility adapter.
 */
import type { GameContext } from '../../context/game-context.ts';
import {
  getCompanyExecutives,
  getExecutiveCandidates,
  getExecutiveById,
  hireExecutive,
  fireExecutive,
  assignExecutive,
  updateExecutive,
  trainExecutive,
  createPoachingOffer,
  getPoachingOffers,
  getPoachingOfferById,
  updatePoachingOffer,
  dismissPoachingOffer,
  refreshPoachingOffer,
  researchEmployerByPoacher,
  getHostileOffers,
  getHostileOfferById,
  counterHostileOffer,
  letGoHostileOffer,
  rejectHostileOffer,
  researchPoacherByEmployer,
  type CreatePoachingOfferInput,
  type CounterHostileOfferInput
} from '../../game/executives.ts';
import { ForbiddenError } from '../../errors/domain-error.ts';

export type { CreatePoachingOfferInput, CounterHostileOfferInput };

// --- Queries (read-only) -----------------------------------------------------

export function getCompanyExecutivesQuery(companyId: number) {
  return getCompanyExecutives(companyId);
}

export function getExecutiveCandidatesQuery(companyId: number) {
  return getExecutiveCandidates(companyId);
}

export function getExecutiveByIdQuery(companyId: number, executiveId: number) {
  return getExecutiveById(companyId, executiveId);
}

export function getPoachingOffersQuery(companyId: number) {
  return getPoachingOffers(companyId);
}

export function getPoachingOfferByIdQuery(companyId: number, offerId: number) {
  return getPoachingOfferById(companyId, offerId);
}

export function getHostileOffersQuery(companyId: number) {
  return getHostileOffers(companyId);
}

export function getHostileOfferByIdQuery(companyId: number, offerId: number) {
  return getHostileOfferById(companyId, offerId);
}

// --- Commands (mutations with GameContext ownership contract) -----------------

export function hireExecutiveCommand(ctx: GameContext, candidateId: number, position: string = 'unassigned') {
  return hireExecutive(ctx.companyId, candidateId, position);
}

export function fireExecutiveCommand(ctx: GameContext, executiveId: number) {
  return fireExecutive(ctx.companyId, executiveId);
}

export function assignExecutiveCommand(ctx: GameContext, executiveId: number, position: string) {
  return assignExecutive(ctx.companyId, executiveId, position);
}

export function updateExecutiveCommand(ctx: GameContext, executiveId: number, updates: Record<string, unknown>) {
  return updateExecutive(ctx.companyId, executiveId, updates);
}

export function trainExecutiveCommand(ctx: GameContext, executiveId: number) {
  return trainExecutive(ctx.companyId, executiveId);
}

export function createPoachingOfferCommand(ctx: GameContext, input: CreatePoachingOfferInput) {
  return createPoachingOffer(ctx.companyId, input);
}

export function updatePoachingOfferCommand(ctx: GameContext, offerId: number, body: Record<string, unknown>) {
  return updatePoachingOffer(ctx.companyId, offerId, body);
}

export function dismissPoachingOfferCommand(ctx: GameContext, offerId: number) {
  return dismissPoachingOffer(ctx.companyId, offerId);
}

export function refreshPoachingOfferCommand(ctx: GameContext, offerId: number) {
  return refreshPoachingOffer(ctx.companyId, offerId);
}

export function researchEmployerCommand(ctx: GameContext, offerId: number) {
  return researchEmployerByPoacher(ctx.companyId, offerId);
}

export function counterHostileOfferCommand(ctx: GameContext, offerId: number, body: CounterHostileOfferInput) {
  return counterHostileOffer(ctx.companyId, offerId, body);
}

export function letGoHostileOfferCommand(ctx: GameContext, offerId: number) {
  return letGoHostileOffer(ctx.companyId, offerId);
}

export function rejectHostileOfferCommand(ctx: GameContext, offerId: number) {
  return rejectHostileOffer(ctx.companyId, offerId);
}

export function researchPoacherCommand(ctx: GameContext, offerId: number) {
  return researchPoacherByEmployer(ctx.companyId, offerId);
}

// Ownership assertion used by routes before dispatch (fail fast 403).
export function assertExecutiveOwned(ctx: GameContext, executiveId: number): void {
  const executive = getExecutiveById(ctx.companyId, executiveId);
  if (!executive || (executive as { company_id?: number }).company_id !== ctx.companyId) {
    throw new ForbiddenError('Executive does not belong to your company');
  }
}
