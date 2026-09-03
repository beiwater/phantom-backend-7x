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
import { bondRepository, type BondRow } from '../../repositories/bond-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';

// --- Bond queries ------------------------------------------------------------

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
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Bond amount must be greater than zero');
  }
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 1) {
    throw new Error('Bond interest rate must be between 0 and 1');
  }

  const now = virtualClock.nowIso();
  const maturityDate = new Date(virtualClock.nowMs() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return runInTransaction(async () => {
    const row = bondRepository.insertBond(ctx.companyId, interestRate, amount, now, maturityDate);
    return {
      bond: bondRepository.formatBond(row),
      money: comp.money,
      moneyDelta: 0
    };
  }, { immediate: true });
}

export function buyBondsUseCase(ctx: GameContext, bondId: number) {
  return runInTransaction(async () => {
    const bond = bondRepository.findById(bondId);
    if (!bond || bond.status !== 'active' || bond.buyer_company_id !== null) {
      throw new Error('Bond is no longer available');
    }

    const buyer = companyRepository.findById(ctx.companyId);
    if (!buyer || !Number.isFinite(Number(buyer.money)) || Number(buyer.money) < bond.amount) {
      throw new Error('Not enough money to buy bond');
    }

    const claimed = bondRepository.claimForBuyer(ctx.companyId, bondId);
    if (claimed !== 1) {
      throw new Error('Bond is no longer available');
    }

    const newMoney = companyRepository.updateMoney(ctx.companyId, -bond.amount);
    // Real issuers receive face value when purchased.
    if (bond.seller_company_id !== 999900 && companyRepository.findById(bond.seller_company_id)) {
      companyRepository.updateMoney(bond.seller_company_id, bond.amount);
    }

    const updated = bondRepository.findById(bondId) as BondRow;
    return {
      bond: bondRepository.formatBond(updated),
      money: newMoney,
      moneyDelta: -bond.amount
    };
  }, { immediate: true });
}

export function callBondsUseCase(ctx: GameContext, bondId: number) {
  return runInTransaction(async () => {
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
    const isSold = bond.buyer_company_id !== null;
    if (isSold && bond.buyer_company_id) {
      if (newSellerMoney < bond.amount) {
        throw new Error('Not enough money to call bond early');
      }
      newSellerMoney = companyRepository.updateMoney(ctx.companyId, -bond.amount);
      companyRepository.updateMoney(bond.buyer_company_id, bond.amount);
    }
    const updated = bondRepository.markCalled(bondId, ctx.companyId);
    if (updated !== 1) {
      throw new Error('Bond is no longer active');
    }

    return {
      success: true,
      money: newSellerMoney,
      moneyDelta: isSold ? -bond.amount : 0
    };
  }, { immediate: true });
}

/**
 * Matured bond settlement (Issue #42). Preserves the original per-bond
 * BEGIN/COMMIT structure exactly: one failed settlement is logged and rolled
 * back without blocking the remaining bonds.
 */
export async function settleMaturedBondsUseCase(): Promise<void> {
  const now = virtualClock.nowIso();
  const due = bondRepository.listMaturedUnsettled(now);
  if (due.length === 0) return;
  for (const b of due) {
    // Each settlement keeps money and the bond status in one transaction
    // (runInTransaction gives the same BEGIN/COMMIT/ROLLBACK as the legacy
    // raw db.exec calls, while keeping raw SQL out of the application layer).
    try {
      await runInTransaction(async () => {
        const payout = Math.round(b.amount * (1 + b.interest_rate) * 100) / 100;
        const seller = companyRepository.findById(b.seller_company_id);
        const sellerMoney = Math.max(0, Number(seller?.money) || 0);
        const paid = Math.min(sellerMoney, payout);
        const defaulted = sellerMoney < payout;

        if (paid > 0) companyRepository.updateMoney(b.seller_company_id, -paid);
        if (b.buyer_company_id) companyRepository.updateMoney(b.buyer_company_id, paid);
        bondRepository.markSettled(b.id, defaulted ? 'defaulted' : 'matured');
      });
    } catch (err) {
      console.error(`Failed to settle bond #${b.id}:`, err);
    }
  }
}
