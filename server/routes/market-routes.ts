import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getMarketTicker,
  getMarketOrdersForResource,
  getCompanyMarketOrders,
  postMarketOrder,
  takeMarketOrder,
  cancelMarketOrder
} from '../game/market.ts';

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
      feePercentage: 0.03,
      resourceKind: kind
    });
    return true;
  }

  // 4. Market buy orders: /api/v3/market/buy/:realm/:kind/
  const marketBuyOrdersMatch = pathname.match(/^\/api\/v3\/market\/buy\/(\d+)\/(\d+)\/$/);
  if (marketBuyOrdersMatch) {
    const realmId = Number(marketBuyOrdersMatch[1]);
    const resourceId = Number(marketBuyOrdersMatch[2]);
    sendJson(res, getMarketOrdersForResource(realmId, resourceId));
    return true;
  }

  // 5. Market collectibles & SimBoosts available: /api/v2/market-collectibles/, /api/v2/market-collectibles-sbs/
  if (pathname === '/api/v2/market-collectibles-sbs/') {
    sendJson(res, { simboosts: 250, available: 250, simBoostsAvailableForPurchase: 250 });
    return true;
  }
  if (pathname === '/api/v2/market-collectibles/') {
    sendJson(res, [
      {
        id: 1,
        priceSimboosts: 50,
        asset: {
          id: 1,
          name: 'Golden Founder Trophy',
          image: '/static/images/collectibles/trophy_gold.png',
          currentOwnerId: 999901,
          description: 'Founder Trophy'
        }
      },
      {
        id: 2,
        priceSimboosts: 100,
        asset: {
          id: 2,
          name: 'Silver Builder Cup',
          image: '/static/images/collectibles/trophy_silver.png',
          currentOwnerId: 999901,
          description: 'Builder Cup'
        }
      }
    ]);
    return true;
  }
  if (pathname === '/api/v2/nfts/collectors/') {
    sendJson(res, []);
    return true;
  }

  // 6. Market orderbook for resource
  const marketListMatch = pathname.match(/^\/api\/v3\/market\/(\d+)\/(\d+)\/$/);
  if (marketListMatch) {
    const realmId = Number(marketListMatch[1]);
    const resourceId = Number(marketListMatch[2]);
    sendJson(res, getMarketOrdersForResource(realmId, resourceId));
    return true;
  }

  // 7. Market orderbook all quality tiers
  const allMarketListMatch = pathname.match(/^\/api\/v3\/market\/all\/(\d+)\/(\d+)\/$/);
  if (allMarketListMatch) {
    const realmId = Number(allMarketListMatch[1]);
    const resourceId = Number(allMarketListMatch[2]);
    sendJson(res, getMarketOrdersForResource(realmId, resourceId));
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
    sendJson(res, getCompanyMarketOrders(currentCompanyId));
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
    sendJson(res, []);
    return true;
  }

  // 10. Post market order
  if (pathname === '/api/v2/market-order/' || pathname === '/api/v2/market-order') {
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ resourceId?: number; kind: number; price: number; quantity: number; quality?: number }>(req);
      try {
        const result = postMarketOrder(currentCompanyId, body);
        sendJson(res, result);
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err) {
          const domainErr = err as { message: string; code: string; statusCode?: number };
          sendJson(res, { error: domainErr.message, code: domainErr.code }, domainErr.statusCode || 400);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, { error: msg }, 400);
        }
      }
      return true;
    }
  }

  // 11. Take market order
  if (pathname === '/api/v2/market-order/take/' || pathname === '/api/v2/market-order/take') {
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ resource: number; quantity: number; quality?: number; maxPrice: number; money?: number }>(req);
      try {
        const result = takeMarketOrder(currentCompanyId, body);
        sendJson(res, result);
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err) {
          const domainErr = err as { message: string; code: string; statusCode?: number };
          sendJson(res, { error: domainErr.message, code: domainErr.code }, domainErr.statusCode || 400);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, { error: msg }, 400);
        }
      }
      return true;
    }
  }

  // 12. Cancel market order
  const marketOrderCancelMatch = pathname.match(/^\/api\/v2\/market-order\/(\d+)\/?$/);
  if (marketOrderCancelMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const orderId = Number(marketOrderCancelMatch[1]);
    try {
      const result = cancelMarketOrder(currentCompanyId, orderId);
      sendJson(res, result);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err) {
        const domainErr = err as { message: string; code: string; statusCode?: number };
        sendJson(res, { error: domainErr.message, code: domainErr.code }, domainErr.statusCode || 400);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
    }
    return true;
  }

  return false;
}
