import { DomainError, ValidationError } from '../../errors/domain-error.ts';

/**
 * Pure market domain rules (Issue #105 Phase 3 / Issue #104 Stage 2).
 * Zero IO: no db, no http, no routes imports. Everything is arithmetic or
 * validation over plain values so it is unit-testable in isolation.
 */

// Exchange price tick grid (formulas_market.md §2, entry.js U0). Each price
// band has a fixed tick; a posted order price must be a whole multiple of the
// tick for the band its price falls into.
const PRICE_TICK_BANDS: ReadonlyArray<{ minPrice: number; tick: number }> = [
  { minPrice: 20000, tick: 500 },
  { minPrice: 10000, tick: 100 },
  { minPrice: 5000, tick: 25 },
  { minPrice: 1000, tick: 10 },
  { minPrice: 500, tick: 5 },
  { minPrice: 200, tick: 2 },
  { minPrice: 100, tick: 1 },
  { minPrice: 50, tick: 0.5 },
  { minPrice: 20, tick: 0.25 },
  { minPrice: 5, tick: 0.1 },
  { minPrice: 2, tick: 0.05 },
  { minPrice: 1, tick: 0.01 },
  { minPrice: 0.5, tick: 0.005 },
  { minPrice: 0, tick: 0.001 }
];

export function getPriceTickSize(price: number): number {
  for (const band of PRICE_TICK_BANDS) {
    if (price >= band.minPrice) return band.tick;
  }
  return 0.001;
}

// Exchange fee: 4% on both realms (formulas_market.md §1/§3), charged as
// fee = ceil(amount × price × 0.04) against the SELLER's proceeds at fill
// time — never at posting, never on cancellation. The epsilon snap keeps
// Math.ceil honest when amount × price × 0.04 is an exact integer up to
// float noise (e.g. 25 × 0.04 → 1.0000000000000002).
export const EXCHANGE_FEE_RATE = 0.04;

export function computeExchangeFee(amount: number, price: number): number {
  return Math.ceil(Math.round(amount * price * EXCHANGE_FEE_RATE * 1e6) / 1e6);
}

/** Validate and normalize a posted sell order. Throws ValidationError on bad input. */
export function validateSellOrderInput(input: {
  kind: number;
  quantity: number;
  price: number;
  quality?: number;
}): { kind: number; quantity: number; price: number; quality: number } {
  const kind = Number(input.kind);
  const quantity = Number(input.quantity);
  const price = Number(input.price);
  const quality = input.quality === undefined ? 0 : Number(input.quality);

  if (!Number.isSafeInteger(kind) || kind <= 0) {
    throw new ValidationError(`Invalid resource kind: ${input.kind}`);
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError(`Invalid quantity: ${input.quantity}`);
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new ValidationError(`Invalid price: ${input.price}`);
  }
  if (!Number.isInteger(quality) || quality < 0 || quality > 12) {
    throw new ValidationError(`Invalid quality: ${input.quality}`);
  }

  // Issue #100: exchange prices must sit on the tick grid for their price
  // range. Off-grid prices are rejected.
  const tick = getPriceTickSize(price);
  if (Math.abs(price / tick - Math.round(price / tick)) > 1e-6) {
    throw new DomainError(
      `Price ${price} is not a multiple of the ${tick} tick size for its price range`,
      400,
      'PRICE_TICK_INVALID'
    );
  }

  return { kind, quantity, price, quality };
}

/** Validate and normalize a take-order (buy) request. */
export function validateTakeOrderInput(input: {
  resource: number;
  quantity: number;
  quality?: number;
  maxPrice?: number | null;
}): {
  resourceKind: number;
  quantity: number;
  minQuality: number;
  maxPrice: number;
} {
  const resourceKind = Number(input.resource);
  const quantity = Number(input.quantity);
  const minQuality = Number(input.quality ?? 0);

  // P0-08: the client's "buy missing construction materials" flow
  // (buyResources → POST /api/v2/market-order/take/) sends NO maxPrice at all
  // — the purchase is bounded only by the company's cash. A missing maxPrice
  // previously failed validation and the buy button always errored.
  const hasMaxPrice = input.maxPrice !== undefined && input.maxPrice !== null;
  const maxPrice = hasMaxPrice ? Number(input.maxPrice) : Number.POSITIVE_INFINITY;

  if (!Number.isSafeInteger(resourceKind) || resourceKind <= 0) {
    throw new ValidationError(`Unknown resource kind: ${input.resource}`);
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError(`Invalid purchase quantity: ${input.quantity}`);
  }
  if (hasMaxPrice && (!Number.isFinite(maxPrice) || maxPrice <= 0)) {
    throw new ValidationError(`Invalid maximum price: ${input.maxPrice}`);
  }
  if (!Number.isInteger(minQuality) || minQuality < 0 || minQuality > 12) {
    throw new ValidationError(`Invalid quality: ${input.quality}`);
  }

  return { resourceKind, quantity, minQuality, maxPrice };
}

/**
 * Issue #85: Self-Trading (Wash Trading) Prevention — a company must never
 * fill its own (or its owning player's) resting order. NPC supply orders
 * (seller 999900) are exempt.
 */
export function isSelfTrade(
  buyerCompanyId: number,
  buyerPlayerId: number | null | undefined,
  sellerOrderId: number,
  sellerPlayerId: number | null | undefined
): boolean {
  if (sellerOrderId === 999900) return false;
  if (sellerOrderId === buyerCompanyId) return true;
  return Boolean(
    buyerPlayerId &&
    sellerPlayerId &&
    buyerPlayerId === sellerPlayerId
  );
}

/** Transport cost rounding rule: ceil(per-unit transport × quantity). */
export function computeTransportNeeded(transportPerUnit: number, quantity: number): number {
  return Math.ceil((transportPerUnit || 0) * quantity);
}

