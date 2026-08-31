import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
 import {
   getPaymentPackagesList,
   getPaymentPricingInfo,
   getPlayerBonusesList,
   canPurchasePaymentPackage,
   purchasePaymentPackage,
  exchangeCashForSimboosts,
  realignProductionSalesBonus,
  getCompanyBonusModifiers,
   exchangeSimBoosts,
   unlockDisplayCaseSlot,
   unlockExecutiveSlot,
   unlockTagSlot,
   unlockBuildingSlot,
   rushProduction,
   rushBuildingUpgradeOrConstruction
 } from '../game/simboosts.ts';
import { getCompanyBoostSettings } from '../game/simboost-settings.ts';
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
  // Realign Production/Sales bonus: POST /api/v2/companies/me/bonus/
  // P1-02: the move must be persisted (company_boost_settings) and debited in
  // SimBoosts atomically; response echoes the saved modifiers so the client
  // store and a later refresh agree.
  if (pathname === '/api/v2/companies/me/bonus/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const body = await readJsonBody<{ production?: number }>(req);
      const requested = Math.max(-3, Math.min(3, Number(body.production || 0)));
      const current = getCompanyBonusModifiers(currentCompanyId);
      // Client posts the target production modifier: move = target - current.
      const move = requested - current.productionModifier;
      const result = await realignProductionSalesBonus(currentCompanyId, move);
      sendJson(res, {
        productionModifier: result.productionModifier,
        salesModifier: result.salesModifier,
        cost: result.cost
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }
  const levelBonusMatch = pathname.match(/^\/api\/v2\/no-cache\/companies\/level-bonus\/(\d+|me)\/?$/);
  if (levelBonusMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ specialization?: string }>(req);
    const isProd = body?.specialization === 'production';
    sendJson(res, {
      success: true,
      specialization: isProd ? 'production' : 'sales',
      productionModifier: isProd ? 1 : 0,
      salesModifier: isProd ? 0 : 1
    });
    return true;
  }


  // Building slot unlock: POST /api/v2/unlock/ or /api/v2/companies/me/building-slots/
  if ((pathname === '/api/v2/unlock/' || pathname === '/api/v2/companies/me/building-slots/' || pathname === '/api/v2/companies/me/slots/') && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const result = await unlockBuildingSlot(currentCompanyId);
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
    const sku = canPurchaseMatch[1];
    sendJson(res, canPurchasePaymentPackage(sku));
    return true;
  }

  // 5. Payment Checkout: /api/v2/payment/
  if (pathname === '/api/v2/payment/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const body = await readJsonBody<{ sku?: string; nonce?: string; name?: string; bonus?: string }>(req);
      const sku = body.sku || 'sb-sb150';
      const result = await purchasePaymentPackage(currentCompanyId, sku);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 5b. Stripe Checkout: POST /api/v2/payment-stripe/
  // Official flow returns a Stripe clientSecret and the client completes the
  // payment on Stripe's servers. The private server has no Stripe backend, so
  // the purchase completes locally right here: SimBoosts are granted inside a
  // transaction and a well-formed clientSecret is returned so the frontend
  // Stripe Elements flow finishes without contacting the real gateway.
  if (pathname === '/api/v2/payment-stripe/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const body = await readJsonBody<{ sku?: string }>(req);
      const sku = body.sku || 'sb-sb150';
      const result = await purchasePaymentPackage(currentCompanyId, sku);
      sendJson(res, {
        clientSecret: `pi_local_${Date.now()}_secret_${Math.random().toString(36).slice(2)}`,
        ...result
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 5c. Stripe Sync / Completion: POST /api/v2/payment-stripe/sync?session_id=X
  // Called by /checkout/stripe/process/ with the session id. The grant already
  // happened in 5b; this endpoint must NOT grant a second package (that was
  // the original P0-03 bug). It only confirms completion so the frontend shows
  // the success screen. receiptUrl matches the official redirect target.
  if (pathname === '/api/v2/payment-stripe/sync' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    await readJsonBody<{ sessionId?: string }>(req);
    sendJson(res, {
      receiptUrl: '/zh-cn/landscape/',
      message: 'Your transaction has been processed. Thanks for your support!'
    });
    return true;
  }
  // 5d. Tron Crypto Payment: /api/v2/payment-crypto/tron/
  if (pathname === '/api/v2/payment-crypto/tron/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ packageSku?: string }>(req);
    const sku = body.packageSku || 'sb-sb150';
    const id = `tron_${Date.now()}`;
    sendJson(res, {
      invoice: {
        id,
        datetime: new Date().toISOString(),
        address: 'TYDzsYUE22w6j1v929xY8w8jT5aYQvL32',
        amount: '10',
        currency: 'USDT',
        packageSku: sku
      },
      payment: null
    });
    return true;
  }

  const tronPatchMatch = pathname.match(/^\/api\/v2\/payment-crypto\/tron\/([^\/]+)\/([^\/]+)\/?$/);
  if (tronPatchMatch && method === 'PATCH') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const result = await purchasePaymentPackage(currentCompanyId, 'sb-sb330');
    sendJson(res, {
      invoice: {
        id: tronPatchMatch[1],
        datetime: new Date().toISOString()
      },
      payment: {
        sku: 'sb-sb330',
        simBoostsPurchased: result.simBoosts,
        simBoostsExtra: 0
      }
    });
    return true;
  }

  // 5e. Google / Device Purchase: /api/v2/google/purchase/
  if (pathname === '/api/v2/google/purchase/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ sku?: string }>(req);
    const result = await purchasePaymentPackage(currentCompanyId, body.sku || 'sb-sb150');
    sendJson(res, result);
    return true;
  }

  // 5f. Personal Assistant fair exchange: POST /api/v2/pa-action/fair/:n/
  // Official response: 200 {"done": true}. `n` selects the PA offer (0/1 =
  // resource deliveries, 2+ = joke reply); the private server completes the
  // cash-for-SimBoosts exchange locally at the official 250:1 rate with the
  // daily exchange limit, atomically and idempotently (P0-04).
  const paFairMatch = pathname.match(/^\/api\/v2\/pa-action\/fair\/([a-zA-Z0-9_-]+)\/$/);
  if (paFairMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const result = await exchangeCashForSimboosts(currentCompanyId, 10000);
      sendJson(res, { done: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
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
      const result = await exchangeSimBoosts(currentCompanyId, amount);
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
      const result = await unlockDisplayCaseSlot(currentCompanyId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 9. Executive Slot Unlock: PATCH / POST /api/v2/companies/me/executive-slots/
  if ((pathname === '/api/v2/companies/me/executive-slots/' || pathname === '/api/v1/companies/me/executive-slots/') && (method === 'PATCH' || method === 'POST')) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const result = await unlockExecutiveSlot(currentCompanyId);
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
      const result = await unlockTagSlot(currentCompanyId);
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
      const result = await rushProduction(currentCompanyId, buildingId, queueId);
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
      const result = await rushBuildingUpgradeOrConstruction(currentCompanyId, buildingId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
