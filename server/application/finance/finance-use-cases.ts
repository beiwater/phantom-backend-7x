/**
 * Corporate finance application layer (Issue #105 Phase 7 / Issue #104 Stage 6).
 * Command/query facade for bond lifecycle (issue/buy/call + settlement) and
 * contract lifecycle (send/accept/reject/cancel). Economic semantics are
 * preserved as-is from the verified engine (Strangler rule: architecture
 * migration does not rewrite economy rules).
 */
import type { GameContext } from '../../context/game-context.ts';
import {
  getBondsOwned,
  getBondsSold,
  getBondMarketListings,
  issueBonds,
  buyBonds,
  callBonds
} from '../../game/bonds.ts';
import {
  getIncomingContracts,
  getOutgoingContracts,
  sendContract,
  acceptContract,
  rejectContract,
  cancelContract
} from '../../game/contracts.ts';

// --- Bond queries ------------------------------------------------------------

export function getBondsOwnedQuery(companyId: number) {
  return getBondsOwned(companyId);
}

export function getBondsSoldQuery(companyId: number) {
  return getBondsSold(companyId);
}

export function getBondMarketListingsQuery() {
  return getBondMarketListings();
}

// --- Bond commands ------------------------------------------------------------

export function issueBondsCommand(ctx: GameContext, amount: number, interestRate: number = 0.005) {
  return issueBonds(ctx.companyId, amount, interestRate);
}

export function buyBondsCommand(ctx: GameContext, bondId: number) {
  return buyBonds(ctx.companyId, bondId);
}

export function callBondsCommand(ctx: GameContext, bondId: number) {
  return callBonds(ctx.companyId, bondId);
}

// --- Contract queries ----------------------------------------------------------

export function getIncomingContractsQuery(companyId: number) {
  return getIncomingContracts(companyId);
}

export function getOutgoingContractsQuery(companyId: number) {
  return getOutgoingContracts(companyId);
}

// --- Contract commands ---------------------------------------------------------

export function sendContractCommand(
  ctx: GameContext,
  input: { buyerCompanyId: number; resourceKind: number; quality: number; amount: number; price: number }
) {
  return sendContract(ctx.companyId, input.buyerCompanyId, input.resourceKind, input.quality, input.amount, input.price);
}

export function acceptContractCommand(ctx: GameContext, contractId: number) {
  return acceptContract(ctx.companyId, contractId);
}

export function rejectContractCommand(ctx: GameContext, contractId: number) {
  return rejectContract(ctx.companyId, contractId);
}

export function cancelContractCommand(ctx: GameContext, contractId: number) {
  return cancelContract(ctx.companyId, contractId);
}
