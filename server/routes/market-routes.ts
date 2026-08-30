import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getMarketTicker,
  getMarketOrdersForResource,
  getCompanyMarketOrders,
  postMarketOrder,
  takeMarketOrder
} from '../game/market.ts';

export async function handleMarketRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  if (pathname.includes('/recent-resources/')) {
    sendJson(res, {
      resources: [{ kind: 1 }, { kind: 2 }, { kind: 3 }, { kind: 13 }, { kind: 66 }]
    });
    return true;
  }

  const marketTickerMatch = pathname.match(/^\/api\/v3\/market-ticker\/(\d+)\/$/);
  if (marketTickerMatch) {
    const realmId = Number(marketTickerMatch[1]);
    sendJson(res, getMarketTicker(realmId));
    return true;
  }

  const marketListMatch = pathname.match(/^\/api\/v3\/market\/(\d+)\/(\d+)\/$/);
  if (marketListMatch) {
    const realmId = Number(marketListMatch[1]);
    const resourceId = Number(marketListMatch[2]);
    sendJson(res, getMarketOrdersForResource(realmId, resourceId));
    return true;
  }

  const companyMarketOrdersMatch = pathname.match(/^\/api\/v2\/companies\/(\d+)\/market-orders\/$/);
  if (companyMarketOrdersMatch) {
    const compId = Number(companyMarketOrdersMatch[1]);
    sendJson(res, getCompanyMarketOrders(compId));
    return true;
  }

  if (pathname === '/api/v2/market-order/') {
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
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  if (pathname === '/api/v2/market-order/take/') {
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
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  return false;
}
