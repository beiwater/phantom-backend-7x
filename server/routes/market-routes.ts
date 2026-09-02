/**
 * Market routes (Issue #105 Phase 3 / Issue #104 Stage 2).
 * Protocol layer only: parse HTTP, resolve the authenticated GameContext,
 * dispatch to application/market use cases (mutations) or repository-backed
 * read services (queries), and map to frontend compatibility DTOs.
 * No SQL, no business rules here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { createGameContext } from '../context/game-context.ts';
import { sendDomainError } from '../compatibility/simcompanies/response-helpers.ts';
import { formatMarketOrder } from '../compatibility/simcompanies/market-dto.ts';
import { placeBuyOrder, cancelBuyOrder, sellToBids, listOwnBuyOrders, listBidBook } from '../application/market/buy-orders.ts';
import { placeMarketOrder } from '../application/market/place-order.ts';
import { takeMarketOrder } from '../application/market/take-order.ts';
import { cancelMarketOrder } from '../application/market/cancel-order.ts';
import { marketRepository, marketTradeRepository } from '../repositories/market-repository.ts';
import { getAllResourceDefs } from '../game-data/resources.ts';

// --- Read services (queries; pure reads, no mutation) -----------------------

function getMarketTicker(realmId: number) {
  const tickerList: Array<{ kind: number; image: string; price: number; is_up: boolean; realmId: number }> = [];

  for (const [kindStr, def] of Object.entries(getAllResourceDefs())) {
    const kind = Number(kindStr);
    if (def.isExchangeTradable === false) continue;

    const price = marketRepository.findLowestActivePrice(kind, realmId) ?? 1.0;

    tickerList.push({
      kind,
      image: def.image,
      price,
      is_up: true,
      realmId
    });
  }
  return tickerList;
}

export async function handleMarketRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. Recent resources
  if (pathname.startsWith('/api/') && pathname.includes('/recent-resources/')) {
    sendJson(res, {
      resources: [{ kind: 1 }, { kind: 2 }, { kind: 3 }, { kind: 13 }, { kind: 66 }]
    });
    return true;
  }

  // 2. Market ticker (v2 & v3)
  const marketTickerMatch = pathname.match(/^\/api\/v[23]\/market-ticker\/(?:(\d+)\/?)?$/);
  if (marketTickerMatch) {
    const realmId = marketTickerMatch[1] !== undefined ? Number(marketTickerMatch[1]) : 0;
    sendJson(res, getMarketTicker(realmId));
    return true;
  }

  // 3. Market limits: /api/v2/market/limits/:realm/:kind/:quality/
  const marketLimitsMatch = pathname.match(/^\/api\/v2\/market\/limits\/(\d+)\/(\d+)\/(\d+)\/$/);
  if (marketLimitsMatch) {
    const kind = Number(marketLimitsMatch[2]);
    sendJson(res, {
      minPrice: 0.5,
      maxPrice: 5000,
      feePercentage: 0.04,
      resourceKind: kind
    });
    return true;
  }

  // 4. Market buy orders: /api/v3/market/buy/:realm/:kind/
  const marketBuyOrdersMatch = pathname.match(/^\/api\/v3\/market\/buy\/(\d+)\/(\d+)\/$/);
  if (marketBuyOrdersMatch) {
    const realmId = Number(marketBuyOrdersMatch[1]);
    const resourceId = Number(marketBuyOrdersMatch[2]);
    sendJson(res, marketRepository.findActiveSellOrdersForBook(realmId, resourceId).map(formatMarketOrder));
    return true;
  }

  // 5. Market collectibles & NFT endpoints (Issue #82) live in
  //    routes/collectible-routes.ts.

  // 6. Market orderbook for resource
  const marketListMatch = pathname.match(/^\/api\/v3\/market\/(\d+)\/(\d+)\/$/);
  if (marketListMatch) {
    const realmId = Number(marketListMatch[1]);
    const resourceId = Number(marketListMatch[2]);
    sendJson(res, marketRepository.findActiveSellOrdersForBook(realmId, resourceId).map(formatMarketOrder));
    return true;
  }

  // 7. Market orderbook all quality tiers
  const allMarketListMatch = pathname.match(/^\/api\/v3\/market\/all\/(\d+)\/(\d+)\/$/);
  if (allMarketListMatch) {
    const realmId = Number(allMarketListMatch[1]);
    const resourceId = Number(allMarketListMatch[2]);
    sendJson(res, marketRepository.findActiveSellOrdersForBook(realmId, resourceId).map(formatMarketOrder));
    return true;
  }

  // 8. Company's own market orders
  const companyMarketOrdersMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/market-orders\/$/);
  if (companyMarketOrdersMatch) {
    const requestedCompanyId = companyMarketOrdersMatch[1] === 'me'
      ? currentCompanyId
      : Number(companyMarketOrdersMatch[1]);
    if (!currentCompanyId || !requestedCompanyId || requestedCompanyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, marketRepository.findActiveBySeller(currentCompanyId).map(formatMarketOrder));
    return true;
  }

  // 9. Company's own market buy orders
  const companyBuyOrdersMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/market-buy-orders\/$/);
  if (companyBuyOrdersMatch && method === 'GET') {
    const requestedCompanyId = companyBuyOrdersMatch[1] === 'me'
      ? currentCompanyId
      : Number(companyBuyOrdersMatch[1]);
    if (!currentCompanyId || !requestedCompanyId || requestedCompanyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #171: the original client reads `data.buyOrders` off this
    // response and renders items as {kind, minQuality, amount, price};
    // a bare array left warehouse stats in a perpetual loading state.
    sendJson(res, {
      buyOrders: listOwnBuyOrders(requestedCompanyId).map(order => ({
        id: order.id,
        kind: order.kind,
        minQuality: order.quality,
        amount: order.quantity,
        price: order.price
      }))
    });
    return true;
  }

  // 9b. Place buy order (bid) — POST /api/v2/market-order/buy/
  if (pathname === '/api/v2/market-order/buy/' || pathname === '/api/v2/market-order/buy') {
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ kind: number; price: number; quantity: number; quality?: number }>(req);
      try {
        const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
        const result = await placeBuyOrder(ctx, body);
        sendJson(res, result);
      } catch (err: unknown) {
        sendDomainError(res, err);
      }
      return true;
    }
  }

  // 9c. Cancel buy order — DELETE /api/v2/market-order/buy/:id/
  const buyCancelMatch = pathname.match(/^\/api\/v2\/market-order\/buy\/(\d+)\/?$/);
  if (buyCancelMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
      const result = await cancelBuyOrder(ctx, Number(buyCancelMatch[1]));
      sendJson(res, result);
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
    return true;
  }

  // 9d. Sell to bid — POST /api/v2/market-order/sell-to-bid/
  if (pathname === '/api/v2/market-order/sell-to-bid/' || pathname === '/api/v2/market-order/sell-to-bid') {
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ resource: number; quantity: number; quality?: number; minPrice?: number }>(req);
      try {
        const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
        const result = await sellToBids(ctx, body);
        sendJson(res, result);
      } catch (err: unknown) {
        sendDomainError(res, err);
      }
      return true;
    }
  }

  // 9e. Bid book — GET /api/v3/market/bids/:realm/:kind/:quality/
  const bidBookMatch = pathname.match(/^\/api\/v3\/market\/bids\/(\d+)\/(\d+)\/(\d+)\/$/);
  if (bidBookMatch && method === 'GET') {
    const resourceId = Number(bidBookMatch[2]);
    const quality = Number(bidBookMatch[3]);
    sendJson(res, listBidBook(resourceId, quality, currentCompanyId));
    return true;
  }

  // 10. Post market order — PlaceMarketOrder command
  if (pathname === '/api/v2/market-order/' || pathname === '/api/v2/market-order') {
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ resourceId?: number; kind: number; price: number; quantity: number; quality?: number }>(req);
      try {
        const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
        const result = await placeMarketOrder(ctx, body);
        sendJson(res, result);
      } catch (err: unknown) {
        sendDomainError(res, err);
      }
      return true;
    }
  }

  // 11. Take market order — TakeMarketOrder command
  if (pathname === '/api/v2/market-order/take/' || pathname === '/api/v2/market-order/take') {
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ resource: number; quantity: number; quality?: number; maxPrice: number; money?: number }>(req);
      try {
        const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
        const result = await takeMarketOrder(ctx, body);
        sendJson(res, result);
      } catch (err: unknown) {
        sendDomainError(res, err);
      }
      return true;
    }
  }

  // 12. Cancel market order — CancelMarketOrder command
  const marketOrderCancelMatch = pathname.match(/^\/api\/v2\/market-order\/(\d+)\/?$/);
  if (marketOrderCancelMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const orderId = Number(marketOrderCancelMatch[1]);
    try {
      const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
      const result = await cancelMarketOrder(ctx, { orderId });
      sendJson(res, result);
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
    return true;
  }

  // 13. VWAP reference prices: /api/v2/market/reference-prices/:realm/
  // Issue #100: daily VWAP per resource+quality from the market_trades
  // ledger. The exchange book is global in this private server, so the
  // realm segment is accepted for API-shape compatibility but prices are
  // exchange-wide.
  const referencePricesMatch = pathname.match(/^\/api\/v2\/market\/reference-prices\/(?:(\d+)\/?)?$/);
  if (referencePricesMatch) {
    sendJson(res, getMarketReferencePrices());
    return true;
  }

  return false;
}

// --- VWAP reference price read service (Issue #100) --------------------------
// Thin query delegate: aggregation lives in marketTradeRepository.

function getMarketReferencePrices() {
  return { referencePrices: marketTradeRepository.findDailyReferencePrices() };
}
