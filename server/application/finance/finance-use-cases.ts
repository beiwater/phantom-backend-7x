/**
 * Corporate finance application layer (Issue #105 Phase 7 / Issue #104 Stage 6).
 *
 * Issue #179: the bond and contract lifecycle engines are no longer facade
 * forwards into the legacy game layer. The authoritative implementations now
 * live in application/finance/bond-use-cases.ts and
 * application/finance/contract-use-cases.ts, on top of
 * repositories/bond-repository.ts and repositories/contract-repository.ts.
 * This module stays as the finance aggregation surface the routes import.
 */
import type { GameContext } from '../../context/game-context.ts';
import {
  getBondsOwnedQuery,
  getBondsSoldQuery,
  getBondMarketListingsQuery,
  issueBondsUseCase,
  buyBondsUseCase,
  callBondsUseCase
} from './bond-use-cases.ts';
import {
  getIncomingContracts,
  getOutgoingContracts,
  getContractHistory,
  getWarehouseContractsSummary,
  sendContractUseCase,
  acceptContractUseCase,
  rejectContractUseCase,
  cancelContractUseCase
} from './contract-use-cases.ts';

// --- Bond queries ------------------------------------------------------------

export { getBondsOwnedQuery, getBondsSoldQuery, getBondMarketListingsQuery };

// --- Bond commands -----------------------------------------------------------

export function issueBondsCommand(ctx: GameContext, amount: number, interestRate: number = 0.005) {
  return issueBondsUseCase(ctx, amount, interestRate);
}

export function buyBondsCommand(ctx: GameContext, bondId: number) {
  return buyBondsUseCase(ctx, bondId);
}

export function callBondsCommand(ctx: GameContext, bondId: number) {
  return callBondsUseCase(ctx, bondId);
}

// --- Contract queries --------------------------------------------------------

export function getIncomingContractsQuery(companyId: number) {
  return getIncomingContracts(companyId);
}

export function getOutgoingContractsQuery(companyId: number) {
  return getOutgoingContracts(companyId);
}

export function getContractHistoryQuery(companyId: number, direction: 'incoming' | 'outgoing') {
  return getContractHistory(companyId, direction);
}

export function getWarehouseContractsSummaryQuery(companyId: number) {
  return getWarehouseContractsSummary(companyId);
}

// --- Contract commands -------------------------------------------------------

export function sendContractCommand(
  ctx: GameContext,
  input: { buyerCompanyId: number; resourceKind: number; quality: number; amount: number; price: number }
) {
  return sendContractUseCase(ctx, input);
}

export function acceptContractCommand(ctx: GameContext, contractId: number) {
  return acceptContractUseCase(ctx, contractId);
}

export function rejectContractCommand(ctx: GameContext, contractId: number) {
  return rejectContractUseCase(ctx, contractId);
}

export function cancelContractCommand(ctx: GameContext, contractId: number) {
  return cancelContractUseCase(ctx, contractId);
}
