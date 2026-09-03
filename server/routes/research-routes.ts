import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { readJsonBody, sendJson, requireCapability } from './utils.ts';
import {
  getCompanyResearch,
  applyResearch,
  getResourceResearchAbility,
  applyResourceResearch
} from '../game/research.ts';

export async function handleResearchRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Current research summary
  const researchMatch = pathname.match(/^\/api\/v3\/players\/research\/(\d+|me)\/$/);
  if (pathname === '/api/v3/players/research/' || researchMatch) {
    const companyId = researchMatch && researchMatch[1] !== 'me'
      ? Number(researchMatch[1])
      : currentCompanyId;
    if (!currentCompanyId || !companyId || companyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getCompanyResearch(companyId));
    return true;
  }

  // Apply research points
  if (pathname === '/api/v3/players/research/apply/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #71: research capability gate (canonical tier table).
    if (requireCapability(res, currentCompanyId, 'research', 'research')) return true;
    const body = await readJsonBody<{ discipline: number; points: number }>(req);
    try {
      const result = await applyResearch(currentCompanyId, body.discipline, body.points);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  const resourceAbilityMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/resource-ability\/(\d+)\/$/);
  if (resourceAbilityMatch) {
    const requestedCompanyId = resourceAbilityMatch[1] === 'me'
      ? currentCompanyId
      : Number(resourceAbilityMatch[1]);
    if (!currentCompanyId || requestedCompanyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    const resourceKind = Number(resourceAbilityMatch[2]);
    try {
      if (method === 'GET') {
        sendJson(res, getResourceResearchAbility(currentCompanyId, resourceKind));
        return true;
      }

      // Issue #71: research capability gate (canonical tier table).
      if (requireCapability(res, currentCompanyId, 'research', 'resource research')) return true;
      if (method === 'POST') {
        const body = await readJsonBody<{ points?: number }>(req);
        const result = await applyResourceResearch(currentCompanyId, resourceKind, Number(body.points));
        sendJson(res, result);
        return true;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
      return true;
    }
  }

  return false;
}
export function registerResearchRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const bodyField = (body: unknown, field: string): unknown => {
    if (!body || typeof body !== 'object' || !(field in body)) return undefined;
    return Reflect.get(body, field);
  };
  registry
    .register({
      method: 'GET',
      pattern: '/api/v3/players/research/',
      owner: 'research',
      handler: async (_req, res, ctx) => {
        if (!ctx?.companyId) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        sendJson(res, getCompanyResearch(ctx.companyId));
      }
    })
    .register({
      method: 'GET',
      pattern: '/api/v3/players/research/:companyId/',
      owner: 'research',
      handler: async (_req, res, ctx, params) => {
        const companyId = params.companyId === 'me' ? ctx?.companyId ?? null : Number(params.companyId);
        if (!ctx?.companyId || !companyId || companyId !== ctx.companyId) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        sendJson(res, getCompanyResearch(companyId));
      }
    })
    .register({
      method: 'POST',
      pattern: '/api/v3/players/research/apply/',
      owner: 'research',
      handler: async (_req, res, ctx, _params, body) => {
        if (!ctx?.companyId) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        if (requireCapability(res, ctx.companyId, 'research', 'research')) return;
        try {
          sendJson(res, await applyResearch(ctx.companyId, Number(bodyField(body, 'discipline')), Number(bodyField(body, 'points'))));
        } catch (err: unknown) {
          sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
        }
      }
    })
    .register({
      method: 'GET',
      pattern: '/api/v2/companies/:companyId/resource-ability/:resourceKind/',
      owner: 'research',
      handler: async (_req, res, ctx, params) => {
        const companyId = params.companyId === 'me' ? ctx?.companyId ?? null : Number(params.companyId);
        if (!ctx?.companyId || !companyId || companyId !== ctx.companyId) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        try {
          sendJson(res, getResourceResearchAbility(companyId, Number(params.resourceKind)));
        } catch (err: unknown) {
          sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
        }
      }
    })
    .register({
      method: 'POST',
      pattern: '/api/v2/companies/:companyId/resource-ability/:resourceKind/',
      owner: 'research',
      handler: async (_req, res, ctx, params, body) => {
        const companyId = params.companyId === 'me' ? ctx?.companyId ?? null : Number(params.companyId);
        if (!ctx?.companyId || !companyId || companyId !== ctx.companyId) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        if (requireCapability(res, companyId, 'research', 'resource research')) return;
        try {
          sendJson(res, await applyResourceResearch(companyId, Number(params.resourceKind), Number(bodyField(body, 'points'))));
        } catch (err: unknown) {
          sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
        }
      }
    });
}

registerResearchRoutes(globalRouteRegistry);
