/**
 * Issue #95: Building Auctions — 24-hour hidden sealed-bid (Vickrey) sales.
 *
 * Decompiled spec (frontend bundle `VUt` constants + real API captures):
 *   minBuildingLevel = 5, minAbundance = 95, auctionDurationHours = 24,
 *   auctionFeePercent = 20, maxBid = 5e8, promoteAuctionSimboosts = 30,
 *   sellingSlotsSimboosts = [0, 15, 30], abundance level thresholds
 *   {Perfect:100, Exceptional:98, VeryGood:95, Good:91, Usable:86, Poor:80, Trash:0}.
 *
 * Rules implemented:
 *   - Seller must hold the `buildingAuctions` capability (level >= 20, canonical
 *     leveling domain — never a hardcoded level check here).
 *   - A building is listable when its level (size) >= 5, or — for natural
 *     resource extractors — when its deposit abundance >= 95%.
 *   - Minimum bid = scrap value = baseCost * size * 0.5 (DEMOLITION_REFUND_RATE).
 *   - guaranteedReturn (the seller's guaranteed take from any sale) =
 *     minBid * (1 - fee%) = baseCost * size * 0.4 — matches every real capture
 *     (e.g. minBid 345000 -> guaranteedReturn 276000).
 *   - Listing frees the seller's slot immediately ("Building slot will be freed
 *     immediately"): the buildings row is deleted and snapshotted onto the
 *     auction row (kind, size, cost, name, category, abundance, robotics).
 *     This is exactly why the real API exposes `auctionbuildingabundanceSet`
 *     on auction objects. Active production queues block listing so queue rows
 *     can never be orphaned (same C-8 invariant as demolition).
 *   - Bids are sealed: amounts are only ever returned to the bidding company.
 *     Bid cash is escrowed atomically at placement, refunded on withdrawal or
 *     loss. One active bid per company per auction; re-bidding replaces it and
 *     re-escrows only the difference.
 *   - Settlement (settleDueAuctions, idempotent): winner = highest sealed bid
 *     (earlier bid wins ties) and pays the SECOND-highest bid (Vickrey), with
 *     the reserve (minBid) as the floor for a single-bid auction. The 20%
 *     commission is deducted from the seller's proceeds. The building is
 *     re-created for the winner inside the 35-slot reposition queue
 *     (position 'l' / 'l<n>'); with no bids the building returns to the seller
 *     through the same queue.
 */
import { db } from '../db/database.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { runInTransaction } from '../db/transaction.ts';
import {
  getBuildingById,
  isAbundanceExtractorKind
} from './buildings.ts';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from './company.ts';
import { CANONICAL_RESOURCES, getResourceDef } from '../game-data/resources.ts';
import { BUILDING_NAMES, DEMOLITION_REFUND_RATE } from '../game-data/buildings.ts';
import { assertCapability } from '../domain/leveling/level-rules.ts';
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  DomainError
} from '../errors/domain-error.ts';

// --- Decompiled auction constants (frontend bundle `VUt`) -------------------

export const AUCTION_DURATION_HOURS = 24;
export const AUCTION_FEE_PERCENT = 20;
export const MIN_BUILDING_LEVEL = 5;
export const MIN_ABUNDANCE = 95;
export const MAX_BID = 5e8;
export const PROMOTE_AUCTION_SIMBOOSTS = 30;
/** Concurrent-auction SimBoost pricing: 1st free, 2nd 15, 3rd 30 (then 30). */
export const SELLING_SLOTS_SIMBOOSTS = [0, 15, 30];
/** Issue #95: the reposition queue holds up to 35 buildings ('l'/'l<n>'). */
export const REPOSITION_QUEUE_CAPACITY = 35;

/** Abundance percentage -> named level (decompiled `gNn` thresholds). */
const ABUNDANCE_LEVEL_THRESHOLDS: Array<{ level: string; min: number }> = [
  { level: 'Perfect', min: 100 },
  { level: 'Exceptional', min: 98 },
  { level: 'VeryGood', min: 95 },
  { level: 'Good', min: 91 },
  { level: 'Usable', min: 86 },
  { level: 'Poor', min: 80 }
];

export function abundanceLevelName(abundancePercent: number): string {
  for (const entry of ABUNDANCE_LEVEL_THRESHOLDS) {
    if (abundancePercent >= entry.min) return entry.level;
  }
  return 'Trash';
}

// --- Row shapes -------------------------------------------------------------

interface AuctionRow {
  id: number;
  building_id: number;
  building_kind: string;
  building_size: number;
  building_cost: number;
  building_name: string | null;
  building_category: string | null;
  realm: number;
  seller_id: number;
  min_bid: number;
  guaranteed_return: number;
  promoted: number;
  status: string;
  winner_id: number | null;
  final_price: number | null;
  seller_proceeds: number | null;
  settled_at: string | null;
  robots_installed: number | null;
  robots_quality: number | null;
  locked_product: number | null;
  abundance: number | null;
  original_abundance: number | null;
  started_at: string;
  closes_at: string;
  created_at: string;
}

interface BidRow {
  id: number;
  auction_id: number;
  company_id: number;
  amount: number;
  escrowed: number;
  status: string;
  created_at: string;
  updated_at: string | null;
}

export interface AuctionDTO {
  id: number;
  buildingId: number;
  buildingKind: string;
  buildingSize: number;
  realm: number;
  startedAt: string;
  promoted: boolean;
  sellerId: number;
  auctionbuildingabundanceSet: Array<{ resourceKind: number; abundanceLevel: string }>;
  minBid: number;
  guaranteedReturn: number;
  closesAt: string;
  seller: {
    id: number;
    company: string;
    logo: string;
    deleted: boolean;
    realmId: number;
    certificates: number;
    contestWins: number;
  };
  winningBid?: number | null;
}

export interface BidDTO {
  id: number;
  buildingAuctionId: number;
  amount: number;
  created: string;
}

// --- Helpers ----------------------------------------------------------------

function nowIso(): string {
  return virtualClock.nowIso();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Minimum bid: the building's scrap value (baseCost * size * 0.5). */
export function computeMinBid(baseCost: number, size: number): number {
  return Math.round(baseCost * size * DEMOLITION_REFUND_RATE);
}

/** Seller's guaranteed take from any sale: minBid minus the 20% commission. */
export function computeGuaranteedReturn(minBid: number): number {
  return round2(minBid * (1 - AUCTION_FEE_PERCENT / 100));
}

/** Building kinds (extractors) mapped to their producible resource kinds. */
const EXTRACTOR_RESOURCE_KINDS: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = {};
  for (const def of Object.values(CANONICAL_RESOURCES)) {
    const at = def.producedAt;
    if (!at) continue;
    (map[at] ||= []).push(def.dbLetter);
  }
  return map;
})();

function abundanceSetFor(kind: string, abundance: number | null | undefined): Array<{ resourceKind: number; abundanceLevel: string }> {
  if (!isAbundanceExtractorKind(kind) || abundance === null || abundance === undefined) {
    return [];
  }
  const level = abundanceLevelName(Number(abundance));
  return (EXTRACTOR_RESOURCE_KINDS[kind] || []).map(resourceKind => ({ resourceKind, abundanceLevel: level }));
}

function mapAuction(row: AuctionRow): AuctionDTO {
  const seller = getCompanyById(row.seller_id);
  const dto: AuctionDTO = {
    id: row.id,
    buildingId: row.building_id,
    buildingKind: row.building_kind,
    buildingSize: row.building_size,
    realm: row.realm,
    startedAt: row.started_at,
    promoted: Boolean(row.promoted),
    sellerId: row.seller_id,
    auctionbuildingabundanceSet: abundanceSetFor(row.building_kind, row.abundance),
    minBid: row.min_bid,
    guaranteedReturn: row.guaranteed_return,
    closesAt: row.closes_at,
    seller: {
      id: row.seller_id,
      company: seller?.name || 'Unknown company',
      logo: seller?.logo || '',
      deleted: false,
      realmId: Number(seller?.realm_id ?? row.realm ?? 0),
      certificates: 0,
      contestWins: 0
    }
  };
  if (row.status !== 'active') {
    dto.winningBid = row.final_price;
  }
  return dto;
}

function mapBid(row: BidRow): BidDTO {
  return {
    id: row.id,
    buildingAuctionId: row.auction_id,
    amount: row.amount,
    created: row.created_at
  };
}

function getAuctionRow(auctionId: number): AuctionRow | null {
  const row = db.prepare('SELECT * FROM building_auctions WHERE id = ?').get(auctionId) as unknown as AuctionRow | undefined;
  return row || null;
}

// --- Queries ----------------------------------------------------------------

export function getActiveAuctions(realm?: number): AuctionDTO[] {
  const rows = (realm === undefined
    ? db.prepare("SELECT * FROM building_auctions WHERE status = 'active' ORDER BY closes_at ASC").all()
    : db.prepare("SELECT * FROM building_auctions WHERE status = 'active' AND realm = ? ORDER BY closes_at ASC").all(realm)
  ) as unknown as AuctionRow[];
  return rows.map(mapAuction);
}

export function getAuctionById(auctionId: number): AuctionDTO | null {
  const row = getAuctionRow(auctionId);
  return row ? mapAuction(row) : null;
}

export function getCompanyAuctions(companyId: number): AuctionDTO[] {
  const rows = db.prepare(
    'SELECT * FROM building_auctions WHERE seller_id = ? ORDER BY created_at DESC'
  ).all(companyId) as unknown as AuctionRow[];
  return rows.map(mapAuction);
}

/** The authenticated company's own active sealed bids — amounts stay hidden from everyone else. */
export function getMyBids(companyId: number): BidDTO[] {
  const rows = db.prepare(
    `SELECT b.* FROM building_auction_bids b
     JOIN building_auctions a ON a.id = b.auction_id
     WHERE b.company_id = ? AND b.status = 'active' AND a.status = 'active'
     ORDER BY b.created_at ASC`
  ).all(companyId) as unknown as BidRow[];
  return rows.map(mapBid);
}

/** No purchased research unlocks exist on the private server. */
export function getActiveUnlocks(): Array<never> {
  return [];
}

/**
 * Similar auctions research: active auctions of the same building kind
 * (excluding the reference auction itself). Informational only — the
 * SimBoost charge for unlocking research lives on the simboosts-use action.
 */
export function getSimilarAuctions(kind: string, excludeAuctionId?: number): AuctionDTO[] {
  const rows = db.prepare(
    `SELECT * FROM building_auctions
     WHERE status = 'active' AND building_kind = ? AND id != ?
     ORDER BY min_bid ASC`
  ).all(kind, excludeAuctionId ?? -1) as unknown as AuctionRow[];
  return rows.map(mapAuction);
}

export function getSimilarAuctionsByBuilding(buildingId: number): AuctionDTO[] {
  const building = getBuildingById(buildingId);
  if (!building) return [];
  return getSimilarAuctions(building.kind);
}

export function getSimilarAuctionsByAuction(auctionId: number): AuctionDTO[] {
  const auction = getAuctionRow(auctionId);
  if (!auction) return [];
  return getSimilarAuctions(auction.building_kind, auction.id);
}

// --- Listing ----------------------------------------------------------------

export async function listBuildingForAuction(companyId: number, buildingId: number): Promise<AuctionDTO> {
  // Settle expired auctions first so concurrent-auction slot pricing and the
  // reposition-queue capacity reflect the live state (mutation path — never
  // done implicitly on GETs).
  await settleDueAuctions();

  const company = getCompanyById(companyId);
  if (!company) throw new NotFoundError(`Company ${companyId} not found`);

  // 1. Capability gate via the canonical leveling domain (unlocks at level 20).
  assertCapability(Number(company.level) || 0, 'buildingAuctions', 'building auctions');

  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new NotFoundError(`Building with id ${buildingId} not found`);
  }

  // 2. The building must be idle ("Building cannot be busy").
  if (building.busy_until && new Date(building.busy_until).getTime() > virtualClock.nowMs()) {
    throw new ConflictError('Building cannot be busy');
  }

  // 3. Listing deletes the buildings row: reject buildings with unresolved
  // production queues first (C-8 orphan invariant, same as demolition).
  const activeQueues = db.prepare(
    'SELECT COUNT(*) AS count FROM production_queues WHERE building_id = ? AND company_id = ? AND resolved = 0'
  ).get(buildingId, companyId) as { count: number };
  if (Number(activeQueues.count) > 0) {
    throw new ConflictError('Building has an active production order; cancel it before listing');
  }

  // 4. Eligibility: level >= 5, or for extractors a deposit abundance >= 95%.
  const size = Number(building.size) || 1;
  const abundance = building.abundance === null || building.abundance === undefined
    ? null
    : Number(building.abundance);
  const levelEligible = size >= MIN_BUILDING_LEVEL;
  const abundanceEligible = isAbundanceExtractorKind(building.kind)
    && abundance !== null
    && abundance >= MIN_ABUNDANCE;
  if (!levelEligible && !abundanceEligible) {
    throw new ValidationError(
      `Building is not eligible for auction: requires level ${MIN_BUILDING_LEVEL} or ${MIN_ABUNDANCE}% abundance`
    );
  }

  // 5. Concurrent-auction SimBoost pricing: 1st free, 2nd 15, 3rd 30.
  const activeCountRow = db.prepare(
    "SELECT COUNT(*) AS count FROM building_auctions WHERE seller_id = ? AND status = 'active'"
  ).get(companyId) as { count: number };
  const slotCost = SELLING_SLOTS_SIMBOOSTS[
    Math.min(Number(activeCountRow.count), SELLING_SLOTS_SIMBOOSTS.length - 1)
  ];
  if (slotCost > 0) {
    updateCompanySimBoosts(companyId, -slotCost);
  }

  const meta = BUILDING_NAMES[building.kind];
  const minBid = computeMinBid(Number(building.cost) || meta?.cost || 0, size);

  return runInTransaction(() => {
    // 6. Free the seller's slot: remove the building and all of its dependent
    // rows (retail state is not transferable), snapshot everything else.
    db.prepare('DELETE FROM retail_orders WHERE building_id = ? AND company_id = ?')
      .run(buildingId, companyId);
    const deleted = db.prepare('DELETE FROM buildings WHERE id = ? AND company_id = ?')
      .run(buildingId, companyId);
    if (deleted.changes !== 1) {
      throw new NotFoundError(`Building with id ${buildingId} not found`);
    }

    const startedAt = nowIso();
    const closesAt = new Date(virtualClock.nowMs() + AUCTION_DURATION_HOURS * 3600 * 1000).toISOString();
    const result = db.prepare(`
      INSERT INTO building_auctions (
        building_id, building_kind, building_size, building_cost, building_name,
        building_category, realm, seller_id, min_bid, guaranteed_return,
        promoted, status, robots_installed, robots_quality, locked_product,
        abundance, original_abundance, started_at, closes_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      buildingId,
      building.kind,
      size,
      Number(building.cost) || 0,
      building.name,
      building.category,
      Number(company.realm_id) || 0,
      companyId,
      minBid,
      computeGuaranteedReturn(minBid),
      Number((building as unknown as { robots_installed?: number | null }).robots_installed ?? 0) || 0,
      Number((building as unknown as { robots_quality?: number | null }).robots_quality ?? 0) || 0,
      (building as unknown as { locked_product?: number | null }).locked_product ?? null,
      abundance,
      building.original_abundance === null || building.original_abundance === undefined
        ? null
        : Number(building.original_abundance),
      startedAt,
      closesAt,
      startedAt
    );

    const created = getAuctionRow(Number(result.lastInsertRowid));
    if (!created) throw new DomainError('Auction row vanished after insert', 500, 'INVARIANT_VIOLATION');
    return mapAuction(created);
  }, { immediate: true });
}

// --- Bidding ----------------------------------------------------------------

/** Buildings currently in the company's reposition queue (position 'l'/'l<n>'). */
export function countRepositionQueue(companyId: number): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM buildings WHERE company_id = ? AND position LIKE 'l%'"
  ).get(companyId) as { count: number };
  return Number(row.count);
}

/**
 * Pick the next free reposition-queue position ('l' first, then 'l1'..'l34').
 * The manual lift flow uses exactly 'l'; auction arrivals claim 'l<n>' slots
 * so several won buildings can wait at once (35-slot queue).
 */
function nextRepositionPosition(companyId: number): string {
  const taken = new Set(
    (db.prepare(
      "SELECT position FROM buildings WHERE company_id = ? AND position LIKE 'l%'"
    ).all(companyId) as Array<{ position: string }>).map(r => r.position)
  );
  if (!taken.has('l')) return 'l';
  for (let i = 1; i < REPOSITION_QUEUE_CAPACITY; i++) {
    if (!taken.has(`l${i}`)) return `l${i}`;
  }
  throw new ConflictError('Reposition queue is full');
}

export async function placeBid(companyId: number, auctionId: number, amount: number): Promise<BidDTO> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Bid amount must be a positive number');
  }
  const bidAmount = round2(amount);

  // Settlement of due auctions runs inside mutation paths (never on GETs).
  await settleDueAuctions();

  const auction = getAuctionRow(auctionId);
  if (!auction || auction.status !== 'active') {
    throw new NotFoundError(`Auction ${auctionId} not found or already closed`);
  }
  if (new Date(auction.closes_at).getTime() <= virtualClock.nowMs()) {
    throw new ConflictError('Auction has closed');
  }
  if (auction.seller_id === companyId) {
    throw new ValidationError('You cannot bid on your own auction');
  }
  if (bidAmount < auction.min_bid) {
    throw new ValidationError(`Bid must be greater than or equal to ${auction.min_bid}`);
  }
  if (bidAmount > MAX_BID) {
    throw new ValidationError(`Bid must not exceed ${MAX_BID}`);
  }
  // The buyer must be able to actually receive the building later.
  if (countRepositionQueue(companyId) >= REPOSITION_QUEUE_CAPACITY) {
    throw new ConflictError(`Reposition queue is full (${REPOSITION_QUEUE_CAPACITY} buildings)`);
  }

  const bidder = getCompanyById(companyId);
  if (!bidder) throw new NotFoundError(`Company ${companyId} not found`);

  return runInTransaction(() => {
    const existing = db.prepare(
      "SELECT * FROM building_auction_bids WHERE auction_id = ? AND company_id = ? AND status = 'active'"
    ).get(auctionId, companyId) as unknown as BidRow | undefined;

    if (existing) {
      // Replace the sealed bid; re-escrow only the difference (positive delta
      // debits the increase, negative delta credits the reduction).
      const delta = round2(bidAmount - Number(existing.escrowed));
      if (delta !== 0) {
        updateCompanyMoney(companyId, -delta);
      }
      db.prepare(
        "UPDATE building_auction_bids SET amount = ?, escrowed = ?, updated_at = ? WHERE id = ?"
      ).run(bidAmount, bidAmount, nowIso(), existing.id);
      return mapBid({
        ...existing,
        amount: bidAmount,
        escrowed: bidAmount,
        updated_at: nowIso()
      });
    }

    // New sealed bid: escrow the full amount atomically (InsufficientFundsError
    // rolls the whole placement back).
    updateCompanyMoney(companyId, -bidAmount);
    const result = db.prepare(`
      INSERT INTO building_auction_bids (auction_id, company_id, amount, escrowed, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(auctionId, companyId, bidAmount, bidAmount, nowIso());
    const row = db.prepare('SELECT * FROM building_auction_bids WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as unknown as BidRow;
    return mapBid(row);
  }, { immediate: true });
}

export function withdrawBid(companyId: number, bidId: number): void {
  runInTransaction(() => {
    const bid = db.prepare(
      "SELECT * FROM building_auction_bids WHERE id = ? AND company_id = ? AND status = 'active'"
    ).get(bidId, companyId) as unknown as BidRow | undefined;
    if (!bid) {
      throw new NotFoundError(`Bid ${bidId} not found`);
    }
    const auction = getAuctionRow(bid.auction_id);
    if (!auction || auction.status !== 'active' || new Date(auction.closes_at).getTime() <= virtualClock.nowMs()) {
      throw new ConflictError('Auction has closed; bids can no longer be withdrawn');
    }
    updateCompanyMoney(companyId, Number(bid.escrowed)); // refund the escrow
    db.prepare('DELETE FROM building_auction_bids WHERE id = ?').run(bid.id);
  }, { immediate: true });
}

export function promoteAuction(companyId: number, auctionId: number): AuctionDTO {
  return runInTransaction(() => {
    const auction = getAuctionRow(auctionId);
    if (!auction || auction.status !== 'active') {
      throw new NotFoundError(`Auction ${auctionId} not found or already closed`);
    }
    if (auction.seller_id !== companyId) {
      throw new ForbiddenError('You can only promote your own auctions');
    }
    if (!auction.promoted) {
      updateCompanySimBoosts(companyId, -PROMOTE_AUCTION_SIMBOOSTS);
      db.prepare('UPDATE building_auctions SET promoted = 1 WHERE id = ?').run(auctionId);
    }
    const updated = getAuctionRow(auctionId);
    if (!updated) throw new DomainError('Auction row vanished', 500, 'INVARIANT_VIOLATION');
    return mapAuction(updated);
  }, { immediate: true });
}

// --- Settlement ---------------------------------------------------------------

export interface SettlementResult {
  auctionId: number;
  sold: boolean;
  winnerId: number | null;
  price: number | null;
  sellerProceeds: number | null;
  fee: number | null;
}

function requeueBuildingFor(auction: AuctionRow, ownerId: number): number {
  const position = nextRepositionPosition(ownerId);
  const result = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, busy_until, created_at, abundance, original_abundance, robots_installed, robots_quality, locked_product)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
  `).run(
    ownerId,
    position,
    auction.building_kind,
    auction.building_size,
    auction.building_name,
    auction.building_cost,
    auction.building_category,
    nowIso(),
    auction.abundance,
    auction.original_abundance,
    auction.robots_installed ?? 0,
    auction.robots_quality ?? 0,
    auction.locked_product ?? null
  );
  return Number(result.lastInsertRowid);
}

/**
 * Settle every auction whose 24-hour window has elapsed. Idempotent: each
 * auction flips status='active' -> 'settled' inside its own immediate
 * transaction, so concurrent callers re-check before mutating. Runs on auction
 * mutation paths and from the scheduler — never implicitly on GETs.
 */
export async function settleDueAuctions(now: number = virtualClock.nowMs()): Promise<SettlementResult[]> {
  const due = db.prepare(
    "SELECT id FROM building_auctions WHERE status = 'active' AND closes_at <= ?"
  ).all(new Date(now).toISOString()) as Array<{ id: number }>;

  const results: SettlementResult[] = [];
  for (const { id } of due) {
    // Await every transaction so callers observe committed state when this
    // returns (un-awaited promises would race the caller's next read).
    results.push(await runInTransaction(() => {
      const auction = getAuctionRow(id);
      if (!auction || auction.status !== 'active' || new Date(auction.closes_at).getTime() > now) {
        // Already settled by a concurrent caller — treat as a no-op.
        return { auctionId: id, sold: false, winnerId: null, price: null, sellerProceeds: null, fee: null };
      }

      const bids = db.prepare(
        "SELECT * FROM building_auction_bids WHERE auction_id = ? AND status = 'active' ORDER BY amount DESC, id ASC"
      ).all(id) as unknown as BidRow[];

      if (bids.length === 0) {
        // No bids: the building returns to the seller through the reposition
        // queue; no money moves.
        requeueBuildingFor(auction, auction.seller_id);
        db.prepare(`
          UPDATE building_auctions
          SET status = 'settled', winner_id = NULL, final_price = NULL,
              seller_proceeds = 0, settled_at = ?
          WHERE id = ? AND status = 'active'
        `).run(nowIso(), id);
        return { auctionId: id, sold: false, winnerId: null, price: null, sellerProceeds: null, fee: null };
      }

      // Vickrey: winner pays the second-highest sealed bid, floored at the
      // reserve (minBid) when only one bid stands. Every stored bid already
      // cleared the reserve at placement, so bids[1] >= minBid.
      const winner = bids[0];
      const runnerUp = bids.length > 1 ? bids[1] : null;
      const price = round2(Math.max(Number(runnerUp?.amount ?? auction.min_bid), auction.min_bid));
      const proceeds = round2(price * (1 - AUCTION_FEE_PERCENT / 100));
      const fee = round2(price - proceeds);

      // 1. Winner: refund the escrow surplus (bid minus Vickrey price).
      const refund = round2(Number(winner.escrowed) - price);
      if (refund > 0) {
        updateCompanyMoney(winner.company_id, refund);
      }
      db.prepare("UPDATE building_auction_bids SET status = 'won', updated_at = ? WHERE id = ?")
        .run(nowIso(), winner.id);

      // 2. Losers: full escrow refunds.
      for (const loser of bids.slice(1)) {
        updateCompanyMoney(loser.company_id, Number(loser.escrowed));
        db.prepare("UPDATE building_auction_bids SET status = 'outbid', updated_at = ? WHERE id = ?")
          .run(nowIso(), loser.id);
      }

      // 3. Seller receives the proceeds minus the 20% commission.
      updateCompanyMoney(auction.seller_id, proceeds);

      // 4. The building transfers to the winner into the reposition queue.
      requeueBuildingFor(auction, winner.company_id);

      db.prepare(`
        UPDATE building_auctions
        SET status = 'settled', winner_id = ?, final_price = ?, seller_proceeds = ?, settled_at = ?
        WHERE id = ? AND status = 'active'
      `).run(winner.company_id, price, proceeds, nowIso(), id);

      return { auctionId: id, sold: true, winnerId: winner.company_id, price, sellerProceeds: proceeds, fee };
    }, { immediate: true }));
  }
  return results;
}

/** Guard used by routes to resolve 'me' path parameters safely. */
export function resolveCompanyIdParam(param: string | undefined, currentCompanyId: number | null): number | null {
  if (param === undefined || param === 'me') return currentCompanyId;
  const value = Number(param);
  return Number.isInteger(value) ? value : null;
}
