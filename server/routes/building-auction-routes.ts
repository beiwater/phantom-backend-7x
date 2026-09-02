/**
 * Issue #95: Building Auctions HTTP routes (v2 compatibility adapter).
 *
 * Canonical endpoints (decompiled frontend `L()` api map + real captures):
 *   GET    /api/v2/building-auctions/                                 active auctions
 *   POST   /api/v2/building-auctions/                                 list a building {buildingId}
 *   GET    /api/v2/building-auctions/:id/                             auction detail (numeric id that
 *                                                                     matches an auction) — otherwise the
 *                                                                     id is a realm id: realm listing
 *   POST   /api/v2/building-auctions/:realm/                          list a building {buildingId}
 *   POST   /api/v2/building-auctions/:id/promote/                     promote (30 SimBoosts)
 *   GET    /api/v2/building-auctions/bids/:companyId/                 my sealed bids (owner only)
 *   POST   /api/v2/building-auctions/bids/:companyId/                 place sealed bid {buildingAuctionId, amount}
 *   POST   /api/v2/building-auctions/bids/:auctionId/                 place sealed bid {amount} (canonical form)
 *   DELETE /api/v2/building-auctions/bids/:companyId/:bidId/          withdraw a sealed bid (escrow refund)
 *   GET    /api/v2/building-auctions/active-unlocks/                  purchased research unlocks
 *   GET    /api/v2/building-auctions/research-by-building/:id/        similar auctions research
 *   POST   /api/v2/building-auctions/research-by-auction/:id/         similar auctions research
 *   GET    /api/v2/companies/:id/building-auctions/                   a company's auctions
 *
 * Business rules live in server/game/building-auctions.ts; this adapter only
 * parses requests, resolves 'me' parameters, enforces session-bound access to
 * sealed bid data, and formats responses. Domain errors map to their status
 * codes via sendAuctionError.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { sendDomainError } from '../compatibility/simcompanies/response-helpers.ts';
import { CapabilityError } from '../domain/leveling/level-rules.ts';
import {
  getActiveAuctions,
  getAuctionById,
  getCompanyAuctions,
  getMyBids,
  listBuildingForAuction,
  placeBid,
  withdrawBid,
  promoteAuction,
  getActiveUnlocks,
  getSimilarAuctionsByBuilding,
  getSimilarAuctionsByAuction,
  resolveCompanyIdParam
} from '../game/building-auctions.ts';

function unauthorized(res: ServerResponse): void {
  sendJson(res, { error: 'Unauthorized' }, 401);
}

/**
 * Map domain errors to HTTP. CapabilityError follows the Issue #71 route
 * convention: 403 with the "unlocks at level N" message.
 */
function sendAuctionError(res: ServerResponse, err: unknown): void {
  if (err instanceof CapabilityError) {
    sendJson(res, { error: err.message }, 403);
    return;
  }
  sendDomainError(res, err);
}

function forbidden(res: ServerResponse, message: string = 'Forbidden'): void {
  sendJson(res, { error: message }, 403);
}

export async function handleBuildingAuctionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. Active unlocks (SimBoost research unlocks — none purchasable here yet)
  if (pathname === '/api/v2/building-auctions/active-unlocks/' && method === 'GET') {
    sendJson(res, { activeUnlocks: getActiveUnlocks() });
    return true;
  }

  // 2. Similar-auctions research (by auction: the real client POSTs; by building: GETs)
  const researchByAuction = pathname.match(/^\/api\/v2\/building-auctions\/research-by-auction\/(\d+)\/$/);
  if (researchByAuction && method === 'POST') {
    sendJson(res, { similarBuildingAuctions: getSimilarAuctionsByAuction(Number(researchByAuction[1])) });
    return true;
  }
  const researchByBuilding = pathname.match(/^\/api\/v2\/building-auctions\/research-by-building\/(\d+)\/$/);
  if (researchByBuilding && method === 'GET') {
    sendJson(res, { similarBuildingAuctions: getSimilarAuctionsByBuilding(Number(researchByBuilding[1])) });
    return true;
  }

  // 3. Sealed bids — data is owner-only: sealed amounts must never leak.
  const bidsMatch = pathname.match(/^\/api\/v2\/building-auctions\/bids\/(\d+|me)\/(\d+\/)?$/);
  if (bidsMatch) {
    try {
      const paramCompanyId = resolveCompanyIdParam(bidsMatch[1], currentCompanyId);
      const bidId = bidsMatch[2] ? Number(bidsMatch[2].replace(/\/$/, '')) : null;

      if (method === 'GET') {
        if (!currentCompanyId || paramCompanyId === null) {
          unauthorized(res);
          return true;
        }
        if (paramCompanyId !== currentCompanyId) {
          // Sealed-bid secrecy: only the bidding company sees its own amounts.
          forbidden(res, 'Sealed bids are only visible to the bidding company');
          return true;
        }
        sendJson(res, { bids: getMyBids(currentCompanyId) });
        return true;
      }

      if (method === 'POST') {
        if (!currentCompanyId) {
          unauthorized(res);
          return true;
        }
        const body = await readJsonBody<{ buildingAuctionId?: number; amount?: number }>(req);
        // Canonical form: POST /bids/:auctionId/ {amount}. The original client
        // posts to /bids/:companyId/ {buildingAuctionId, amount} — support both.
        const auctionId = body.buildingAuctionId !== undefined
          ? Number(body.buildingAuctionId)
          : Number(bidsMatch[1]);
        if (body.buildingAuctionId !== undefined && paramCompanyId !== null && paramCompanyId !== currentCompanyId) {
          forbidden(res, 'Bids are placed for the authenticated company');
          return true;
        }
        if (!Number.isFinite(auctionId) || !Number.isFinite(Number(body.amount))) {
          sendJson(res, { error: 'buildingAuctionId and amount are required' }, 400);
          return true;
        }
        sendJson(res, await placeBid(currentCompanyId, auctionId, Number(body.amount)));
        return true;
      }

      if (method === 'DELETE' && bidId !== null) {
        if (!currentCompanyId || paramCompanyId === null) {
          unauthorized(res);
          return true;
        }
        if (paramCompanyId !== currentCompanyId) {
          forbidden(res, 'Bids are withdrawn by the bidding company');
          return true;
        }
        await withdrawBid(currentCompanyId, bidId);
        sendJson(res, { success: true });
        return true;
      }
    } catch (err: unknown) {
      sendAuctionError(res, err);
      return true;
    }
  }

  // 4. Promote (feature) an auction — 30 SimBoosts, owner only
  const promoteMatch = pathname.match(/^\/api\/v2\/building-auctions\/(\d+)\/promote\/?$/);
  if (promoteMatch && method === 'POST') {
    if (!currentCompanyId) {
      unauthorized(res);
      return true;
    }
    try {
      sendJson(res, await promoteAuction(currentCompanyId, Number(promoteMatch[1])));
    } catch (err: unknown) {
      sendAuctionError(res, err);
    }
    return true;
  }

  // 5. Auction house collection: bare path and numeric-id paths.
  if (pathname === '/api/v2/building-auctions/' || pathname === '/api/v2/building-auctions') {
    if (method === 'GET') {
      await settleDueAuctions(Date.now());
      sendJson(res, { buildingAuctions: getActiveAuctions() });
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) {
        unauthorized(res);
        return true;
      }
      try {
        const body = await readJsonBody<{ buildingId?: number }>(req);
        if (!Number.isFinite(Number(body.buildingId))) {
          sendJson(res, { error: 'buildingId is required' }, 400);
          return true;
        }
        sendJson(res, await listBuildingForAuction(currentCompanyId, Number(body.buildingId)));
      } catch (err: unknown) {
        sendAuctionError(res, err);
      }
      return true;
    }
  }

  const auctionMatch = pathname.match(/^\/api\/v2\/building-auctions\/(\d+)\/$/);
  if (auctionMatch) {
    const id = Number(auctionMatch[1]);
    if (method === 'GET') {
      await settleDueAuctions(Date.now());
      const auction = getAuctionById(id);
      const list = getActiveAuctions(id);
      if (id === 0 || id === 1) {
        if (auction) {
          sendJson(res, { ...auction, buildingAuctions: list });
        } else {
          sendJson(res, { buildingAuctions: list });
        }
        return true;
      }
      if (auction) {
        sendJson(res, auction);
      } else {
        sendJson(res, { buildingAuctions: list });
      }
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) {
        unauthorized(res);
        return true;
      }
      try {
        const body = await readJsonBody<{ buildingId?: number }>(req);
        if (!Number.isFinite(Number(body.buildingId))) {
          sendJson(res, { error: 'buildingId is required' }, 400);
          return true;
        }
        sendJson(res, await listBuildingForAuction(currentCompanyId, Number(body.buildingId)));
      } catch (err: unknown) {
        sendAuctionError(res, err);
      }
      return true;
    }
  }

  // 6. A company's auctions (seller profile)
  const companyAuctionsMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/building-auctions\/$/);
  if (companyAuctionsMatch && method === 'GET') {
    const companyId = resolveCompanyIdParam(companyAuctionsMatch[1], currentCompanyId);
    if (companyId === null) {
      unauthorized(res);
      return true;
    }
    sendJson(res, { buildingAuctions: getCompanyAuctions(companyId) });
    return true;
  }

  return false;
}
