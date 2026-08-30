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
  // Achievements list
  const achMatch = pathname.match(/^\/api\/v2\/no-cache\/companies\/(\d+|me)\/achievements\/$/) ||
                   pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/achievements\/$/);
  if (achMatch) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    sendJson(res, getCompanyAchievements(effectiveCompanyId));
    return true;
  }

  // Display case
  const dcMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/$/);
  if (dcMatch) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    if (method === 'GET') {
      sendJson(res, getDisplayCase(effectiveCompanyId));
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ slot: number; kind: number; quality?: number; title?: string }>(req);
      const updated = updateDisplayCase(effectiveCompanyId, body.slot, body.kind, body.quality || 0, body.title || '');
      sendJson(res, updated);
      return true;
    }
  }

  // Remove display case slot
  const dcSlotMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/(\d+)\/$/);
  if (dcSlotMatch && method === 'DELETE') {
    const effectiveCompanyId = currentCompanyId || 4259175;
    const slot = Number(dcSlotMatch[2]);
    const updated = removeDisplayCaseSlot(effectiveCompanyId, slot);
    sendJson(res, updated);
    return true;
  }

  // Collectibles
  if (pathname === '/api/v2/collectibles/' || pathname.match(/^\/api\/v2\/collectibles\/company\/(\d+|me)\/$/)) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    sendJson(res, getCollectibles(effectiveCompanyId));
    return true;
  }

  // Certificates Explorer
  const certMatch = pathname.match(/^\/api\/v2\/certificates-explorer\/(\d+)\/latest\/$/);
  if (certMatch) {
    const realmId = Number(certMatch[1]);
    sendJson(res, getCertificates(realmId));
    return true;
  }

  // Building Auctions
  if (pathname === '/api/v2/building-auctions/' || pathname === '/api/v2/building-auctions/active-unlocks/') {
    sendJson(res, {
      buildingAuctions: [
        { id: 1, buildingId: 101, kind: 'A', name: 'Aerospace Factory Level 3', currentBid: 45000, minBid: 48000, finishes: new Date(Date.now() + 86400000).toISOString() }
      ]
    });
    return true;
  }

  return false;
}
