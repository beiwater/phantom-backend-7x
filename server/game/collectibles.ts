/**
 * Issue #82: Collectible Exchange (NFT trading).
 *
 * Decompiled spec (collectibles.json → nftCollectibleTrading): collectibles
 * are NFT-like unique assets traded exclusively for SimBoosts
 * ("Wo.COLLECTIBLE_TRADE — purchasing collectibles is a SimBoost spend
 * action"). Fields per chunk_oea.js / chunk_cji.js: id, name, image, realm,
 * ipfs (object with .description), asset.currentOwnerId, priceSimboosts.
 *
 * Rules implemented here:
 *   - Unique collectibles have exactly one owner (nft_assets.current_owner_id,
 *     NULL = exchange treasury) and at most one active listing
 *     (uq_nft_listings_active_asset partial unique index).
 *   - Listing / delisting / price updates are owner-only; delisting is free
 *     (spec: "If you are the current owner, delisting is free").
 *   - Buying debits the buyer, credits the seller and transfers ownership in
 *     ONE atomic transaction (runInTransaction); the purchase appends a row to
 *     nft_trades which forms the asset's provenance chain.
 *   - Treasury-seeded collectibles (seller NULL) are purchased without a
 *     seller credit — there is no player to pay.
 *
 * Tables live in server/db/migrations/index.ts (Issue #82 tail section,
 * idempotent DDL + seed of 8 unique collectibles across the four rarity
 * tiers), so they exist at boot for fresh DATA_DIRs.
 */
import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { getCompanyById, updateCompanySimBoosts } from './company.ts';
import {
  ConflictError,
  ForbiddenError,
  InvariantViolationError,
  InsufficientFundsError,
  NotFoundError,
  ValidationError
} from '../errors/domain-error.ts';

export const LISTING_ACTIVE = 'active';
export const LISTING_DELISTED = 'delisted';
export const LISTING_SOLD = 'sold';

export interface NftAssetView {
  id: number;
  definitionId: string;
  name: string;
  image: string;
  realm: number;
  rarity: string;
  description: string;
  /** companies.company_id of the owner; NULL = exchange treasury (unowned). */
  currentOwnerId: number | null;
  mintedAt: string;
}

export interface CollectibleListingView {
  id: number;
  nftId: number;
  /** companies.company_id of the seller; NULL = exchange treasury listing. */
  sellerId: number | null;
  priceSimboosts: number;
  status: 'active' | 'delisted' | 'sold';
  createdAt: string;
  updatedAt: string | null;
}

export interface MarketCollectibleView {
  /** Listing id (the id traded on /api/v2/market-collectibles/:id/). */
  id: number;
  priceSimboosts: number;
  sellerId: number | null;
  createdAt: string;
  /** Asset payload always carries the ipfs object on the market list (chunk_cji.js). */
  asset: NftAssetView & { ipfs: { description: string } };
}

export interface CollectibleTradeView {
  id: number;
  datetime: string;
  priceSimboosts: number;
}

export interface NftCollectorView {
  /** companies.company_id */
  id: number;
  company: string;
  logo: string;
  /** Collectibles currently owned. */
  count: number;
  /** Acquisition value: sum of each owned asset's latest sale price (0 if never sold). */
  value: number;
}

interface NftAssetRow {
  id: number;
  definition_id: string;
  name: string;
  image: string;
  realm: number;
  rarity: string;
  description: string;
  current_owner_id: number | null;
  minted_at: string;
}

interface NftListingRow {
  id: number;
  nft_id: number;
  seller_id: number | null;
  price_simboosts: number;
  status: string;
  created_at: string;
  updated_at: string | null;
}

function toAssetView(row: NftAssetRow): NftAssetView {
  return {
    id: Number(row.id),
    definitionId: row.definition_id,
    name: row.name,
    image: row.image,
    realm: Number(row.realm),
    rarity: row.rarity,
    description: row.description ?? '',
    currentOwnerId: row.current_owner_id === null || row.current_owner_id === undefined ? null : Number(row.current_owner_id),
    mintedAt: row.minted_at
  };
}

function toListingView(row: NftListingRow): CollectibleListingView {
  return {
    id: Number(row.id),
    nftId: Number(row.nft_id),
    sellerId: row.seller_id === null || row.seller_id === undefined ? null : Number(row.seller_id),
    priceSimboosts: Number(row.price_simboosts),
    status: row.status as CollectibleListingView['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}


/** GET /api/v2/nfts/assets/{assetId}/ — authoritative NFT ownership lookup. */
export function getNftAsset(assetId: number): NftAssetView | null {
  const row = db.prepare('SELECT * FROM nft_assets WHERE id = ?').get(assetId) as NftAssetRow | undefined;
  return row ? toAssetView(row) : null;
}

/** GET /api/v3/companies/{companyId}/collectibles/ — a company's collectible vault. */
export function getCompanyCollectibles(companyId: number): NftAssetView[] {
  const rows = db.prepare(
    'SELECT * FROM nft_assets WHERE current_owner_id = ? ORDER BY id ASC'
  ).all(companyId) as NftAssetRow[];
  return rows.map(toAssetView);
}

/** GET /api/v2/market-collectibles/ — every collectible listed on the exchange. */
export function listMarketCollectibles(): MarketCollectibleView[] {
  const rows = db.prepare(`
    SELECT l.id AS listing_id, l.seller_id AS seller_id, l.price_simboosts AS price_simboosts,
           l.created_at AS created_at,
           a.id AS asset_id, a.definition_id AS definition_id, a.name AS name, a.image AS image,
           a.realm AS realm, a.rarity AS rarity, a.description AS description,
           a.current_owner_id AS current_owner_id, a.minted_at AS minted_at
    FROM nft_listings l
    JOIN nft_assets a ON a.id = l.nft_id
    WHERE l.status = 'active'
    ORDER BY l.price_simboosts ASC, l.id ASC
  `).all() as Array<Record<string, unknown>>;

  return rows.map(row => {
    const asset = toAssetView({
      id: row.asset_id,
      definition_id: row.definition_id,
      name: row.name,
      image: row.image,
      realm: row.realm,
      rarity: row.rarity,
      description: row.description,
      current_owner_id: row.current_owner_id,
      minted_at: row.minted_at
    } as NftAssetRow);
    return {
      id: Number(row.listing_id),
      priceSimboosts: Number(row.price_simboosts),
      sellerId: row.seller_id === null || row.seller_id === undefined ? null : Number(row.seller_id),
      createdAt: String(row.created_at),
      asset: { ...asset, ipfs: { description: asset.description } }
    };
  });
}

/**
 * GET /api/v2/nfts/assets/{assetId}/trades/ — provenance chain of sales,
 * oldest first: [{ id, datetime, priceSimboosts }].
 */
export function getAssetTrades(assetId: number): CollectibleTradeView[] {
  const rows = db.prepare(
    'SELECT id, datetime, price_simboosts FROM nft_trades WHERE nft_id = ? ORDER BY id ASC'
  ).all(assetId) as Array<{ id: number; datetime: string; price_simboosts: number }>;
  return rows.map(row => ({
    id: Number(row.id),
    datetime: row.datetime,
    priceSimboosts: Number(row.price_simboosts)
  }));
}

/** GET /api/v2/nfts/collectors/ — top collectors ranked by count, then value. */
export function getNftCollectors(): NftCollectorView[] {
  const rows = db.prepare(`
    SELECT a.current_owner_id AS owner_id,
           c.name AS company,
           COALESCE(c.logo, '') AS logo,
           COUNT(*) AS collectibles_count,
           COALESCE(SUM((
             SELECT t.price_simboosts FROM nft_trades t WHERE t.nft_id = a.id ORDER BY t.id DESC LIMIT 1
           )), 0) AS total_value
    FROM nft_assets a
    JOIN companies c ON c.company_id = a.current_owner_id
    WHERE a.current_owner_id IS NOT NULL
    GROUP BY a.current_owner_id, c.name, c.logo
    ORDER BY collectibles_count DESC, total_value DESC, owner_id ASC
  `).all() as Array<{ owner_id: number; company: string; logo: string; collectibles_count: number; total_value: number }>;

  return rows.map(row => ({
    id: Number(row.owner_id),
    company: row.company,
    logo: row.logo ?? '',
    count: Number(row.collectibles_count),
    value: Number(row.total_value)
  }));
}

function assertValidSimboostPrice(simboosts: unknown, field: string): number {
  if (typeof simboosts !== 'number' || !Number.isInteger(simboosts) || simboosts <= 0) {
    throw new ValidationError(`${field} must be a positive integer of SimBoosts`);
  }
  if (simboosts > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError(`${field} exceeds the maximum allowed price`);
  }
  return simboosts;
}

/**
 * POST /api/v2/market-collectibles/ — list YOUR collectible for sale for
 * SimBoosts. Owner-only; the asset must not already have an active listing.
 */
export function listCollectibleForSale(
  companyId: number,
  collectibleId: number,
  simboosts: number
): CollectibleListingView {
  const price = assertValidSimboostPrice(simboosts, 'simboosts');
  if (!Number.isInteger(collectibleId)) {
    throw new ValidationError('collectibleId must be an integer');
  }

  const asset = getNftAsset(collectibleId);
  if (!asset) {
    throw new NotFoundError('Collectible not found');
  }
  if (asset.currentOwnerId !== companyId) {
    throw new ForbiddenError('Only the collectible owner can list it on the exchange');
  }

  const activeListing = db.prepare(
    "SELECT id FROM nft_listings WHERE nft_id = ? AND status = 'active'"
  ).get(collectibleId);
  if (activeListing) {
    throw new ConflictError('This collectible is already listed on the exchange');
  }

  const now = new Date().toISOString();
  const row = db.prepare(`
    INSERT INTO nft_listings (nft_id, seller_id, price_simboosts, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
    RETURNING id, nft_id, seller_id, price_simboosts, status, created_at, updated_at
  `).get(collectibleId, companyId, price, now, now) as NftListingRow;
  return toListingView(row);
}

/**
 * PATCH /api/v2/market-collectibles/{listingId}/ — owner-only listing
 * management. Body semantics (decompiled fcr(listingId): "Purchase a
 * collectible or delist your own; delisting is free"):
 *   - { listed: false }                    → delist
 *   - { listed: true }                     → re-list a delisted listing
 *   - { priceSimboosts: n }                → update the asking price
 *   - {} (empty body)                      → delist (the real client's delist call)
 * Buying is NOT handled here — the private server exposes it explicitly as
 * POST /api/v2/market-collectibles/:id/buy/.
 */
export function updateCollectibleListing(
  companyId: number,
  listingId: number,
  patch: { listed?: boolean; priceSimboosts?: number }
): CollectibleListingView {
  const row = db.prepare('SELECT * FROM nft_listings WHERE id = ?').get(listingId) as NftListingRow | undefined;
  if (!row) {
    throw new NotFoundError('Listing not found');
  }
  if (row.seller_id !== companyId) {
    throw new ForbiddenError('Only the listing owner can manage it');
  }
  if (row.status === LISTING_SOLD) {
    throw new ConflictError('This listing has already been sold');
  }

  let status = row.status;
  let price = Number(row.price_simboosts);

  const wantsDelist = patch.listed === false
    || (patch.listed === undefined && patch.priceSimboosts === undefined);
  const wantsRelist = patch.listed === true;

  if (wantsRelist) {
    if (status === LISTING_ACTIVE) {
      throw new ConflictError('This listing is already active');
    }
    const otherActive = db.prepare(
      "SELECT id FROM nft_listings WHERE nft_id = ? AND status = 'active' AND id <> ?"
    ).get(row.nft_id, listingId);
    if (otherActive) {
      throw new ConflictError('This collectible is already listed on the exchange');
    }
    status = LISTING_ACTIVE;
  } else if (wantsDelist) {
    if (status === LISTING_DELISTED) {
      throw new ConflictError('This listing is already delisted');
    }
    status = LISTING_DELISTED;
  }

  if (patch.priceSimboosts !== undefined) {
    price = assertValidSimboostPrice(patch.priceSimboosts, 'priceSimboosts');
  }

  const now = new Date().toISOString();
  const updated = db.prepare(`
    UPDATE nft_listings SET status = ?, price_simboosts = ?, updated_at = ?
    WHERE id = ?
    RETURNING id, nft_id, seller_id, price_simboosts, status, created_at, updated_at
  `).get(status, price, now, listingId) as NftListingRow;
  return toListingView(updated);
}

export interface CollectiblePurchase {
  listing: CollectibleListingView;
  asset: NftAssetView;
  priceSimboosts: number;
  /** Buyer's SimBoost balance after the debit. */
  buyerSimboosts: number;
}

/**
 * POST /api/v2/market-collectibles/{listingId}/buy/ — purchase a listed
 * collectible with SimBoosts. Atomic: buyer debit, seller credit, ownership
 * transfer, listing closure and provenance row commit together or not at all.
 */
export function buyCollectible(buyerCompanyId: number, listingId: number): CollectiblePurchase {
  return runInTransaction(() => {
    const row = db.prepare('SELECT * FROM nft_listings WHERE id = ?').get(listingId) as NftListingRow | undefined;
    if (!row) {
      throw new NotFoundError('Listing not found');
    }
    if (row.status !== LISTING_ACTIVE) {
      throw new ConflictError('This collectible is not available for purchase');
    }
    if (row.seller_id === buyerCompanyId) {
      throw new ConflictError('You cannot buy your own listing');
    }

    const assetRow = db.prepare('SELECT * FROM nft_assets WHERE id = ?').get(row.nft_id) as NftAssetRow | undefined;
    if (!assetRow) {
      throw new InvariantViolationError(`Listing ${listingId} references missing collectible ${row.nft_id}`);
    }
    // Ownership invariant: a listing may only be bought while its seller (or
    // the treasury) still owns the asset.
    const expectedOwner = row.seller_id;
    if (Number(assetRow.current_owner_id) !== Number(expectedOwner)) {
      throw new ConflictError('The seller no longer owns this collectible');
    }

    const buyer = getCompanyById(buyerCompanyId);
    if (!buyer) {
      throw new NotFoundError('Company not found');
    }
    const price = Number(row.price_simboosts);
    if (Number(buyer.simboosts) < price) {
      throw new InsufficientFundsError(`Not enough SimBoosts: need ${price}, have ${buyer.simboosts}`);
    }

    const buyerBalance = updateCompanySimBoosts(buyerCompanyId, -price);
    // Treasury listings (seller NULL) have no player to credit.
    if (expectedOwner !== null) {
      const seller = getCompanyById(expectedOwner);
      if (seller) {
        updateCompanySimBoosts(expectedOwner, price);
      }
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE nft_assets SET current_owner_id = ? WHERE id = ?').run(buyerCompanyId, row.nft_id);
    const updatedListing = db.prepare(`
      UPDATE nft_listings SET status = 'sold', updated_at = ?
      WHERE id = ?
      RETURNING id, nft_id, seller_id, price_simboosts, status, created_at, updated_at
    `).get(now, listingId) as NftListingRow;
    db.prepare(`
      INSERT INTO nft_trades (nft_id, listing_id, seller_id, buyer_id, price_simboosts, datetime)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.nft_id, listingId, row.seller_id, buyerCompanyId, price, now);

    return {
      listing: toListingView(updatedListing),
      asset: { ...toAssetView(assetRow), currentOwnerId: buyerCompanyId },
      priceSimboosts: price,
      buyerSimboosts: buyerBalance
    };
  });
}
