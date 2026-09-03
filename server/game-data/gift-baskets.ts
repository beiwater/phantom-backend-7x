import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { companyRepository } from '../repositories/company-repository.ts';
import { virtualClock } from '../core/virtual-clock.ts';

/** Official gift-basket catalog (frontend bundle CJr table). cost is the
 * money price; requirements are resource kind -> amount consumed on send. */
export const BASKET_KINDS: Record<string, { image: string; imageWithSimboosts: string; cost: number; requirements: Record<string, number> }> = {
  CARD: { image: 'images/gift-baskets/card.png', imageWithSimboosts: 'images/gift-baskets/card.png', cost: 1000, requirements: {} },
  FRUIT_BASKET: { image: 'images/gift-baskets/fruit-basket.png', imageWithSimboosts: 'images/gift-baskets/fruit-basket-sb.png', cost: 5000, requirements: { '3': 3500, '4': 3000, '5': 1700 } },
  CHOCOLATE_BASKET: { image: 'images/gift-baskets/chocolate-basket.png', imageWithSimboosts: 'images/gift-baskets/chocolate-basket-sb.png', cost: 5000, requirements: { '5': 400, '140': 100 } },
  CHEESE_BASKET: { image: 'images/gift-baskets/cheese-basket.png', imageWithSimboosts: 'images/gift-baskets/cheese-basket-sb.png', cost: 5000, requirements: { '5': 120, '122': 150 } },
  COFFEE_BASKET: { image: 'images/gift-baskets/coffee-basket.png', imageWithSimboosts: 'images/gift-baskets/coffee-basket-sb.png', cost: 5000, requirements: { '118': 15000, '140': 50 } },
  ASSORTED_BASKET: { image: 'images/gift-baskets/assorted-basket.png', imageWithSimboosts: 'images/gift-baskets/assorted-basket-sb.png', cost: 10000, requirements: { '118': 5000, '122': 70, '140': 50 } }
};

export const SIMBOOSTS_OPTIONS = [0, 10, 25, 100, 500];

export interface BasketRow {
  id: number; sender_company_id: number; recipient_company_id: number; kind: string;
  simboosts: number; quality: number | null; collectible_id: number | null;
  message: string | null; year: number; sent: number; simboosts_claimed: number; created_at: string;
}

function toDto(row: BasketRow, viewerCompanyId: number) {
  const incoming = row.recipient_company_id === viewerCompanyId;
  const otherId = incoming ? row.sender_company_id : row.recipient_company_id;
  const other = db.prepare('SELECT company_id, name, logo, realm_id FROM companies WHERE company_id = ?').get(otherId) as { company_id: number; name: string; logo: string; realm_id: number } | undefined;
  const otherDto = other ? { id: other.company_id, company: other.name, logo: other.logo || null, realmId: other.realm_id, certificates: 0 } : null;
  return {
    id: row.id,
    kind: row.kind,
    simboosts: row.simboosts,
    quality: row.quality,
    collectibleId: row.collectible_id,
    message: row.message,
    year: row.year,
    sentDate: row.sent_at ?? row.created_at,
    simboostsClaimed: Boolean(row.simboosts_claimed),
    sender: incoming ? otherDto : undefined,
    recipient: incoming ? undefined : otherDto
  };
}

export function getDraft(companyId: number, year: number): Record<string, unknown> | null {
  const row = db.prepare('SELECT draft_json FROM gift_basket_drafts WHERE company_id = ? AND year = ?').get(companyId, year) as { draft_json: string | null } | undefined;
  return row?.draft_json ? (JSON.parse(row.draft_json) as Record<string, unknown>) : null;
}

export function saveDraft(companyId: number, year: number, draft: Record<string, unknown>): Record<string, unknown> {
  db.prepare('INSERT INTO gift_basket_drafts (company_id, year, draft_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (company_id, year) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at')
    .run(companyId, year, JSON.stringify(draft), virtualClock.nowIso());
  return getDraft(companyId, year);
}

export function listOutgoing(companyId: number, year: number): Array<ReturnType<typeof toDto>> {
  const rows = db.prepare('SELECT * FROM gift_baskets WHERE sender_company_id = ? AND year = ? AND sent = 1 ORDER BY id DESC').all(companyId, year) as BasketRow[];
  return rows.map(r => toDto(r, companyId));
}

export function listReceived(companyId: number, year: number): Array<ReturnType<typeof toDto>> {
  const rows = db.prepare('SELECT * FROM gift_baskets WHERE recipient_company_id = ? AND year = ? AND sent = 1 ORDER BY id DESC').all(companyId, year) as BasketRow[];
  return rows.map(r => toDto(r, companyId));
}

export async function sendBasket(companyId: number, year: number, input: {
  kind: string; simboosts: number; message?: string; quality?: number; collectibleId?: number; recipientId: number;
}): Promise<{ moneyDelta: number; money: number; lastTransactionId: number; resourceTransactions: Array<{ kind: number; quality: number; amount: number }>; simboostsDelta: number }> {
  const basket = BASKET_KINDS[input.kind];
  if (!basket) throw new Error('Unknown gift basket kind');
  if (!SIMBOOSTS_OPTIONS.includes(input.simboosts)) throw new Error('Invalid SimBoosts amount');
  if (input.recipientId === companyId) throw new Error('Cannot send a gift basket to yourself');
  const recipient = db.prepare('SELECT company_id FROM companies WHERE company_id = ?').get(input.recipientId);
  if (!recipient) throw new Error('Recipient company not found');

  const requirements = Object.entries(basket.requirements).map(([kind, amount]) => ({ kind: Number(kind), amount }));
  let simboostsDelta = 0;
  let lastTransactionId = 0;
  let moneyDelta = 0;

  await runInTransaction(() => {
    companyRepository.debitMoney(companyId, basket.cost);
    moneyDelta = -basket.cost;
    if (input.simboosts > 0) {
      companyRepository.debitSimboosts(companyId, input.simboosts);
      simboostsDelta = -input.simboosts;
    }
    for (const req of requirements) {
      const row = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 0').get(companyId, req.kind) as { amount: number } | undefined;
      if (!row || row.amount < req.amount) {
        throw new Error('Not enough resources for this basket (need ' + req.amount + ' of #' + req.kind + ')');
      }
      db.prepare('UPDATE warehouse SET amount = amount - ? WHERE company_id = ? AND kind = ? AND quality = 0').run(req.amount, companyId, req.kind);
    }
    const res = db.prepare('INSERT INTO gift_baskets (sender_company_id, recipient_company_id, kind, simboosts, quality, collectible_id, message, year, sent, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(companyId, input.recipientId, input.kind, input.simboosts, input.quality ?? null, input.collectibleId ?? null, input.message ?? null, year, virtualClock.nowIso(), virtualClock.nowIso());
    lastTransactionId = Number(res.lastInsertRowid);
  });

  const money = (db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number }).money;
  return { moneyDelta, money, lastTransactionId, resourceTransactions: requirements.map(r => ({ kind: r.kind, quality: 0, amount: -r.amount })), simboostsDelta };
}

/** Recipient claims the SimBoosts inside a received basket (idempotent). */
export async function claimBasket(companyId: number, basketId: number): Promise<{ simboostsDelta: number }> {
  return runInTransaction(() => {
    const row = db.prepare('SELECT * FROM gift_baskets WHERE id = ? AND recipient_company_id = ? AND sent = 1').get(basketId, companyId) as BasketRow | undefined;
    if (!row) throw new Error('Basket not found');
    if (row.simboosts_claimed) return { simboostsDelta: 0 };
    let delta = 0;
    if (row.simboosts > 0) {
      companyRepository.creditSimboosts(companyId, row.simboosts);
      delta = row.simboosts;
    }
    db.prepare('UPDATE gift_baskets SET simboosts_claimed = 1 WHERE id = ?').run(basketId);
    return { simboostsDelta: delta };
  });
}

export function updateOutgoingMessage(companyId: number, basketId: number, message: string): void {
  db.prepare('UPDATE gift_baskets SET message = ? WHERE id = ? AND sender_company_id = ?').run(message, basketId, companyId);
}

export function deleteReceived(companyId: number, basketId: number): void {
  db.prepare('DELETE FROM gift_baskets WHERE id = ? AND recipient_company_id = ?').run(basketId, companyId);
}