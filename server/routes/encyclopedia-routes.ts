import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import {
  CONSTANTS_CORE,
  CONSTANTS_BUILDINGS,
  CONSTANTS_RESOURCES,
  getResourceDef
} from '../game/constants.ts';
import { getCompanyById } from '../game/company.ts';
import { companyRepository } from '../repositories/company-repository.ts';
import { warehouseRepository } from '../repositories/warehouse-repository.ts';
import { getWeather } from '../game-data/weather.ts';
import { getCertificates } from '../game/achievements.ts';
import { getGovernmentOrders, getGovernmentTier, getGovernmentBids } from '../game/government.ts';
import { getCompanyRankings } from '../game/encyclopedia.ts';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';

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
    sendJson(res, getWeather(realmId));
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
  // P0-06: the frontend retail widget additionally reads TOP-LEVEL `saturation` and
  // `averagePrice` per entry (see official HAR: entry = {quality, dbLetter,
  // saturation, averagePrice, retailData}); without top-level averagePrice every
  // display case renders null and the grocery sales area stays empty.
  if (pathname.startsWith('/api/') && pathname.includes('/resources-retail-info/')) {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const retailArray: Array<{
      quality: number | null;
      dbLetter: number;
      saturation: number;
      averagePrice: number | null;
      retailData: Array<{ date: string; saturation: number; averagePrice: number }>;
    }> = [];

    for (const [k, def] of Object.entries(CONSTANTS_RESOURCES)) {
      const kind = Number(k);
      const isRetail = def.unitsSoldAnHour > 0;
      const saturation = 0.5;
      const averagePrice = isRetail ? 2.5 : 0;
      retailArray.push({
        quality: null,
        dbLetter: kind,
        saturation,
        averagePrice: isRetail ? averagePrice : null,
        retailData: [
          { date: yesterday, saturation, averagePrice },
          { date: today, saturation, averagePrice }
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

  // 5. Existing resource quality — real per-company warehouse quality map
  if (pathname.startsWith('/api/') && pathname.includes('/encyclopedia/existing-resource-quality/')) {
    for (const k of Object.keys(CONSTANTS_RESOURCES)) {
      qualityMap[k] = 0;
    }
    if (currentCompanyId) {
      const qualityByKind = warehouseRepository.getQualityMap(currentCompanyId);
      for (const [kind, q] of qualityByKind) {
        const key = String(kind);
        if (key in qualityMap) {
          qualityMap[key] = q;
        }
      }
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
    const all = getCertificates(0);
    const latest = [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    const rarest = [...all].sort((a, b) => a.rank - b.rank).slice(0, 20);
    if (pathname.includes('/latest/')) {
      sendJson(res, { latestCertificates: latest });
      return true;
    }
    if (pathname.includes('/rarest/')) {
      sendJson(res, { rarestCertificates: rarest });
      return true;
    }
    sendJson(res, { latestCertificates: latest, rarestCertificates: rarest });
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/certificates/')) {
    sendJson(res, getCertificates(0));
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/tags/')) {
    sendJson(res, []);
    return true;
  }

  // 10b. Government Orders (v3/v2 data APIs only — must not swallow the
  // /api/v3/pages/... guide article whose slug contains "government-orders")
  if (pathname.startsWith('/api/v') && !pathname.includes('/pages/') && pathname.includes('/government-orders/')) {
    const orders = getGovernmentOrders(0);
    const tierInfo = getGovernmentTier(currentCompanyId);
    sendJson(res, {
      governmentOrders: orders,
      applications: getGovernmentBids(0),
      tier: tierInfo.tierIndex
    });
    return true;
  }
  // 11. Stats / Top Leaderboards — real companies ranked by the requested stat
  const statsMatch = pathname.match(/^\/api\/v4\/[^/]+\/\d+\/stats\/top\/([^/]+)\/$/);
  if (statsMatch) {
    void statsMatch[1];
    const rows = companyRepository.listTopCompaniesByMoney(100);
    const list = rows.map((r, idx) => ({
      id: r.companyId,
      company: { id: r.companyId, company: r.name, logo: r.logo, realmId: r.realmId, deleted: false },
      contest: { id: 1, name: 'Top Companies' },
      value: r.money,
      rank: idx
    }));
    sendJson(res, list);
    return true;
  }

  return false;
}

function encyclopediaRetailInfo(): Array<{
  quality: number | null;
  dbLetter: number;
  saturation: number;
  averagePrice: number | null;
  retailData: Array<{ date: string; saturation: number; averagePrice: number }>;
}> {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const result = [];
  for (const [kindValue, definition] of Object.entries(CONSTANTS_RESOURCES)) {
    const kind = Number(kindValue);
    const saturation = 0.5;
    const averagePrice = 2.5;
    result.push({
      quality: null,
      dbLetter: kind,
      saturation,
      averagePrice: definition.unitsSoldAnHour > 0 ? averagePrice : null,
      retailData: [
        { date: yesterday, saturation, averagePrice },
        { date: today, saturation, averagePrice }
      ]
    });
  }
  return result;
}

function encyclopediaResourceDetail(kind: number, quality: number): Record<string, unknown> {
  const definition = getResourceDef(kind);
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  return {
    dbLetter: kind,
    name: definition?.name || `Resource #${kind}`,
    producedAt: definition?.producedAt || 'P',
    producedFrom: definition?.producedFrom || {},
    producedPerHourRaw: definition?.producedPerHourRaw || 200,
    image: definition?.image || 'images/resources/apples.png',
    transportation: definition?.transportation || 1,
    isExchangeTradable: definition?.isExchangeTradable ?? true,
    unitsSoldAnHour: definition?.unitsSoldAnHour || 0,
    decay: definition?.decay || 0,
    quality,
    retailModel: { saturation: 0.5, averagePrice: 2.5 },
    retailData: [
      { date: yesterday, saturation: 0.5, averagePrice: 2.5 },
      { date: today, saturation: 0.5, averagePrice: 2.5 }
    ],
    market: { price: 1.0 + quality, quality }
  };
}

function encyclopediaQualityMap(companyId: number | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const kind of Object.keys(CONSTANTS_RESOURCES)) result[kind] = 0;
  if (companyId) {
    for (const [kind, quality] of warehouseRepository.getQualityMap(companyId)) {
      if (kind in result) result[String(kind)] = quality;
    }
  }
  return result;
}

function encyclopediaCertificates(): { latestCertificates: unknown[]; rarestCertificates: unknown[] } {
  const all = getCertificates(0);
  return {
    latestCertificates: [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20),
    rarestCertificates: [...all].sort((a, b) => a.rank - b.rank).slice(0, 20)
  };
}

export function registerEncyclopediaRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const modifiers = { resourceProductionModifiers: [], industryModifiers: [], realmModifiers: [] };
  const resources = { resources: [{ kind: 1 }, { kind: 2 }, { kind: 3 }, { kind: 13 }, { kind: 66 }] };
  registry
    .register({ method: 'GET', pattern: '/api/v2/constants/core/', owner: 'encyclopedia', handler: async (_req, res) => { sendJson(res, CONSTANTS_CORE); } })
    .register({ method: 'GET', pattern: '/api/v2/constants/buildings/', owner: 'encyclopedia', handler: async (_req, res) => { sendJson(res, CONSTANTS_BUILDINGS); } })
    .register({ method: 'GET', pattern: '/api/v2/constants/resources/', owner: 'encyclopedia', handler: async (_req, res) => { sendJson(res, CONSTANTS_RESOURCES); } })
    .register({
      method: 'GET', pattern: '/api/v2/time-millis/', owner: 'encyclopedia',
      handler: async (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(String(Date.now())); }
    })
    .register({ method: 'GET', pattern: '/api/csrf/', owner: 'encyclopedia', handler: async (_req, res) => { sendJson(res, { csrfToken: 'local-csrf-token' }); } })
    .register({
      method: 'GET', pattern: '/api/v2/weather/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getWeather(Number(params.realmId))); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/production-modifiers/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, modifiers); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/industry-modifiers/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, modifiers); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/realm-modifiers/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, modifiers); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/resources-retail-info/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, encyclopediaRetailInfo()); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope/:realmId/encyclopedia/resources/:kind/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, encyclopediaResourceDetail(Number(params.kind), 0));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope/:realmId/encyclopedia/resources/:kind/:quality/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, encyclopediaResourceDetail(Number(params.kind), Number(params.quality)));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/encyclopedia/existing-resource-quality/', owner: 'encyclopedia',
      handler: async (_req, res, ctx) => { sendJson(res, encyclopediaQualityMap(ctx?.companyId ?? null)); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/eva-ranking/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), 0, 'eva')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/eva-ranking/:realmId/:blobIndex/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'eva')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/ranking/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), 0, 'cv')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/ranking/:realmId/:blobIndex/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'cv')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope/:realmId/encyclopedia/ranking/:blobIndex/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'cv')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope/:realmId/encyclopedia/eva-ranking/:blobIndex/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'eva')); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/encyclopedia/events/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, { events: [] }); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/encyclopedia/supporters/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, { supporters: [] }); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/certificates-explorer/latest/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, { latestCertificates: encyclopediaCertificates().latestCertificates }); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/certificates-explorer/rarest/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, { rarestCertificates: encyclopediaCertificates().rarestCertificates }); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/certificates-explorer/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, encyclopediaCertificates()); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/certificates/', owner: 'encyclopedia',
      handler: async (_req, res) => { sendJson(res, getCertificates(0)); }
    })
    .register({
      method: 'GET', pattern: '/api/v3/:scope/:realmId/government-orders/', owner: 'encyclopedia',
      handler: async (_req, res, ctx) => {
        sendJson(res, {
          governmentOrders: getGovernmentOrders(0),
          applications: getGovernmentBids(0),
          tier: getGovernmentTier(ctx?.companyId ?? null).tierIndex
        });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope/:realmId/stats/top/:stat/', owner: 'encyclopedia',
      handler: async (_req, res) => {
        const rows = companyRepository.listTopCompaniesByMoney(100);
        sendJson(res, rows.map((row, index) => ({
          id: row.companyId,
          company: { id: row.companyId, company: row.name, logo: row.logo, realmId: row.realmId, deleted: false },
          contest: { id: 1, name: 'Top Companies' },
          value: row.money,
          rank: index
        })));
      }
    });
}

registerEncyclopediaRoutes(globalRouteRegistry);

