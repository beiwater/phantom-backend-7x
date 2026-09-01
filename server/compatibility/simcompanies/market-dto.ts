/**
 * Market compatibility DTO mapping (Issue #105 Phase 3).
 * Converts repository entities into the shape the original SimCompanies
 * frontend expects. Protocol/adapter concern only — no business rules.
 */
import type { MarketOrderEntity } from '../../repositories/market-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';

export interface MarketOrderSellerDTO {
  id: number;
  company: string;
  realmId: number;
  logo: string;
  certificates: number;
  contest_wins: number;
  npc: boolean;
  courseId: null;
  ip: string;
}

export interface MarketOrderDTO {
  id: number;
  kind: number;
  quantity: number;
  quality: number;
  price: number;
  datetimeDecayUpdated: string;
  seller: MarketOrderSellerDTO;
  posted: string;
  fees: number;
}

export function formatMarketOrder(order: MarketOrderEntity): MarketOrderDTO {
  const seller = order.sellerId === 999900
    ? { companyId: order.sellerId, name: 'Market Supplier', realmId: 0, logo: '' }
    : companyRepository.findById(order.sellerId) ?? {
        companyId: order.sellerId,
        name: 'Market Trader',
        realmId: 0,
        logo: ''
      };

  return {
    id: order.id,
    kind: order.kind,
    quantity: order.quantity,
    quality: order.quality,
    price: order.price,
    datetimeDecayUpdated: order.postedAt,
    seller: {
      id: seller.companyId,
      company: seller.name,
      realmId: seller.realmId ?? 0,
      logo: seller.logo || '',
      certificates: 0,
      contest_wins: 0,
      npc: order.sellerId === 999900,
      courseId: null,
      ip: 'private'
    },
    posted: order.postedAt,
    fees: order.fees
  };
}
