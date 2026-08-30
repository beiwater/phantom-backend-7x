import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getBondsOwned,
  getBondsSold,
  getBondMarketListings,
  issueBonds,
  buyBonds,
  callBonds
} from '../game/bonds.ts';

export async function handleBondRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Bonds owned
  const ownedMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/bonds\/owned\/$/);
  if (ownedMatch) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    sendJson(res, getBondsOwned(effectiveCompanyId));
    return true;
  }

  // Bonds sold
  const soldMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/bonds\/sold\/$/);
  if (soldMatch) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    sendJson(res, getBondsSold(effectiveCompanyId));
    return true;
  }

  // Bonds market list
  if (pathname === '/api/v2/market/bonds/' || pathname === '/api/bonds/') {
    sendJson(res, getBondMarketListings());
    return true;
  }

  // Issue bonds
  if (pathname === '/api/v2/bonds/sell/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ amount: number; interest?: number }>(req);
    try {
      const result = issueBonds(currentCompanyId, body.amount || 5000, body.interest || 0.005);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Buy bond
  const buyMatch = pathname.match(/^\/api\/v2\/bonds\/(\d+)\/buy\/$/);
  if (buyMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const bondId = Number(buyMatch[1]);
    try {
      const result = buyBonds(currentCompanyId, bondId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Call bond early
  const callMatch = pathname.match(/^\/api\/v2\/bonds\/(\d+)\/call\/$/);
  if (callMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const bondId = Number(callMatch[1]);
    try {
      const result = callBonds(currentCompanyId, bondId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
