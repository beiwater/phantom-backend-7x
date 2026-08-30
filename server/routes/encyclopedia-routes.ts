import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import {
  CONSTANTS_CORE,
  CONSTANTS_BUILDINGS,
  CONSTANTS_RESOURCES,
  getResourceDef
} from '../game/constants.ts';
import { getCompanyById } from '../game/company.ts';

export async function handleEncyclopediaRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Core Constants
  if (pathname === '/api/v2/constants/core/') {
    sendJson(res, CONSTANTS_CORE);
    return true;
  }
  if (pathname === '/api/v2/constants/buildings/') {
    sendJson(res, CONSTANTS_BUILDINGS);
    return true;
  }
  if (pathname === '/api/v2/constants/resources/') {
    sendJson(res, CONSTANTS_RESOURCES);
    return true;
  }
  if (pathname === '/api/v2/time-millis/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(String(Date.now()));
    return true;
  }
  if (pathname === '/api/csrf/') {
    sendJson(res, { csrfToken: 'local-csrf-token' });
    return true;
  }

  // Encyclopedia Resource Detail
  const encResMatch = pathname.match(/^\/api\/v4\/[^/]+\/\d+\/encyclopedia\/resources\/(\d+)\/(\d+)\/$/);
  if (encResMatch) {
    const kind = Number(encResMatch[1]);
    const resDef = getResourceDef(kind);
    sendJson(res, {
      dbLetter: kind,
      producedAt: resDef?.producedAt || 'P',
      producedFrom: resDef?.producedFrom || {},
      producedPerHourRaw: resDef?.producedPerHourRaw || 800,
      image: resDef?.image || '',
      transportation: resDef?.transportation || 1,
      isExchangeTradable: resDef?.isExchangeTradable ?? true,
      unitsSoldAnHour: resDef?.unitsSoldAnHour || 0,
      retailModel: { saturation: 0.5, averagePrice: 2.5 }
    });
    return true;
  }

  if (pathname.includes('/resources-retail-info/')) {
    sendJson(res, { 1: { saturation: 0.5 }, 2: { saturation: 0.5 }, 3: { saturation: 0.5 } });
    return true;
  }

  if (pathname.includes('/players/research/')) {
    sendJson(res, { research: {} });
    return true;
  }

  // Stats / Leaderboard
  const statsMatch = pathname.match(/^\/api\/v4\/[^/]+\/\d+\/stats\/top\/([^/]+)\/$/);
  if (statsMatch) {
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    const list = [
      { id: 1, company: { id: 999901, company: 'Solaris Energy Ltd', logo: '', realmId: 0, deleted: false }, value: 850000, rank: 0 },
      { id: 2, company: { id: 999902, company: 'AeroTech Systems', logo: '', realmId: 0, deleted: false }, value: 520000, rank: 1 },
      { id: 3, company: { id: 999903, company: 'Titan Industries', logo: '', realmId: 0, deleted: false }, value: 310000, rank: 2 }
    ];

    if (comp) {
      list.unshift({
        id: comp.company_id,
        company: { id: comp.company_id, company: comp.name, logo: comp.logo || '', realmId: comp.realm_id, deleted: false },
        value: comp.money,
        rank: 0
      });
    }

    sendJson(res, list);
    return true;
  }

  return false;
}
