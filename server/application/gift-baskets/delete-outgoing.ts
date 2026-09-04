import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { NotFoundError } from '../../errors/domain-error.ts';
import { giftBasketRepository } from '../../repositories/gift-basket-repository.ts';

export interface DeleteOutgoingGiftBasketResult {
  success: true;
}

/**
 * Remove a sender-owned, already-sent basket without refunding its send cost.
 * The predicate and result check are inside one transaction so retries and
 * concurrent requests cannot report success for a missing row (#201).
 */
export async function deleteOutgoingGiftBasketUseCase(
  ctx: GameContext,
  basketId: number,
  year: number
): Promise<DeleteOutgoingGiftBasketResult> {
  if (!Number.isSafeInteger(basketId) || basketId <= 0 || !Number.isSafeInteger(year)) {
    throw new NotFoundError('Basket not found');
  }

  return runInTransaction(() => {
    const deleted = giftBasketRepository.deleteOutgoingOwned(basketId, ctx.companyId, year);
    if (!deleted) {
      throw new NotFoundError('Basket not found');
    }
    return { success: true };
  }, { immediate: true });
}
