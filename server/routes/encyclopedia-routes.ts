import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import {
  CONSTANTS_CORE,
  CONSTANTS_BUILDINGS,
  CONSTANTS_RESOURCES
} from '../game/constants.ts';
import { companyRepository } from '../repositories/company-repository.ts';
import { warehouseRepository } from '../repositories/warehouse-repository.ts';
import { getWeather } from '../game-data/weather.ts';
import { getCertificates } from '../game/achievements.ts';
import { getGovernmentOrders, getGovernmentTier, getGovernmentBids } from '../game/government.ts';
import { getCompanyRankings } from '../game/encyclopedia.ts';
import {
  getEncyclopediaRetailInfo,
  getEncyclopediaResourceDetail,
  getEncyclopediaProductionModifiers,
  getEncyclopediaEvents,
  getEncyclopediaSupporters
} from '../application/encyclopedia/encyclopedia-queries.ts';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';

function extractRealmId(pathname: string, marker: string): number | null {
  const segments = pathname.split('/').filter(Boolean);
  const markerSegments = marker.split('/');
  const markerIndex = segments.findIndex((_, index) =>
    markerSegments.every((segment, offset) => segments[index + offset] === segment)
  );
  if (markerIndex < 0) return null;
  const candidates = [
    segments[markerIndex - 1],
    segments[markerIndex + markerSegments.length]
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && /^\d+$/.test(candidate)) return Number(candidate);
  }
  return null;
}

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
  const productionRealmId = extractRealmId(pathname, 'production-modifiers');
  if (productionRealmId !== null) {
    sendJson(res, {
      resourceProductionModifiers: getEncyclopediaProductionModifiers(productionRealmId)
    });
    return true;
  }
  const industryRealmId = extractRealmId(pathname, 'industry-modifiers');
  if (industryRealmId !== null) {
    sendJson(res, {
      error: 'Industry modifiers are unavailable',
      code: 'BACKEND_UNAVAILABLE'
    }, 501);
    return true;
  }
  const realmModifiersRealmId = extractRealmId(pathname, 'realm-modifiers');
  if (realmModifiersRealmId !== null) {
    sendJson(res, {
      error: 'Realm modifiers are unavailable',
      code: 'BACKEND_UNAVAILABLE'
    }, 501);
    return true;
  }

  // 3. Resources Retail Info
  const retailRealmId = extractRealmId(pathname, 'resources-retail-info');
  if (retailRealmId !== null) {
    sendJson(res, getEncyclopediaRetailInfo(retailRealmId));
    return true;
  }

  // 4. Encyclopedia Resource Detail
  const encResMatch = pathname.match(
    /^\/api\/v4\/[^/]+\/(\d+)\/encyclopedia\/resources\/(\d+)(?:\/(\d+))?\/$/
  ) ?? pathname.match(
    /^\/api\/v4\/(\d+)\/encyclopedia\/resources\/(\d+)(?:\/(\d+))?\/$/
  );
  if (encResMatch) {
    const realmId = Number(encResMatch[1]);
    const kind = Number(encResMatch[2]);
    const quality = encResMatch[3] ? Number(encResMatch[3]) : 0;
    const detail = getEncyclopediaResourceDetail(realmId, kind, quality);
    if (detail === null) {
      sendJson(res, {
        error: 'Resource not found',
        code: 'API_NOT_FOUND',
        path: pathname
      }, 404);
    } else {
      sendJson(res, detail);
    }
    return true;
  }

  // 5. Existing resource quality — real per-company warehouse quality map
  if (pathname.startsWith('/api/') && pathname.includes('/encyclopedia/existing-resource-quality/')) {
    sendJson(res, encyclopediaQualityMap(currentCompanyId));
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
  const eventsRealmId = extractRealmId(pathname, 'encyclopedia/events');
  if (eventsRealmId !== null) {
    sendJson(res, { events: getEncyclopediaEvents(eventsRealmId) });
    return true;
  }

  // 9. Encyclopedia Supporters
  const supportersRealmId = extractRealmId(pathname, 'encyclopedia/supporters');
  if (supportersRealmId !== null) {
    sendJson(res, { supporters: getEncyclopediaSupporters(supportersRealmId) });
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
      method: 'GET', pattern: '/api/v2/production-modifiers/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, {
          resourceProductionModifiers: getEncyclopediaProductionModifiers(Number(params.realmId))
        });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/industry-modifiers/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res) => {
        sendJson(res, {
          error: 'Industry modifiers are unavailable',
          code: 'BACKEND_UNAVAILABLE'
        }, 501);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/realm-modifiers/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res) => {
        sendJson(res, {
          error: 'Realm modifiers are unavailable',
          code: 'BACKEND_UNAVAILABLE'
        }, 501);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/production-modifiers/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, {
          resourceProductionModifiers: getEncyclopediaProductionModifiers(Number(params.realmId))
        });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/industry-modifiers/', owner: 'encyclopedia',
      handler: async (_req, res) => {
        sendJson(res, {
          error: 'Industry modifiers are unavailable',
          code: 'BACKEND_UNAVAILABLE'
        }, 501);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/realm-modifiers/', owner: 'encyclopedia',
      handler: async (_req, res) => {
        sendJson(res, {
          error: 'Realm modifiers are unavailable',
          code: 'BACKEND_UNAVAILABLE'
        }, 501);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/resources-retail-info/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, getEncyclopediaRetailInfo(Number(params.realmId)));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:realmId/resources-retail-info/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, getEncyclopediaRetailInfo(Number(params.realmId)));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope/:realmId/encyclopedia/resources/:kind/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        const detail = getEncyclopediaResourceDetail(
          Number(params.realmId),
          Number(params.kind),
          0
        );
        if (detail === null) {
          sendJson(res, { error: 'Resource not found', code: 'API_NOT_FOUND' }, 404);
        } else {
          sendJson(res, detail);
        }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope/:realmId/encyclopedia/resources/:kind/:quality/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        const detail = getEncyclopediaResourceDetail(
          Number(params.realmId),
          Number(params.kind),
          Number(params.quality)
        );
        if (detail === null) {
          sendJson(res, { error: 'Resource not found', code: 'API_NOT_FOUND' }, 404);
        } else {
          sendJson(res, detail);
        }
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
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, { events: getEncyclopediaEvents(Number(params.realmId)) });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/encyclopedia/events/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, { events: getEncyclopediaEvents(Number(params.realmId)) });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/:scope/:realmId/encyclopedia/supporters/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, { supporters: getEncyclopediaSupporters(Number(params.realmId)) });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/encyclopedia/supporters/:realmId/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, { supporters: getEncyclopediaSupporters(Number(params.realmId)) });
      }
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

