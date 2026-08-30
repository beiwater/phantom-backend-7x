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
  // 1. Core Constants
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

  // 2. Production Modifiers & Industry/Realm Modifiers
  if (
    pathname.includes('/production-modifiers/') ||
    pathname.includes('/industry-modifiers/') ||
    pathname.includes('/realm-modifiers/')
  ) {
    sendJson(res, {
      resourceProductionModifiers: [],
      industryModifiers: [],
      realmModifiers: []
    });
    return true;
  }

  // 3. Resources Retail Info MUST be an ARRAY of objects with dbLetter and retailData array!
  if (pathname.includes('/resources-retail-info/')) {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const retailArray: Array<{
      dbLetter: number;
      retailData: Array<{ date: string; saturation: number; averagePrice: number }>;
    }> = [];

    for (const [k, def] of Object.entries(CONSTANTS_RESOURCES)) {
      const kind = Number(k);
      retailArray.push({
        dbLetter: kind,
        retailData: [
          { date: yesterday, saturation: 0.5, averagePrice: def.unitsSoldAnHour ? 2.5 : 0 },
          { date: today, saturation: 0.5, averagePrice: def.unitsSoldAnHour ? 2.5 : 0 }
        ]
      });
    }
    sendJson(res, retailArray);
    return true;
  }

  // 4. Encyclopedia Resource Detail
  const encResMatch = pathname.match(/^\/api\/v4\/[^/]+\/\d+\/encyclopedia\/resources\/(\d+)\/(\d+)\/$/) ||
                      pathname.match(/^\/api\/v4\/[^/]+\/\d+\/encyclopedia\/resources\/(\d+)\/$/);
  if (encResMatch) {
    const kind = Number(encResMatch[1]);
    const quality = encResMatch[2] ? Number(encResMatch[2]) : 0;
    const resDef = getResourceDef(kind);
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    sendJson(res, {
      dbLetter: kind,
      name: resDef?.name || `Resource #${kind}`,
      producedAt: resDef?.producedAt || 'P',
      producedFrom: resDef?.producedFrom || {},
      producedPerHourRaw: resDef?.producedPerHourRaw || 200,
      image: resDef?.image || 'images/resources/apples.png',
      transportation: resDef?.transportation || 1,
      isExchangeTradable: resDef?.isExchangeTradable ?? true,
      unitsSoldAnHour: resDef?.unitsSoldAnHour || 0,
      decay: resDef?.decay || 0,
      quality,
      retailModel: { saturation: 0.5, averagePrice: 2.5 },
      retailData: [
        { date: yesterday, saturation: 0.5, averagePrice: 2.5 },
        { date: today, saturation: 0.5, averagePrice: 2.5 }
      ],
      market: { price: 1.0 + quality, quality }
    });
    return true;
  }

  // 5. Existing resource quality
  if (pathname.includes('/encyclopedia/existing-resource-quality/')) {
    const qualityMap: Record<string, number> = {};
    for (const k of Object.keys(CONSTANTS_RESOURCES)) {
      qualityMap[k] = 0;
    }
    sendJson(res, qualityMap);
    return true;
  }

  // 6. Static Documentation Pages / Guides
  const pagesMatch = pathname.match(/^\/api\/v3\/pages\/[^/]+\/([^/]+)\/$/);
  if (pagesMatch) {
    const pageKey = pagesMatch[1];
    sendJson(res, {
      title: pageKey.toUpperCase(),
      content: `<h2>Sim Companies 指南: ${pageKey}</h2><p>私人服务器版本文库与游戏机制文档已全面在线。</p>`
    });
    return true;
  }

  // 7. EVA & Wealth Rankings
  if (pathname.includes('/encyclopedia/eva-ranking/') || pathname.includes('/encyclopedia/ranking/')) {
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    const rankings = [
      {
        rank: 1,
        company: { id: 999901, company: 'Solaris Energy Ltd', logo: '', realmId: 0, deleted: false },
        value: 12500000
      },
      {
        rank: 2,
        company: { id: 999902, company: 'AgroEmpire Farms', logo: '', realmId: 0, deleted: false },
        value: 8700000
      },
      {
        rank: 3,
        company: { id: 999903, company: 'Titan Industries', logo: '', realmId: 0, deleted: false },
        value: 6400000
      }
    ];

    if (comp) {
      rankings.unshift({
        rank: 0,
        company: { id: comp.company_id, company: comp.name, logo: comp.logo || '', realmId: comp.realm_id, deleted: false },
        value: comp.money + 150000
      });
    }
    sendJson(res, rankings);
    return true;
  }

  // 8. Encyclopedia Events
  if (pathname.includes('/encyclopedia/events/')) {
    sendJson(res, { events: [] });
    return true;
  }

  // 9. Encyclopedia Supporters MUST return { supporters: [] }
  if (pathname.includes('/encyclopedia/supporters/')) {
    sendJson(res, { supporters: [] });
    return true;
  }

  // 10. Certificates and Tags
  if (pathname.includes('/certificates/')) {
    sendJson(res, []);
    return true;
  }
  if (pathname.includes('/tags/')) {
    sendJson(res, []);
    return true;
  }
  // 11. Stats / Top Leaderboards
  const statsMatch = pathname.match(/^\/api\/v4\/[^/]+\/\d+\/stats\/top\/([^/]+)\/$/);
  if (statsMatch) {
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    const list = [
      {
        id: 1,
        company: { id: 999901, company: 'Solaris Energy Ltd', logo: '', realmId: 0, deleted: false },
        contest: { id: 1, name: 'Harvest Competition' },
        value: 850000,
        rank: 0
      },
      {
        id: 2,
        company: { id: 999902, company: 'AeroTech Systems', logo: '', realmId: 0, deleted: false },
        contest: { id: 1, name: 'Harvest Competition' },
        value: 520000,
        rank: 1
      },
      {
        id: 3,
        company: { id: 999903, company: 'Titan Industries', logo: '', realmId: 0, deleted: false },
        contest: { id: 1, name: 'Harvest Competition' },
        value: 310000,
        rank: 2
      }
    ];

    if (comp) {
      list.unshift({
        id: comp.company_id,
        company: { id: comp.company_id, company: comp.name, logo: comp.logo || '', realmId: comp.realm_id, deleted: false },
        contest: { id: 1, name: 'Harvest Competition' },
        value: comp.money,
        rank: 0
      });
    }

    sendJson(res, list);
    return true;
  }

  return false;
}
