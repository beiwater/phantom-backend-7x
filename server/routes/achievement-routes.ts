import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { DomainError } from '../errors/domain-error.ts';
import { getCompanyCollectibles } from '../game/collectibles.ts';
import { getGovernmentOrders, getGovernmentTier } from '../game/government.ts';
import {
  getIndividualAchievements,
  getAchievementsOverview,
  claimAchievement,
  getDisplayCase,
  updateDisplayCase,
  removeDisplayCaseSlot,
  getCertificates
} from '../game/achievements.ts';
import {
  BASKET_KINDS,
  SIMBOOSTS_OPTIONS,
  claimBasket,
  deleteReceived,
  getDraft,
  listOutgoing,
  listReceived,
  saveDraft,
  sendBasket,
  updateOutgoingMessage
} from '../game-data/gift-baskets.ts';

/** Issue #88: DomainError carries an authoritative status + machine code. */
function sendDomainError(res: ServerResponse, err: unknown): void {
  if (err instanceof DomainError) {
    sendJson(res, { error: err.message, code: err.code }, err.statusCode);
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  sendJson(res, { error: msg }, 400);
}

export async function handleAchievementRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {

  // 1. Claim individual achievement: DELETE /api/v2/no-cache/companies/achievements/:id/ or /api/v2/companies/achievements/:id/
  const claimAchMatch = pathname.match(/^\/api\/v2\/(?:no-cache\/)?companies\/achievements\/([^/]+)\/$/);
  if (claimAchMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const achId = claimAchMatch[1];
    try {
      const result = claimAchievement(currentCompanyId, achId);
      sendJson(res, result);
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
    return true;
  }

  // 2. Individual achievements list for toast / collection modal
  const individualAchMatch = pathname.match(/^\/api\/v2\/no-cache\/companies\/(\d+|me)\/achievements\/$/);
  if (individualAchMatch && method === 'GET') {
    const companyId = individualAchMatch[1] === 'me' ? currentCompanyId : Number(individualAchMatch[1]);
    if (!companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getIndividualAchievements(companyId));
    return true;
  }

  // 3. Achievements overview (Summary list of categories & stars for achievements page)
  const overviewAchMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/achievements\/$/);
  if (overviewAchMatch && method === 'GET') {
    const companyId = overviewAchMatch[1] === 'me' ? currentCompanyId : Number(overviewAchMatch[1]);
    if (!companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getAchievementsOverview(companyId));
    return true;
  }

  // 4. Sync 3rd party achievements (Steam/Xbox/PSN binding — private server
  // has no external platform accounts; authoritative empty task list).
  if (pathname.startsWith('/api/') && pathname.includes('/achievements/sync-3rd-party/')) {
    sendJson(res, { tasks: [] });
    return true;
  }

  // 4b. Gift baskets (official 2/end gift economy, decompile-backed).
  const basketDraftMatch = pathname.match(/^\/api\/v1\/gift-baskets\/(\d+|me)\/draft\/?$/);
  if (basketDraftMatch && (method === 'GET' || method === 'PATCH')) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const year = new Date().getFullYear();
    if (method === 'GET') {
      sendJson(res, getDraft(currentCompanyId, year));
      return true;
    }
    const body = await readJsonBody(req);
    sendJson(res, saveDraft(currentCompanyId, year, body as Record<string, unknown>));
    return true;
  }

  const basketOutgoingMatch = pathname.match(/^\/api\/v2\/gift-baskets\/(\d+|me)\/outgoing\/(\d{4})\/?$/);
  if (basketOutgoingMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const year = Number(basketOutgoingMatch[2]);
    if (method === 'GET') {
      sendJson(res, { outgoingBaskets: listOutgoing(currentCompanyId, year) });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req);
      try {
        sendJson(res, await sendBasket(currentCompanyId, year, {
          kind: String(body.kind ?? ''),
          simboosts: Number(body.simboosts ?? 0),
          message: body.message !== undefined ? String(body.message) : undefined,
          quality: body.quality !== undefined ? Number(body.quality) : undefined,
          collectibleId: body.collectibleId !== undefined ? Number(body.collectibleId) : undefined,
          recipientId: Number(body.recipientId)
        }));
      } catch (err) {
        sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return true;
    }
  }

  const basketOutgoingGetMatch = pathname.match(/^\/api\/v2\/gift-baskets\/(\d+|me)\/outgoing\/(\d{4})\/(\d+)\/?$/);
  if (basketOutgoingGetMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const basketId = Number(basketOutgoingGetMatch[3]);
    if (method === 'GET') {
      const basket = listOutgoing(currentCompanyId, Number(basketOutgoingGetMatch[2])).find(b => b.id === basketId);
      if (!basket) {
        sendJson(res, { error: 'Basket not found' }, 404);
        return true;
      }
      sendJson(res, basket);
      return true;
    }
    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      updateOutgoingMessage(currentCompanyId, basketId, String(body.message ?? ''));
      sendJson(res, { success: true });
      return true;
    }
    if (method === 'DELETE') {
      sendJson(res, { success: true });
      return true;
    }
  }

  const basketReceivedMatch = pathname.match(/^\/api\/v2\/gift-baskets\/(\d+|me)\/received\/(\d{4})\/?$/);
  if (basketReceivedMatch && method === 'GET') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, { receivedBaskets: listReceived(currentCompanyId, Number(basketReceivedMatch[2])) });
    return true;
  }

  const basketReceivedGetMatch = pathname.match(/^\/api\/v2\/gift-baskets\/(\d+|me)\/received\/(\d{4})\/(\d+)\/?$/);
  if (basketReceivedGetMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const basketId = Number(basketReceivedGetMatch[3]);
    if (method === 'PATCH') {
      try {
        sendJson(res, await claimBasket(currentCompanyId, basketId));
      } catch (err) {
        sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return true;
    }
    if (method === 'DELETE') {
      deleteReceived(currentCompanyId, basketId);
      sendJson(res, { success: true });
      return true;
    }
  }

  // Gift basket catalog (configurator constants).
  if (pathname === '/api/v1/gift-baskets/' && method === 'GET') {
    sendJson(res, {
      kinds: BASKET_KINDS,
      simboostsOptions: SIMBOOSTS_OPTIONS
    });
    return true;
  }

  // 5. Display case (Must wrap in { displayCase: [...] })
  //    Issue #88: the POST body follows the decompiled spec shape — exactly one
  //    of achievement_id / certificate_id / nft_id / resource_id (legacy
  //    resourceKind still accepted for resource placements). Slot must be 1..12
  //    and the placed item must be owned by the company.
  const dcMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/$/);
  if (dcMatch) {
    const companyId = dcMatch[1] === 'me' ? currentCompanyId : Number(dcMatch[1]);
    if (!companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId || companyId !== currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{
        slot: number;
        resourceKind?: number;
        quality?: number;
        title?: string;
        certificate_id?: number;
        achievement_id?: string | number;
        resource_id?: number;
        nft_id?: number;
        show_amount?: boolean;
      }>(req);

      const provided: string[] = [];
      if (body.achievement_id !== undefined && body.achievement_id !== null) provided.push('achievement_id');
      if (body.certificate_id !== undefined && body.certificate_id !== null) provided.push('certificate_id');
      if (body.nft_id !== undefined && body.nft_id !== null) provided.push('nft_id');
      if (body.resource_id !== undefined && body.resource_id !== null) provided.push('resource_id');
      if (body.resourceKind !== undefined && body.resourceKind !== null) provided.push('resourceKind');
      if (provided.length !== 1) {
        sendJson(res, {
          error: 'Exactly one display case item (achievement_id, certificate_id, nft_id or resource_id) must be provided',
          code: 'INVALID_ITEM'
        }, 400);
        return true;
      }

      try {
        let displayCase;
        if (provided[0] === 'achievement_id') {
          displayCase = updateDisplayCase(currentCompanyId, {
            slot: body.slot,
            itemKind: 'achievement',
            achievementId: String(body.achievement_id),
            title: body.title
          });
        } else if (provided[0] === 'certificate_id') {
          displayCase = updateDisplayCase(currentCompanyId, {
            slot: body.slot,
            itemKind: 'certificate',
            certificateId: Number(body.certificate_id),
            title: body.title
          });
        } else if (provided[0] === 'nft_id') {
          displayCase = updateDisplayCase(currentCompanyId, {
            slot: body.slot,
            itemKind: 'collectible',
            nftId: Number(body.nft_id),
            title: body.title
          });
        } else {
          displayCase = updateDisplayCase(currentCompanyId, {
            slot: body.slot,
            itemKind: 'resource',
            resourceKind: Number(provided[0] === 'resource_id' ? body.resource_id : body.resourceKind),
            quality: body.quality,
            title: body.title
          });
        }
        sendJson(res, { displayCase });
      } catch (err: unknown) {
        sendDomainError(res, err);
      }
      return true;
    }
    if (method === 'GET') {
      sendJson(res, { displayCase: getDisplayCase(companyId) });
      return true;
    }
  }

  // 6. Remove display case slot
  const dcSlotMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/(\d+)\/$/);
  if (dcSlotMatch && method === 'DELETE') {
    const companyId = dcSlotMatch[1] === 'me' ? currentCompanyId : Number(dcSlotMatch[1]);
    if (!currentCompanyId || !companyId || companyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const slot = Number(dcSlotMatch[2]);
    try {
      sendJson(res, { displayCase: removeDisplayCaseSlot(companyId, slot) });
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
    return true;
  }

  // 7. Company collectible vault: GET /api/v3/companies/{companyId}/collectibles/
  //    (Must wrap in { collectibles: [...] }). Served from the authoritative
  //    collectibles domain (issue #100) instead of the legacy static stub.
  const vaultMatch = pathname.match(/^\/api\/v3\/companies\/(\d+|me)\/collectibles\/?$/);
  if (vaultMatch && method === 'GET') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, { collectibles: getCompanyCollectibles(currentCompanyId) });
    return true;
  }

  // 8. Certificates Explorer
  const certMatch = pathname.match(/^\/api\/v2\/certificates-explorer\/(\d+)\/latest\/$/) ||
                    (pathname.startsWith('/api/') && pathname.includes('/certificates'));
  if (certMatch) {
    const realmId = 0;
    sendJson(res, getCertificates(realmId));
    return true;
  }

  // 10. Government Orders — real data from the government engine
  if (pathname.startsWith('/api/') && pathname.includes('/government-orders/')) {
    const realmOrders = getGovernmentOrders(0);
    const tierInfo = getGovernmentTier(currentCompanyId);
    sendJson(res, {
      orders: realmOrders,
      tier: tierInfo.tierIndex,
      completedOrders: realmOrders.filter(o => o.resourceMultiplierAwarded !== null)
    });
    return true;
  }

  // 11. Gift baskets
  if (pathname.startsWith('/api/') && pathname.includes('/gift-baskets/')) {
    sendJson(res, { baskets: [] });
    return true;
  }

  // 12. Unlocked PAs — real handler lives in social-routes (runs first);
  // this catch only fires for unmatched URL variants.
  if (pathname.startsWith('/api/') && pathname.includes('/unlocked-pas/')) {
    sendJson(res, { pas: [] });
    return true;
  }
  return false;
}
