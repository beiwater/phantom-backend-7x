import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getIndividualAchievements,
  getAchievementsOverview,
  claimAchievement,
  getDisplayCase,
  updateDisplayCase,
  removeDisplayCaseSlot,
  getCollectibles,
  getCertificates
} from '../game/achievements.ts';

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
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
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

  // 4. Sync 3rd party achievements
  if (pathname.startsWith('/api/') && pathname.includes('/achievements/sync-3rd-party/')) {
    sendJson(res, { tasks: [] });
    return true;
  }

  // 5. Display case (Must wrap in { displayCase: [...] })
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
      const body = await readJsonBody<{ slot: number; resourceKind: number; quality?: number; title?: string }>(req);
      try {
        sendJson(res, {
          displayCase: updateDisplayCase(currentCompanyId, body.slot, body.resourceKind, body.quality, body.title)
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
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
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 7. Collectibles (Must wrap in { collectibles: [...] })
  if (pathname.startsWith('/api/') && pathname.includes('/collectibles/')) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, { collectibles: getCollectibles(currentCompanyId) });
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

  // 9. Building Auctions Compatibility
  if (pathname === '/api/v2/building-auctions/active-unlocks/') {
    sendJson(res, { activeUnlocks: [] });
    return true;
  }

  if (
    pathname.match(/^\/api\/v2\/building-auctions\/research-by-auction\/(?:\d+|me)\/$/) ||
    pathname.match(/^\/api\/v2\/building-auctions\/research-by-building\/(?:\d+|me)\/$/)
  ) {
    sendJson(res, { similarBuildingAuctions: [] });
    return true;
  }

  if (pathname.match(/^\/api\/v2\/building-auctions\/bids\/(?:\d+|me)\/(?:\d+\/)?$/)) {
    if (method === 'DELETE' || method === 'POST') {
      sendJson(res, { success: true, bids: [] });
      return true;
    }
    sendJson(res, { bids: [] });
    return true;
  }

  if (pathname.match(/^\/api\/v2\/building-auctions\/(?:\d+|me)\/promote\/?$/)) {
    sendJson(res, { success: true });
    return true;
  }

  if (
    pathname.match(/^\/api\/v2\/building-auctions\/(?:\d+|me)\/$/) ||
    pathname.match(/^\/api\/v2\/companies\/(?:\d+|me)\/building-auctions\/$/) ||
    pathname === '/api/v2/building-auctions/'
  ) {
    if (method === 'POST') {
      sendJson(res, { success: true, buildingAuctions: [] });
      return true;
    }
    sendJson(res, {
      buildingAuctions: [],
      auctions: [],
      myBids: [],
      featured: null
    });
    return true;
  }

  if (
    (pathname.startsWith('/api/') && pathname.includes('/building-auctions')) ||
    (pathname.startsWith('/api/') && pathname.includes('/building-auction'))
  ) {
    sendJson(res, {
      buildingAuctions: [],
      auctions: [],
      myBids: [],
      featured: null,
      activeUnlocks: [],
      similarBuildingAuctions: [],
      bids: []
    });
    return true;
  }

  // 10. Government Orders
  if (pathname.startsWith('/api/') && pathname.includes('/government-orders/')) {
    sendJson(res, {
      orders: [],
      tier: 1,
      completedOrders: []
    });
    return true;
  }

  // 11. Gift baskets
  if (pathname.startsWith('/api/') && pathname.includes('/gift-baskets/')) {
    sendJson(res, { baskets: [] });
    return true;
  }

  // 12. Unlocked PAs
  if (pathname.startsWith('/api/') && pathname.includes('/unlocked-pas/')) {
    sendJson(res, { pas: [] });
    return true;
  }
  return false;
}
