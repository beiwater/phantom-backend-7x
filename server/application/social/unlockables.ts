import { companyRepository } from '../../repositories/company-repository.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { socialRepository } from '../../repositories/social-repository.ts';

/** Official HQ skin catalog (mirrors the frontend bundle's unlock table).
 * simboosts === null means the skin is not purchasable. */
export const HQ_SKINS: Array<{ idx: number; simboosts: number | null; image: string }> = [
  { idx: 0, simboosts: 0, image: '' },
  { idx: 1, simboosts: 100, image: 'images/landscape/hq/hq-golf.png' },
  { idx: 2, simboosts: 200, image: 'images/landscape/hq/hq-golf2.png' },
  { idx: 3, simboosts: null, image: 'images/landscape/hq/hq-green-tower.png' },
  { idx: 4, simboosts: null, image: 'images/landscape/hq/hq-banana.png' },
  { idx: 5, simboosts: 300, image: 'images/landscape/hq/hq-vintage.png' },
  { idx: 6, simboosts: null, image: 'images/landscape/hq/hq-ariake.png' },
  { idx: 7, simboosts: null, image: 'images/landscape/hq/hq-haunted.svg' },
  { idx: 8, simboosts: null, image: 'images/landscape/hq/hq-winter.png' },
  { idx: 9, simboosts: 0, image: 'images/landscape/hq/hq-uk-bell-tower.png' },
  { idx: 10, simboosts: null, image: 'images/landscape/hq/hq-town-hall-xmas.png' },
  { idx: 11, simboosts: null, image: 'images/landscape/hq/hq-obsidian.png' }
];

/** Official PA catalog with SimBoost unlock costs (frontend UP map). */
export const PA_KINDS = ['vicky', 'jane', 'old', 'lakshmi', 'paige'] as const;
export type PaKind = typeof PA_KINDS[number];
export const PA_COSTS: Record<PaKind, number> = {
  old: 100,
  lakshmi: 100,
  jane: 250,
  vicky: 250,
  paige: 250
};

export class NotPurchasableError extends Error {}

export function listUnlockedHqs(companyId: number): Array<{ idx: number }> {
  return socialRepository.listUnlockedHqs(companyId);
}

export async function unlockHq(companyId: number, idx: number): Promise<Array<{ idx: number }>> {
  const skin = HQ_SKINS.find(entry => entry.idx === idx);
  if (!skin) throw new NotPurchasableError('Unknown HQ skin idx ' + idx);
  if (skin.simboosts === null) throw new NotPurchasableError('HQ skin ' + idx + ' is not purchasable');
  if (socialRepository.isHqUnlocked(companyId, idx)) return listUnlockedHqs(companyId);
  await runInTransaction(() => {
    companyRepository.debitSimboosts(companyId, skin.simboosts!);
    socialRepository.insertUnlockedHq(companyId, idx);
    socialRepository.recordSimboostSpend(companyId, 'HQ_UNLOCK', skin.simboosts!);
  });
  return listUnlockedHqs(companyId);
}

export function listUnlockedPas(companyId: number): Array<{ kind: string }> {
  return socialRepository.listUnlockedPas(companyId);
}

export async function unlockPa(companyId: number, kind: string): Promise<Array<{ kind: string }>> {
  if (!PA_KINDS.includes(kind as PaKind)) throw new NotPurchasableError('Unknown personal assistant ' + kind);
  if (socialRepository.isPaUnlocked(companyId, kind)) return listUnlockedPas(companyId);
  const cost = PA_COSTS[kind as PaKind];
  await runInTransaction(() => {
    companyRepository.debitSimboosts(companyId, cost);
    socialRepository.insertUnlockedPa(companyId, kind);
    socialRepository.recordSimboostSpend(companyId, 'PA_UNLOCK', cost);
  });
  return listUnlockedPas(companyId);
}

export function selectPa(companyId: number, kind: string): void {
  if (!PA_KINDS.includes(kind as PaKind)) throw new NotPurchasableError('Unknown personal assistant ' + kind);
  socialRepository.upsertCompanySetting(companyId, 'personalAssistant', kind);
}

export function getSelectedPa(companyId: number): string | null {
  return socialRepository.getCompanySetting(companyId, 'personalAssistant');
}

/** SimBoost spend history for the account page. */
export function listSimboostUse(companyId: number): Array<{ id: number; spendSimBoosts: number; action: string; datetime: string }> {
  return socialRepository.listSimboostUse(companyId);
}
