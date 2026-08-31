import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getPaymentPackagesList,
  getPaymentPricingInfo,
  getPlayerBonusesList,
  exchangeSimBoosts,
  unlockDisplayCaseSlot,
  unlockExecutiveSlot,
  unlockTagSlot,
  unlockBuildingSlot,
  rushProduction,
  rushBuildingUpgradeOrConstruction
} from '../game/simboosts.ts';

export async function handleSimboostRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. Payment Packages: /api/v4/payment-packages/:type/
  const packagesMatch = pathname.match(/^\/api\/v4\/payment-packages\/([a-zA-Z0-9_-]+)\/$/);
  if (packagesMatch && method === 'GET') {
    const platform = packagesMatch[1] || 'web';
    sendJson(res, getPaymentPackagesList(platform));
    return true;
  }

  // 2. Payment Pricing: /api/v2/payment-pricing/
  if (pathname === '/api/v2/payment-pricing/' && method === 'GET') {
    sendJson(res, getPaymentPricingInfo());
    return true;
  }

  // 3. Player Bonuses: /api/v2/players/bonuses/ or /api/v2/player-bonuses/
  if ((pathname === '/api/v2/players/bonuses/' || pathname === '/api/v2/player-bonuses/') && method === 'GET') {
    sendJson(res, currentPlayerId ? getPlayerBonusesList(currentPlayerId) : []);
    return true;
  }

  // Building slot unlock: POST /api/v2/unlock/
  if (pathname === '/api/v2/unlock/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const result = unlockBuildingSlot(currentCompanyId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 4. Can Purchase Check: /api/v2/payment/can-purchase/:sku/
  const canPurchaseMatch = pathname.match(/^\/api\/v2\/payment\/can-purchase\/([a-zA-Z0-9_-]+)\/$/);
  if (canPurchaseMatch && method === 'GET') {
    sendJson(res, { canPurchase: false, available: false, reason: 'Payment provider is not configured' });
    return true;
  }

  // 5. Payment Checkout: /api/v2/payment/ or /api/v2/payment-stripe/
  if ((pathname === '/api/v2/payment/' || pathname === '/api/v2/payment-stripe/') && method === 'POST') {
    sendJson(res, { error: 'Payment provider is not configured', code: 'API_NOT_IMPLEMENTED' }, 501);
    return true;
  }

  if (pathname === '/api/v2/payment-stripe/sync' && method === 'POST') {
    sendJson(res, { error: 'Payment provider is not configured', code: 'API_NOT_IMPLEMENTED' }, 501);
    return true;
  }

  // 7. SimBoosts Exchange: /api/v2/simboosts/exchange/ or /api/v2/companies/me/simboosts/exchange/ or /api/v2/exchange/
  if (
    (pathname === '/api/v2/simboosts/exchange/' ||
     pathname === '/api/v2/companies/me/simboosts/exchange/' ||
     pathname === '/api/v2/exchange/') &&
    method === 'POST'
  ) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const body = await readJsonBody<{ amount?: number; simBoosts?: number }>(req);
      const amount = body.amount ?? body.simBoosts ?? 10;
      const result = exchangeSimBoosts(currentCompanyId, amount);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 8. Display Case Slot Unlock: PATCH /api/v2/companies/me/display-case/ or /api/v2/companies/:id/display-case/
  if (
    (pathname === '/api/v2/companies/me/display-case/' ||
     pathname.match(/^\/api\/v2\/companies\/\d+\/display-case\/$/)) &&
    method === 'PATCH'
  ) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const result = unlockDisplayCaseSlot(currentCompanyId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 9. Executive Slot Unlock: PATCH /api/v2/companies/me/executive-slots/
  if (pathname === '/api/v2/companies/me/executive-slots/' && method === 'PATCH') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const result = unlockExecutiveSlot(currentCompanyId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 10. Tag Slot Unlock: POST /api/v2/companies/me/tags/
  if (pathname === '/api/v2/companies/me/tags/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const result = unlockTagSlot(currentCompanyId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 11. Rush Production: POST /api/v2/companies/buildings/:id/rush/ or /api/v2/companies/buildings/:id/queue/:queueId/rush/
  const rushQueueMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/queue\/(\d+)\/rush\/$/) ||
                         pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/rush\/$/);
  if (rushQueueMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const buildingId = Number(rushQueueMatch[1]);
    const queueId = rushQueueMatch[2] ? Number(rushQueueMatch[2]) : undefined;
    try {
      const result = rushProduction(currentCompanyId, buildingId, queueId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 12. Rush Construction / Upgrade: POST /api/v2/companies/buildings/:id/construction-rush/
  const rushConstructMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/construction-rush\/$/);
  if (rushConstructMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const buildingId = Number(rushConstructMatch[1]);
    try {
      const result = rushBuildingUpgradeOrConstruction(currentCompanyId, buildingId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
