import { socialRepository } from '../../repositories/social-repository.ts';

/** Records a SimBoost spend for the account-page use history.
 * MUST be called inside the same transaction as the debit so the
 * history can never show a spend that did not commit (and vice versa). */
export function recordSimboostSpend(companyId: number, action: string, spend: number): void {
  socialRepository.recordSimboostSpend(companyId, action, spend);
}
