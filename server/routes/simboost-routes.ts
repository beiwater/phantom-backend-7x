import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONFIG } from '../config.ts';
import { readJsonBody, sendJson, setPreparsedBody } from './utils.ts';
import { RouteRegistry, globalRouteRegistry, type HttpMethod } from '../http/route-registry.ts';
import {
  getPaymentPackagesList,
  getPaymentPricingInfo,
  getPlayerBonusesList,
  canPurchasePaymentPackage,
  exchangeCashForSimboosts,
  realignProductionSalesBonus,
  getCompanyBonusModifiers,
  exchangeSimBoosts,
  unlockDisplayCaseSlot,
  unlockExecutiveSlot,
  unlockTagSlot,
  unlockBuildingSlot,
  PAYMENT_PACKAGES
} from '../game/simboosts.ts';
import { createGameContext } from '../context/game-context.ts';
import { rushProductionUseCase } from '../application/production/rush-production.ts';
import { rushBuildingConstructionUseCase } from '../application/buildings/rush-construction.ts';
import { productionRepository } from '../repositories/production-repository.ts';
import { getResourceDef } from '../game-data/resources.ts';
import { formatBuilding } from '../game/buildings.ts';
import { getCompanyBoostSettings } from '../game/simboost-settings.ts';
import {
  activateSupporter,
  applySupporterDiscount,
  getCompanyById,
  getSupporterState,
  SUPPORTER_DISCOUNT_PERCENT,
  type SupporterState
} from '../game/company.ts';

/**
 * Issue #97: the package list adapts to the requester's supporter state
 * (decompile payment_packages.json "filtering"):
 *  - supporterOnly packages are only shown to active supporters;
 *  - the supporter package itself is hidden while a term is active and shown
 *    again once it expires, so the player can renew;
 *  - an active supporter's listed SimBoost prices already reflect the 10%
 *    supporter discount (Checkout.supporterDiscountApplied).
 */
function buildPaymentPackagesView(platform: string, companyId: number | null) {
  const list = getPaymentPackagesList(platform);
  // Guests and authenticated non-supporters share the same catalog rules.
  const supporter = getSupporterState(companyId ? getCompanyById(companyId) : null);
  const packages = list.packages
    .filter(p => {
      if (p.supporterOnly && !supporter.supporterActive) return false;
      if (p.isSupporter && supporter.supporterActive) return false;
      return true;
    })
    .map(p => {
      // Discounted SKUs: any package that grants SimBoosts, excluding the
      // supporter package itself and the pre-discounted supporterOnly variants.
      const pkg = PAYMENT_PACKAGES.find(c => c.sku === p.sku);
      if (supporter.supporterActive && pkg && pkg.simBoosts > 0 && !pkg.supporterOnly && !pkg.isSupporter) {
        return {
          ...p,
          price: applySupporterDiscount(p.price),
          approximateCurrency: p.approximateCurrency
            ? { ...p.approximateCurrency, value: applySupporterDiscount(p.approximateCurrency.value) }
            : p.approximateCurrency
        };
      }
      return p;
    });
  return { ...list, packages };
}

/**
 * Issue #97: completing the supporter package purchase must persist the
 * supporter term and award the supporter certificate — normal players become
 * supporters here instead of the old admin-flag conflation.
 *
 * purchasePaymentPackage replays the same cached CompletedPurchase object for
 * double-clicks within its idempotency window; keying the activation on that
 * object identity (WeakMap) inherits exactly that idempotency, so a replayed
 * purchase never extends the term or mints a second certificate.
 */
const supporterActivations = new WeakMap<object, SupporterState>();

async function purchaseWithSupporterState(companyId: number, sku: string, now: number = Date.now()) {
  // The 10% discount applies to the term held BEFORE this purchase: buying
  // the supporter package grants status for future purchases, not retroactively.
  const supporterBefore = getSupporterState(getCompanyById(companyId), now);
  const result = await purchasePaymentPackage(companyId, sku, now);

  if (result.supporter) {
    let activation = supporterActivations.get(result);
    if (!activation) {
      activation = await activateSupporter(companyId, now);
      supporterActivations.set(result, activation);
    }
    return {
      ...result,
      supporterUntil: activation.supporterUntil,
      supporterCertificates: activation.certificates
    };
  }

  // Active supporters see their 10% discount reflected in the echoed price.
  const pkg = PAYMENT_PACKAGES.find(p => p.sku === result.payment.sku);
  if (supporterBefore.supporterActive && pkg && pkg.simBoosts > 0 && !pkg.supporterOnly && !pkg.isSupporter) {
    return {
      ...result,
      payment: { ...result.payment, price: applySupporterDiscount(result.payment.price) },
      supporterDiscountPercent: SUPPORTER_DISCOUNT_PERCENT
    };
  }
  return result;
}

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
    sendJson(res, buildPaymentPackagesView(platform, currentCompanyId));
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

  // Issue #70: PAYMENTS_DISABLED=1 turns every state-changing payment route
  // into an explicit 501 with zero balance mutation (production posture for
  // a server that intentionally does not integrate real payment providers).
  // Default (unset) keeps the P0-03 local-direct-purchase behavior.
  const tronPatchMatch = pathname.match(/^\/api\/v2\/payment-crypto\/tron\/([^\/]+)\/([^\/]+)\/?$/);
  if (CONFIG.PAYMENTS_DISABLED && (
    (method === 'POST' && (
      pathname === '/api/v2/payment/' ||
      pathname === '/api/v2/payment-stripe/' ||
      pathname === '/api/v2/payment-stripe/sync' ||
      pathname === '/api/v2/payment-crypto/tron/' ||
      pathname === '/api/v2/google/purchase/'
    )) ||
    (method === 'PATCH' && tronPatchMatch)
  )) {
    sendJson(res, { error: 'Payments are not configured on this server' }, 501);
    return true;
  }
  if (pathname === '/api/v2/payment/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const body = await readJsonBody<{ sku?: string; nonce?: string; name?: string; bonus?: string }>(req);
      const sku = body.sku || 'sb-sb150';
      const result = await purchaseWithSupporterState(currentCompanyId, sku);
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
      const result = await purchaseWithSupporterState(currentCompanyId, sku);
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

  if (tronPatchMatch && method === 'PATCH') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #70: the completion PATCH must go through the same validated
    // purchase path as every other payment route. The URL carries
    // <purchaseDriver>/<invoiceId>; the package SKU comes from the invoice
    // body created by the tron POST. An unknown SKU is rejected (no fallback
    // package), and the daily cap inside purchasePaymentPackage applies.
    const body = await readJsonBody<{ sku?: string; packageSku?: string }>(req);
    const sku = body.sku || body.packageSku || 'sb-sb330';
    try {
      const result = await purchaseWithSupporterState(currentCompanyId, sku);
      sendJson(res, {
        invoice: {
          id: tronPatchMatch[2],
          datetime: new Date().toISOString()
        },
        payment: {
          sku: result.payment.sku,
          simBoostsPurchased: result.simBoosts,
          simBoostsExtra: 0
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 5e. Google / Device Purchase: /api/v2/google/purchase/
  if (pathname === '/api/v2/google/purchase/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    try {
      const body = await readJsonBody<{ sku?: string }>(req);
      // C-5: the daily purchase cap rejects with an error here; surface it
      // as 400 instead of an unhandled 500.
      const result = await purchaseWithSupporterState(currentCompanyId, body.sku || 'sb-sb150');
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
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
      const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
      const result = await rushProductionUseCase(ctx, { buildingId, queueId: queueId ?? null });
      const queueEntities = productionRepository.findActiveByBuilding(buildingId, currentCompanyId);
      const queue = queueEntities.map(q => {
        const res = getResourceDef(q.kind);
        return {
          id: q.id,
          kind: q.kind,
          amount: q.amount,
          duration: q.durationSeconds,
          started: q.startedAt,
          finishes: q.finishesAt,
          resource: res ? { name: `Resource #${q.kind}`, image: res.image } : null
        };
      });
      sendJson(res, {
        success: true,
        message: 'Production completed instantly!',
        simBoosts: result.simboostsRemaining,
        building: formatBuilding({
          id: result.building.id,
          company_id: result.building.companyId,
          position: result.building.position,
          kind: result.building.kind,
          size: result.building.size,
          name: result.building.name,
          cost: result.building.cost,
          category: result.building.category,
          created_at: '',
          busy_until: result.building.busyUntil
        }),
        queue
      });
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
      const ctx = createGameContext(currentCompanyId, currentCompanyId, 0);
      const result = await rushBuildingConstructionUseCase(ctx, { buildingId });
      sendJson(res, {
        success: true,
        message: 'Construction rushed successfully',
        simBoosts: result.simboostsRemaining,
        building: formatBuilding({
          id: result.building.id,
          company_id: result.building.companyId,
          position: result.building.position,
          kind: result.building.kind,
          size: result.building.size,
          name: result.building.name,
          cost: result.building.cost,
          category: result.building.category,
          created_at: '',
          busy_until: result.building.busyUntil
        })
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}

export function registerSimboostRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const register = (method: HttpMethod, pattern: string): void => {
    registry.register({
      method,
      pattern,
      owner: 'simboost',
      handler: async (req, res, ctx, _params, body) => {
        if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
          setPreparsedBody(req, body);
        }
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        await handleSimboostRoutes(req, res, pathname, method, ctx?.playerId ?? null, ctx?.companyId ?? null);
      }
    });
  };

  register('GET', '/api/v4/payment-packages/:type/');
  register('GET', '/api/v2/payment-pricing/');
  register('GET', '/api/v2/players/bonuses/');
  register('GET', '/api/v2/player-bonuses/');
  register('POST', '/api/v2/companies/me/bonus/');
  register('POST', '/api/v2/no-cache/companies/level-bonus/:companyId/');
  register('POST', '/api/v2/unlock/');
  register('POST', '/api/v2/companies/me/building-slots/');
  register('POST', '/api/v2/companies/me/slots/');
  register('GET', '/api/v2/payment/can-purchase/:sku/');
  register('POST', '/api/v2/payment/');
  register('POST', '/api/v2/payment-stripe/');
  register('POST', '/api/v2/payment-stripe/sync');
  register('POST', '/api/v2/payment-crypto/tron/');
  register('PATCH', '/api/v2/payment-crypto/tron/:driver/:invoiceId/');
  register('POST', '/api/v2/google/purchase/');
  register('POST', '/api/v2/pa-action/fair/:offer/');
  register('POST', '/api/v2/simboosts/exchange/');
  register('POST', '/api/v2/companies/me/simboosts/exchange/');
  register('POST', '/api/v2/exchange/');
  register('PATCH', '/api/v2/companies/me/display-case/');
  register('PATCH', '/api/v2/companies/:companyId/display-case/');
  register('PATCH', '/api/v2/companies/me/executive-slots/');
  register('POST', '/api/v2/companies/me/executive-slots/');
  register('PATCH', '/api/v1/companies/me/executive-slots/');
  register('POST', '/api/v1/companies/me/executive-slots/');
  register('POST', '/api/v2/companies/me/tags/');
  register('POST', '/api/v2/companies/buildings/:buildingId/rush/');
  register('POST', '/api/v2/companies/buildings/:buildingId/queue/:queueId/rush/');
  register('POST', '/api/v2/companies/buildings/:buildingId/construction-rush/');
}

registerSimboostRoutes(globalRouteRegistry);
