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
import { getCompanyRankings } from '../game/encyclopedia.ts';
import {
  getEncyclopediaRetailInfo,
  getEncyclopediaResourceDetail,
  getEncyclopediaProductionModifiers,
  getEncyclopediaEvents,
  getEncyclopediaSupporters
} from '../application/encyclopedia/encyclopedia-queries.ts';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { SUPPORTED_LANGUAGE_PATTERN } from './supported-locales.ts';

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

  // 4. Encyclopedia Resource Detail
  const encResMatch = pathname.match(
    /^\/api\/v4\/(\d+)\/(\d+)\/encyclopedia\/resources\/(\d+)\/(\d+)\/$/
  );
  if (encResMatch) {
    const realmId = Number(encResMatch[1]);
    const kind = Number(encResMatch[3]);
    const quality = Number(encResMatch[4]);
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
      method: 'GET', pattern: '/api/v2/weather/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getWeather(Number(params.realmId))); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/production-modifiers/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, {
          resourceProductionModifiers: getEncyclopediaProductionModifiers(Number(params.realmId))
        });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/industry-modifiers/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res) => {
        sendJson(res, {
          error: 'Industry modifiers are unavailable',
          code: 'BACKEND_UNAVAILABLE'
        }, 501);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/realm-modifiers/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res) => {
        sendJson(res, {
          error: 'Realm modifiers are unavailable',
          code: 'BACKEND_UNAVAILABLE'
        }, 501);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:realmId(\\d+)/resources-retail-info/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, getEncyclopediaRetailInfo(Number(params.realmId)));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:realmId(\\d+)/:resourceType(\\d+)/encyclopedia/resources/:kind(\\d+)/:quality(\\d+)/', owner: 'encyclopedia',
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
    // The checked-in issue-199 page flow uses this compact URL form; the
    // upstream Wcr helper also exposes the full realm/resourceType/quality
    // form above. Keep both exact contracts addressable.
    .register({
      method: 'GET', pattern: '/api/v4/:realmId(\\d+)/encyclopedia/resources/:kind(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        const detail = getEncyclopediaResourceDetail(Number(params.realmId), Number(params.kind), 0);
        if (detail === null) {
          sendJson(res, { error: 'Resource not found', code: 'API_NOT_FOUND' }, 404);
        } else {
          sendJson(res, detail);
        }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:realmId(\\d+)/:resourceType(\\d+)/encyclopedia/existing-resource-quality/', owner: 'encyclopedia',
      handler: async (_req, res, ctx) => { sendJson(res, encyclopediaQualityMap(ctx?.companyId ?? null)); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/eva-ranking/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), 0, 'eva')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/eva-ranking/:realmId(\\d+)/:blobIndex(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'eva')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/ranking/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), 0, 'cv')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/encyclopedia/ranking/:realmId(\\d+)/:blobIndex(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'cv')); }
    })
    // Retain the exact numeric-prefixed compatibility URL used by the
    // server's full-route regression suite. The source client also uses the
    // canonical /api/v4/encyclopedia/ranking/:realmId/:blobIndex/ form above.
    .register({
      method: 'GET', pattern: '/api/v4/:scope(\\d+)/:realmId(\\d+)/encyclopedia/ranking/:rankingRealmId(\\d+)/:blobIndex(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'cv')); }
    })
    .register({
      method: 'GET', pattern: '/api/v4/:scope(\\d+)/:realmId(\\d+)/encyclopedia/eva-ranking/:rankingRealmId(\\d+)/:blobIndex(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyRankings(Number(params.realmId), Number(params.blobIndex), 'eva')); }
    })
    .register({
      method: 'GET', pattern: '/api/v3/encyclopedia/events/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, { events: getEncyclopediaEvents(Number(params.realmId)) });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/encyclopedia/supporters/:realmId(\\d+)/', owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        sendJson(res, { supporters: getEncyclopediaSupporters(Number(params.realmId)) });
      }
    })
    .register({
      method: 'GET', pattern: `/api/v4/:locale(${SUPPORTED_LANGUAGE_PATTERN})/:realmId(\\d+)/stats/top/:stat/`, owner: 'encyclopedia',
      handler: async (_req, res, _ctx, params) => {
        // The Wcr wrapper's first argument is the selected language, followed
        // by the numeric realm. Keep the stat key in the route params so new
        // leaderboard implementations cannot accidentally widen its path.
        void params.locale;
        void params.stat;
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

