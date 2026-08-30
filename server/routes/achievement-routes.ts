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
  const effectiveCompanyId = currentCompanyId || 4259175;

  // 1. Claim individual achievement: DELETE /api/v2/no-cache/companies/achievements/:id/ or /api/v2/companies/achievements/:id/
  const claimAchMatch = pathname.match(/^\/api\/v2\/(?:no-cache\/)?companies\/achievements\/([^/]+)\/$/);
  if (claimAchMatch && method === 'DELETE') {
    const achId = claimAchMatch[1];
    const result = claimAchievement(effectiveCompanyId, achId);
    sendJson(res, result);
    return true;
  }

  // 2. Individual achievements list for toast / collection modal
  const individualAchMatch = pathname.match(/^\/api\/v2\/no-cache\/companies\/(\d+|me)\/achievements\/$/);
  if (individualAchMatch && method === 'GET') {
    sendJson(res, getIndividualAchievements(effectiveCompanyId));
    return true;
  }

  // 3. Achievements overview (Summary list of categories & stars for achievements page)
  const overviewAchMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/achievements\/$/);
  if (overviewAchMatch && method === 'GET') {
    sendJson(res, getAchievementsOverview(effectiveCompanyId));
    return true;
  }

  // 4. Sync 3rd party achievements
  if (pathname.includes('/achievements/sync-3rd-party/')) {
    sendJson(res, { tasks: [] });
    return true;
  }

  // 5. Display case (Must wrap in { displayCase: [...] })
  const dcMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/$/);
  if (dcMatch) {
    if (method === 'POST') {
      const body = await readJsonBody<{ slot: number; resourceKind: number; quality?: number; title?: string }>(req);
      sendJson(res, { displayCase: updateDisplayCase(effectiveCompanyId, body.slot, body.resourceKind, body.quality, body.title) });
      return true;
    }
    sendJson(res, { displayCase: getDisplayCase(effectiveCompanyId) });
    return true;
  }

  // 6. Remove display case slot
  const dcSlotMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/(\d+)\/$/);
  if (dcSlotMatch && method === 'DELETE') {
    const slot = Number(dcSlotMatch[2]);
    sendJson(res, { displayCase: removeDisplayCaseSlot(effectiveCompanyId, slot) });
    return true;
  }

  // 7. Collectibles (Must wrap in { collectibles: [...] })
  if (pathname.includes('/collectibles/')) {
    sendJson(res, { collectibles: getCollectibles(effectiveCompanyId) });
    return true;
  }

  // 8. Certificates Explorer
  const certMatch = pathname.match(/^\/api\/v2\/certificates-explorer\/(\d+)\/latest\/$/) ||
                    pathname.includes('/certificates');
  if (certMatch) {
    const realmId = 0;
    sendJson(res, getCertificates(realmId));
    return true;
  }

  // 9. Building Auctions
  if (pathname.includes('/building-auctions/')) {
    sendJson(res, {
      auctions: [],
      myBids: [],
      featured: null
    });
    return true;
  }

  // 10. Government Orders
  if (pathname.includes('/government-orders/')) {
    sendJson(res, {
      orders: [],
      tier: 1,
      completedOrders: []
    });
    return true;
  }

  // 11. Gift baskets
  if (pathname.includes('/gift-baskets/')) {
    sendJson(res, { baskets: [] });
    return true;
  }

  // 12. Unlocked PAs
  if (pathname.includes('/unlocked-pas/')) {
    sendJson(res, { pas: [] });
    return true;
  }

  return false;
}
