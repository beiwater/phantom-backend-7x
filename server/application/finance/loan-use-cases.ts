import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { loanRepository } from '../../repositories/loan-repository.ts';
import { DEFAULT_INTEREST_RATE, LOAN_TERM_MS, loanCap, balanceAfterDuePayment } from '../../domain/finance/loan-rules.ts';

export type { LoanRow } from '../../repositories/loan-repository.ts';

export function getActiveLoans(companyId: number) {
  return loanRepository.list(companyId);
}

export async function takeLoan(companyId: number, amount: number) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Loan amount must be positive');
  return runInTransaction(() => {
    const company = companyRepository.findById(companyId);
    if (!company) throw new Error('Company not found');
    const cap = loanCap(Number(company.level) || 1);
    const current = loanRepository.activePrincipal(companyId);
    if (current + amt > cap) throw new Error('Loan cap exceeded: active principal ' + current + ' + ' + amt + ' > cap ' + cap);
    const now = virtualClock.now();
    const due = new Date(now.getTime() + LOAN_TERM_MS);
    const loanId = loanRepository.insert(companyId, amt, DEFAULT_INTEREST_RATE, now.toISOString(), due.toISOString());
    const money = companyRepository.updateMoney(companyId, amt);
    return { loanId, money, moneyDelta: amt, cap, activePrincipal: current + amt };
  }, { immediate: true });
}

export async function repayLoan(companyId: number, loanId: number, amount: number) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Repayment amount must be positive');
  return runInTransaction(() => {
    const loan = loanRepository.find(loanId);
    if (!loan || loan.company_id !== companyId) throw new Error('Loan not found');
    if (loan.status !== 'active') throw new Error('Loan is not active');
    const pay = Math.min(amt, Number(loan.remaining) || 0);
    const money = companyRepository.updateMoney(companyId, -pay);
    const remaining = (Number(loan.remaining) || 0) - pay;
    const status = remaining <= 0 ? 'repaid' : 'active';
    loanRepository.updateBalance(loanId, remaining, status, loan.due_at);
    return { loanId, paid: pay, remaining, status, money, moneyDelta: -pay };
  }, { immediate: true });
}

// Explicit scheduler/mutations settle loans; reads never create schema or debit.
export async function settleDueLoans(companyId?: number): Promise<void> {
  const now = virtualClock.nowIso();
  for (const loan of loanRepository.due(now, companyId)) {
    try {
      await runInTransaction(() => {
        const current = loanRepository.find(loan.id);
        if (!current || current.status !== 'active' || current.due_at > now) return;
        const owed = Number(current.remaining) || 0;
        if (owed <= 0) {
          loanRepository.updateBalance(current.id, current.remaining, 'repaid', current.due_at);
          return;
        }
        const company = companyRepository.findById(current.company_id);
        const paid = company ? Math.max(0, Math.min(owed, Number(company.money) || 0)) : 0;
        if (paid > 0) companyRepository.updateMoney(current.company_id, -paid);
        const remaining = balanceAfterDuePayment(owed, paid, Number(current.interest_rate) || DEFAULT_INTEREST_RATE);
        const nextDue = new Date(Date.parse(current.due_at) + LOAN_TERM_MS).toISOString();
        loanRepository.updateBalance(current.id, remaining, remaining <= 0 ? 'repaid' : 'active', nextDue);
      }, { immediate: true });
    } catch {
      // Preserve per-loan isolation: a malformed row does not stop other loans.
    }
  }
}
