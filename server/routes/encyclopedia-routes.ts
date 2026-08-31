import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import {
  CONSTANTS_CORE,
  CONSTANTS_BUILDINGS,
  CONSTANTS_RESOURCES,
  getResourceDef
} from '../game/constants.ts';
import { getCompanyById } from '../game/company.ts';
import { getCompanyRankings } from '../game/encyclopedia.ts';

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

  // 1b. Weather: /api/v2/weather/:realmId/
  const weatherMatch = pathname.match(/^\/api\/v2\/weather\/(\d+)\/$/);
  if (weatherMatch) {
    const realmId = Number(weatherMatch[1]);
    sendJson(res, {
      id: 1,
      realm: realmId,
      sellingSpeedMultiplier: 1.0,
      since: '2026-01-01T00:00:00.000Z',
      until: '2030-01-01T00:00:00.000Z'
    });
    return true;
  }

  // 2. Production Modifiers & Industry/Realm Modifiers
  if (
    pathname.startsWith('/api/') &&
    (pathname.includes('/production-modifiers/') ||
     pathname.includes('/industry-modifiers/') ||
     pathname.includes('/realm-modifiers/'))
  ) {
    sendJson(res, {
      resourceProductionModifiers: [],
      industryModifiers: [],
      realmModifiers: []
    });
    return true;
  }

  // 3. Resources Retail Info MUST be an ARRAY of objects with dbLetter and retailData array!
  if (pathname.startsWith('/api/') && pathname.includes('/resources-retail-info/')) {
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
  if (pathname.startsWith('/api/') && pathname.includes('/encyclopedia/existing-resource-quality/')) {
    for (const k of Object.keys(CONSTANTS_RESOURCES)) {
      qualityMap[k] = 0;
    }
    sendJson(res, qualityMap);
    return true;
  }

  // 6. Static Documentation Pages / Guides — P1-03.
  // Served by routes/page-routes.ts (registered later in the router): the
  // article viewer needs { slug, slugTitle, title, body, language, lastUpdate,
  // otherLanguages }; the previous inline stub returned { title, content },
  // which crashed the viewer on `otherLanguages.length` and rendered no body.

  // 7. Dynamic Real EVA & Wealth Rankings
  const evaRankingMatch = pathname.match(/^\/api\/v4\/encyclopedia\/eva-ranking\/(\d+)(?:\/(\d+))?\/?$/);
  if (evaRankingMatch) {
    const realmId = Number(evaRankingMatch[1]);
    const blobIndex = Number(evaRankingMatch[2] || 0);
    const rankings = getCompanyRankings(realmId, blobIndex, 'eva');
    sendJson(res, rankings);
    return true;
  }

  const cvRankingMatch = pathname.match(/^\/api\/v4\/encyclopedia\/ranking\/(\d+)(?:\/(\d+))?\/?$/);
  if (cvRankingMatch) {
    const realmId = Number(cvRankingMatch[1]);
    const blobIndex = Number(cvRankingMatch[2] || 0);
    const rankings = getCompanyRankings(realmId, blobIndex, 'cv');
    sendJson(res, rankings);
    return true;
  }

  if (pathname.startsWith('/api/') && (pathname.includes('/encyclopedia/eva-ranking/') || pathname.includes('/encyclopedia/ranking/'))) {
    const isEva = pathname.includes('eva-ranking');
    const rankings = getCompanyRankings(0, 0, isEva ? 'eva' : 'cv');
    sendJson(res, rankings);
    return true;
  }

  // 8. Encyclopedia Events
  if (pathname.startsWith('/api/') && pathname.includes('/encyclopedia/events/')) {
    sendJson(res, { events: [] });
    return true;
  }

  // 9. Encyclopedia Supporters MUST return { supporters: [] }
  if (pathname.startsWith('/api/') && pathname.includes('/encyclopedia/supporters/')) {
    sendJson(res, { supporters: [] });
    return true;
  }

  // 10. Certificates and Tags (API endpoints only)
  if (pathname.startsWith('/api/') && pathname.includes('/certificates-explorer/')) {
    if (pathname.includes('/latest/')) {
      sendJson(res, { latestCertificates: [] });
      return true;
    }
    if (pathname.includes('/rarest/')) {
      sendJson(res, { rarestCertificates: [] });
      return true;
    }
    sendJson(res, { latestCertificates: [], rarestCertificates: [] });
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/certificates/')) {
    sendJson(res, []);
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/tags/')) {
    sendJson(res, []);
    return true;
  }

  // 10b. Government Orders (v3/v2 data APIs only — must not swallow the
  // /api/v3/pages/... guide article whose slug contains "government-orders")
  if (pathname.startsWith('/api/v') && !pathname.includes('/pages/') && pathname.includes('/government-orders/')) {
    sendJson(res, { governmentOrders: [], applications: [], tier: 1 });
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
