/**
 * Issue #82: Collectible Exchange (NFT) HTTP layer.
 *
 * Decompiled endpoints (collectibles.json → nftCollectibleTrading):
 *   GET   /api/v2/market-collectibles/            — listed collectibles (pcr, chunk_kkt.js)
 *   POST  /api/v2/market-collectibles/            — list your collectible for SimBoosts
 *                                                   ({ collectibleId, simboosts }, chunk_uei.js)
 *   PATCH /api/v2/market-collectibles/{id}/       — owner-only delist / re-list / price update
 *   POST  /api/v2/market-collectibles/{id}/buy/   — purchase with SimBoosts (private-server
 *                                                   explicit form of the decompiled PATCH buy)
 *   GET   /api/v2/market-collectibles-sbs/        — SimBoost packs available to non-supporters (Pkt)
 *   GET   /api/v2/nfts/assets/{assetId}/          — NFT metadata (?ipfs=true adds ipfs object)
 *   GET   /api/v2/nfts/assets/{assetId}/trades/   — provenance chain { trades: [...] }
 *   GET   /api/v2/nfts/collectors/                — top collectors ranking (CBt)
 *
 * Browsing is public; every mutation requires a company session. Domain
 * errors map to { error, code } with their DomainError statusCode; unexpected
 * errors fall back to 400 like the other legacy route handlers.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  buyCollectible,
  getAssetTrades,
  getNftAsset,
  getNftCollectors,
  listCollectibleForSale,
  listMarketCollectibles,
  updateCollectibleListing
} from '../game/collectibles.ts';
import { DomainError, UnauthorizedError } from '../errors/domain-error.ts';

function sendDomainError(res: ServerResponse, err: unknown): void {
  if (err instanceof DomainError) {
    sendJson(res, { error: err.message, code: err.code }, err.statusCode);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, { error: message }, 400);
}

function requireCompany(currentCompanyId: number | null): number {
  if (!currentCompanyId) {
    throw new UnauthorizedError('A company session is required to trade collectibles');
  }
  return currentCompanyId;
}

export async function handleCollectibleRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // SimBoost packs available for purchase by non-supporters.
  if (pathname === '/api/v2/market-collectibles-sbs/' || pathname === '/api/v2/market-collectibles-sbs') {
    if (method !== 'GET') {
      sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
      return true;
    }
    sendJson(res, { simboosts: 250, available: 250, simBoostsAvailableForPurchase: 250 });
    return true;
  }

  // Collectible exchange root: list (GET) and list-for-sale (POST).
  if (pathname === '/api/v2/market-collectibles/' || pathname === '/api/v2/market-collectibles') {
    if (method === 'GET') {
      sendJson(res, listMarketCollectibles());
      return true;
    }
    if (method === 'POST') {
      try {
        const companyId = requireCompany(currentCompanyId);
        const body = await readJsonBody<{ collectibleId?: number; simboosts?: number }>(req);
        const listing = listCollectibleForSale(companyId, Number(body.collectibleId), Number(body.simboosts));
        sendJson(res, listing);
      } catch (err: unknown) {
        sendDomainError(res, err);
      }
      return true;
    }
    sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
    return true;
  }

  // Purchase: POST /api/v2/market-collectibles/:id/buy/
  const buyMatch = pathname.match(/^\/api\/v2\/market-collectibles\/(\d+)\/buy\/?$/);
  if (buyMatch && method === 'POST') {
    try {
      const companyId = requireCompany(currentCompanyId);
      const purchase = await buyCollectible(companyId, Number(buyMatch[1]));
      sendJson(res, purchase);
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
    return true;
  }

  // Owner listing management: PATCH /api/v2/market-collectibles/:id/
  const listingMatch = pathname.match(/^\/api\/v2\/market-collectibles\/(\d+)\/?$/);
  if (listingMatch) {
    if (method !== 'PATCH') {
      sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'PATCH' });
      return true;
    }
    try {
      const companyId = requireCompany(currentCompanyId);
      const body = await readJsonBody<{ listed?: boolean; priceSimboosts?: number }>(req).catch(() => ({}) as { listed?: boolean; priceSimboosts?: number });
      const listing = updateCollectibleListing(companyId, Number(listingMatch[1]), {
        listed: body.listed,
        priceSimboosts: body.priceSimboosts === undefined ? undefined : Number(body.priceSimboosts)
      });
      sendJson(res, listing);
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
    return true;
  }

  // NFT asset metadata: GET /api/v2/nfts/assets/:id/ (?ipfs=true adds ipfs object)
  const assetMatch = pathname.match(/^\/api\/v2\/nfts\/assets\/(\d+)\/?$/);
  if (assetMatch && method === 'GET') {
    const asset = getNftAsset(Number(assetMatch[1]));
    if (!asset) {
      sendJson(res, { error: 'Collectible not found', code: 'NOT_FOUND' }, 404);
      return true;
    }
    const payload: Record<string, unknown> = {
      id: asset.id,
      definitionId: asset.definitionId,
      name: asset.name,
      image: asset.image,
      realm: asset.realm,
      rarity: asset.rarity,
      description: asset.description,
      currentOwnerId: asset.currentOwnerId,
      mintedAt: asset.mintedAt
    };
    if (new URL(req.url || '/', 'http://localhost').searchParams.get('ipfs') === 'true') {
      payload.ipfs = { description: asset.description };
    }
    sendJson(res, payload);
    return true;
  }

  // Provenance chain: GET /api/v2/nfts/assets/:id/trades/
  const tradesMatch = pathname.match(/^\/api\/v2\/nfts\/assets\/(\d+)\/trades\/?$/);
  if (tradesMatch && method === 'GET') {
    const asset = getNftAsset(Number(tradesMatch[1]));
    if (!asset) {
      sendJson(res, { error: 'Collectible not found', code: 'NOT_FOUND' }, 404);
      return true;
    }
    sendJson(res, { trades: getAssetTrades(asset.id) });
    return true;
  }

  // Top collectors: GET /api/v2/nfts/collectors/
  if ((pathname === '/api/v2/nfts/collectors/' || pathname === '/api/v2/nfts/collectors') && method === 'GET') {
    sendJson(res, getNftCollectors());
    return true;
  }

  return false;
}
