import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getCompanyAchievements,
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

  // Achievements list
  const achMatch = pathname.match(/^\/api\/v2\/no-cache\/companies\/(\d+|me)\/achievements\/$/) ||
                   pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/achievements\/$/);
  if (achMatch) {
    sendJson(res, getCompanyAchievements(effectiveCompanyId));
    return true;
  }

  // Display case (Must wrap in { displayCase: [...] })
  const dcMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/$/);
  if (dcMatch) {
    if (method === 'GET') {
      sendJson(res, { displayCase: getDisplayCase(effectiveCompanyId) });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ slot: number; kind: number; quality?: number; title?: string }>(req);
      const updated = updateDisplayCase(effectiveCompanyId, body.slot, body.kind, body.quality || 0, body.title || '');
      sendJson(res, { displayCase: updated });
      return true;
    }
  }

  // Remove display case slot
  const dcSlotMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/(\d+)\/$/);
  if (dcSlotMatch && method === 'DELETE') {
    const slot = Number(dcSlotMatch[2]);
    const updated = removeDisplayCaseSlot(effectiveCompanyId, slot);
    sendJson(res, { displayCase: updated });
    return true;
  }

  // Collectibles (Must wrap in { collectibles: [...] })
  if (pathname.includes('/collectibles/')) {
    sendJson(res, { collectibles: getCollectibles(effectiveCompanyId) });
    return true;
  }

  // Certificates Explorer
  const certMatch = pathname.match(/^\/api\/v2\/certificates-explorer\/(\d+)\/latest\/$/) ||
                    pathname.includes('/certificates');
  if (certMatch) {
    const realmId = Number(certMatch[1] || 0);
    sendJson(res, {
      certificates: getCertificates(realmId),
      latestCertificates: getCertificates(realmId),
      rarestCertificates: getCertificates(realmId)
    });
    return true;
  }

  // Building Auctions
  if (pathname.includes('/building-auctions/')) {
    sendJson(res, {
      buildingAuctions: [
        { id: 1, buildingId: 101, kind: 'A', name: 'Aerospace Factory Level 3', currentBid: 45000, minBid: 48000, finishes: new Date(Date.now() + 86400000).toISOString() }
      ]
    });
    return true;
  }

  // Government Orders
  if (pathname.includes('/government-orders/')) {
    if (pathname.includes('/tier/')) {
      sendJson(res, { tier: 1 });
      return true;
    }
    sendJson(res, {
      governmentOrders: [],
      applications: [],
      blockedCompanies: []
    });
    return true;
  }

  // Game notifications
  if (pathname.includes('/game-notifications/')) {
    sendJson(res, { notifications: [] });
    return true;
  }

  // Gift baskets
  if (pathname.includes('/gift-baskets/')) {
    sendJson(res, { outgoingBaskets: [], receivedBaskets: [] });
    return true;
  }

  // Unlocked PAs
  if (pathname.includes('/unlocked-pas/')) {
    sendJson(res, { unlockedPAs: ['old'] });
    return true;
  }

  return false;
}
