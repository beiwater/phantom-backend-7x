/**
 * Bond lifecycle application layer (Issue #179 vertical slice).
 * Orchestration moved verbatim from game/bonds.ts: validation messages,
 * transaction boundaries, ledger effects and return shapes are preserved
 * exactly (Strangler rule: architecture migration does not rewrite economy
 * rules). Persistence lives in BondRepository; money moves through the
 * authoritative CompanyRepository.updateMoney primitive.
 */
import { virtualClock } from '../../core/virtual-clock.ts';
import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { bondRepository, BOND_FACE_VALUE, type BondRow } from '../../repositories/bond-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { refreshDailyFinanceSnapshot } from '../../game/cash-ledger.ts';

// --- Bond queries ------------------------------------------------------------
import { RealmPhaseService } from '../../services/realm-phase-service.ts';

export function getBondsOwnedQuery(companyId: number) {
  return bondRepository.listOwnedRows(companyId).map(bondRepository.formatBond.bind(bondRepository));
}

export function getBondsSoldQuery(companyId: number) {
  return bondRepository.listSoldRows(companyId).map(bondRepository.formatBond.bind(bondRepository));
}

export function getBondMarketListingsQuery() {
  return bondRepository.listMarketRows().map(bondRepository.formatBond.bind(bondRepository));
}

/**
 * Outstanding sold-bond liability consumed by the demolish-building
 * collateral guard (Issue #94). Verbatim wrapper over the repository query.
 */
export function getOutstandingSoldBondLiability(companyId: number): number {
  return bondRepository.outstandingSoldLiability(companyId);
}

// --- Bond commands -----------------------------------------------------------

export function issueBondsUseCase(ctx: GameContext, amount: number, interestRate: number = 0.005) {
  const comp = companyRepository.findById(ctx.companyId);
  if (!comp) throw new Error('Company not found');
  const realmConfig = RealmPhaseService.getActiveRealmConfig();
  if (!realmConfig.bonds) {
    throw new Error(`Corporate bonds are not unlocked in ${realmConfig.name} (Unlocked in Phase 3)`);
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Bond amount must be a positive integer number of units');
  }
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 1) {
    throw new Error('Bond interest rate must be between 0 and 1');
  }

  const now = virtualClock.nowIso();
  const maturityDate = new Date(virtualClock.nowMs() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return runInTransaction(() => {
    const row = bondRepository.insertBond(ctx.companyId, interestRate, amount, now, maturityDate);
    return {
      bond: bondRepository.formatBond(row),
      money: comp.money,
      moneyDelta: 0
    };
  }, { immediate: true });
}

export function buyBondsUseCase(ctx: GameContext, bondId: number) {
  return runInTransaction(() => {
    const bond = bondRepository.findById(bondId);
    if (!bond || bond.status !== 'active' || bond.buyer_company_id !== null) {
      throw new Error('Bond is no longer available');
    }
  
    const faceValue = bond.amount * BOND_FACE_VALUE;
    const buyer = companyRepository.findById(ctx.companyId);
    if (!buyer || !Number.isFinite(Number(buyer.money)) || Number(buyer.money) < faceValue) {
      throw new Error('Not enough money to buy bond');
    }
  
    const claimed = bondRepository.claimForBuyer(ctx.companyId, bondId);
    if (claimed !== 1) {
      throw new Error('Bond is no longer available');
    }
  
    const newMoney = companyRepository.updateMoney(ctx.companyId, -faceValue);
    // Real issuers receive face value when purchased.
    if (bond.seller_company_id !== 999900 && companyRepository.findById(bond.seller_company_id)) {
      companyRepository.updateMoney(bond.seller_company_id, faceValue);
    }
  
    const updated = bondRepository.findById(bondId) as BondRow;
    return {
      bond: bondRepository.formatBond(updated),
      money: newMoney,
      moneyDelta: -faceValue
    };
  }, { immediate: true });
}

export function callBondsUseCase(ctx: GameContext, bondId: number) {
  return runInTransaction(() => {
    const bond = bondRepository.findById(bondId);
    if (!bond || bond.status !== 'active' || bond.seller_company_id !== ctx.companyId) {
      throw new Error('Bond not found');
    }
    if (bond.maturity_date && bond.maturity_date <= virtualClock.nowIso()) {
      throw new Error('Bond has matured and can no longer be called early');
    }
  
    const seller = companyRepository.findById(ctx.companyId);
    if (!seller) {
      throw new Error('Company not found');
    }
  
    let newSellerMoney = Number(seller.money) || 0;
    const faceValue = bond.amount * BOND_FACE_VALUE;
    const isSold = bond.buyer_company_id !== null;
    if (isSold && bond.buyer_company_id) {
      if (newSellerMoney < faceValue) {
        throw new Error('Not enough money to call bond early');
      }
      newSellerMoney = companyRepository.updateMoney(ctx.companyId, -faceValue);
      companyRepository.updateMoney(bond.buyer_company_id, faceValue);
    }
    const updated = bondRepository.markCalled(bondId, ctx.companyId);
    if (updated !== 1) {
      throw new Error('Bond is no longer active');
    }
    refreshDailyFinanceSnapshot(ctx.companyId);
    if (bond.buyer_company_id) refreshDailyFinanceSnapshot(bond.buyer_company_id);
  
    return {
      success: true,
      money: newSellerMoney,
      moneyDelta: isSold ? -faceValue : 0
    };
  }, { immediate: true });
}

/** Repay principal at maturity; daily coupons are settled separately. */
export function settleMaturedBondsUseCase(occurrence: Date = virtualClock.now()): void {
  runInTransaction(() => {
    for (const bond of bondRepository.listMaturedUnsettled(occurrence.toISOString())) {
      const principal = bond.amount * BOND_FACE_VALUE;
      const issuer = companyRepository.findById(bond.seller_company_id);
      const available = issuer ? Math.max(0, Number(issuer.money) || 0) : principal;
      const paid = Math.min(available, principal);
      if (issuer && paid > 0) companyRepository.updateMoney(bond.seller_company_id, -paid);
      if (bond.buyer_company_id && paid > 0) companyRepository.updateMoney(bond.buyer_company_id, paid);
      bondRepository.markSettled(bond.id, paid < principal ? 'defaulted' : 'matured');
      if (issuer) refreshDailyFinanceSnapshot(bond.seller_company_id);
      if (bond.buyer_company_id) refreshDailyFinanceSnapshot(bond.buyer_company_id);
    }
  });
}
