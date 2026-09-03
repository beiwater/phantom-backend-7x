import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { readJsonBody, sendJson, requireCapability } from './utils.ts';
import {
  queueRocketLaunch,
  cancelQueuedLaunch,
  getCompanyLaunchQueue,
  getRocketLaunchStats
} from '../game/aerospace.ts';

interface LaunchRequestBody {
  rocketKind?: number;
  kind?: number;
  resource?: number;
  quality?: number;
}

interface CancelRequestBody {
  launchId?: number;
  id?: number;
}

export async function handleAerospaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. POST /api/v1/launch-pad/:id/launch/ - Queue a rocket launch
  const launchPadMatch = pathname.match(/^\/api\/v1\/launch-pad\/(\d+)\/launch\/?$/);
  if (launchPadMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const buildingId = Number(launchPadMatch[1]);
    const body = await readJsonBody<LaunchRequestBody>(req);
    const rocketKind = Number(body?.rocketKind ?? body?.kind ?? body?.resource ?? 0);
    const quality = Number(body?.quality ?? 0);

    try {
      const result = await queueRocketLaunch(currentCompanyId, buildingId, rocketKind, quality);
      sendJson(res, result, 200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 2. DELETE /api/v1/launch-pad/:id/launch/:launchId/ or DELETE /api/v1/launch-pad/:id/launch/ - Cancel a queued launch
  const cancelMatch = pathname.match(/^\/api\/v1\/launch-pad\/(\d+)\/launch\/(?:(\d+)\/?)?$/);
  if (cancelMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    const buildingId = Number(cancelMatch[1]);
    let launchId = cancelMatch[2] ? Number(cancelMatch[2]) : undefined;

    if (launchId === undefined) {
      try {
        const body = await readJsonBody<CancelRequestBody>(req);
        if (body?.launchId || body?.id) {
          launchId = Number(body.launchId ?? body.id);
        }
      } catch {
        // Body is optional on DELETE
      }
    }

    try {
      const result = await cancelQueuedLaunch(currentCompanyId, buildingId, launchId);
      sendJson(res, result, 200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.toLowerCase().includes('not found') ? 404 : 400;
      sendJson(res, { error: msg }, status);
    }
    return true;
  }

  // 3. GET /api/v2/launch-queue/ or /api/v2/launch-queue/:buildingId/ - Return active launch queue
  const queueMatch = pathname.match(/^\/api\/v2\/launch-queue\/(?:(\d+)\/?)?$/);
  if (queueMatch && method === 'GET') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    const buildingId = queueMatch[1] ? Number(queueMatch[1]) : undefined;
    const queue = getCompanyLaunchQueue(currentCompanyId, buildingId);
    sendJson(res, queue, 200);
    return true;
  }

  // 4. GET /api/v3/rocket-launches/:realmId/:companyId/ - Return rocket launch events & stats
  const rocketLaunchesMatch = pathname.match(/^\/api\/v3\/rocket-launches\/(\d+)\/([^/]+)\/?$/);
  if (rocketLaunchesMatch && method === 'GET') {
    const realmId = Number(rocketLaunchesMatch[1]);
    const companyParam = rocketLaunchesMatch[2];

    if (companyParam === 'me') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const stats = getRocketLaunchStats(realmId, currentCompanyId, true);
      sendJson(res, stats, 200);
      return true;
    }

    if (companyParam === 'all' || companyParam === '0') {
      const stats = getRocketLaunchStats(realmId, null, false);
      sendJson(res, stats, 200);
      return true;
    }

    const targetCompanyId = Number(companyParam);
    if (Number.isFinite(targetCompanyId) && targetCompanyId > 0) {
      const isMe = currentCompanyId !== null && targetCompanyId === currentCompanyId;
      const stats = getRocketLaunchStats(realmId, targetCompanyId, isMe);
      sendJson(res, stats, 200);
      return true;
    }

    const stats = getRocketLaunchStats(realmId, null, false);
    sendJson(res, stats, 200);
    return true;
  }

  // 5. GET /api/v1/aerospace-launches/ - Summary of aerospace launches
  if ((pathname === '/api/v1/aerospace-launches/' || pathname === '/api/v1/aerospace-launches') && method === 'GET') {
    const stats = getRocketLaunchStats(0, currentCompanyId || null, false);
    sendJson(res, stats, 200);
    return true;
  }

  return false;
}
export function registerAerospaceRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const bodyField = (body: unknown, field: string): unknown => {
    if (!body || typeof body !== 'object' || !(field in body)) return undefined;
    return Reflect.get(body, field);
  };
  const companyRequired = (ctx: { companyId: number } | null, res: ServerResponse): number | null => {
    const companyId = ctx?.companyId ?? null;
    if (!companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    return companyId;
  };
  registry
    .register({
      method: 'POST', pattern: '/api/v1/launch-pad/:buildingId/launch/', owner: 'aerospace',
      handler: async (_req, res, ctx, params, body) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        const rocketKind = Number(bodyField(body, 'rocketKind') ?? bodyField(body, 'kind') ?? bodyField(body, 'resource') ?? 0);
        const quality = Number(bodyField(body, 'quality') ?? 0);
        try {
          sendJson(res, await queueRocketLaunch(companyId, Number(params.buildingId), rocketKind, quality), 200);
        } catch (err: unknown) {
          sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
        }
      }
    })
    .register({
      method: 'DELETE', pattern: '/api/v1/launch-pad/:buildingId/launch/', owner: 'aerospace',
      handler: async (req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        let launchId: number | undefined;
        try {
          const body = await readJsonBody(req);
          const rawId = bodyField(body, 'launchId') ?? bodyField(body, 'id');
          if (rawId) launchId = Number(rawId);
        } catch {
          // Body is optional on DELETE.
        }
        try {
          sendJson(res, await cancelQueuedLaunch(companyId, Number(params.buildingId), launchId), 200);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, { error: msg }, msg.toLowerCase().includes('not found') ? 404 : 400);
        }
      }
    })
    .register({
      method: 'DELETE', pattern: '/api/v1/launch-pad/:buildingId/launch/:launchId/', owner: 'aerospace',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        try {
          sendJson(res, await cancelQueuedLaunch(companyId, Number(params.buildingId), Number(params.launchId)), 200);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, { error: msg }, msg.toLowerCase().includes('not found') ? 404 : 400);
        }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/launch-queue/', owner: 'aerospace',
      handler: async (_req, res, ctx) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        sendJson(res, getCompanyLaunchQueue(companyId), 200);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/launch-queue/:buildingId/', owner: 'aerospace',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        sendJson(res, getCompanyLaunchQueue(companyId, Number(params.buildingId)), 200);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/rocket-launches/:realmId/:companyId/', owner: 'aerospace',
      handler: async (_req, res, ctx, params) => {
        const realmId = Number(params.realmId);
        const companyParam = params.companyId;
        if (companyParam === 'me') {
          const companyId = companyRequired(ctx, res);
          if (!companyId) return;
          sendJson(res, getRocketLaunchStats(realmId, companyId, true), 200);
          return;
        }
        if (companyParam === 'all' || companyParam === '0') {
          sendJson(res, getRocketLaunchStats(realmId, null, false), 200);
          return;
        }
        const targetCompanyId = Number(companyParam);
        if (Number.isFinite(targetCompanyId) && targetCompanyId > 0) {
          sendJson(res, getRocketLaunchStats(realmId, targetCompanyId, ctx?.companyId !== null && targetCompanyId === ctx?.companyId), 200);
          return;
        }
        sendJson(res, getRocketLaunchStats(realmId, null, false), 200);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v1/aerospace-launches/', owner: 'aerospace',
      handler: async (_req, res, ctx) => {
        sendJson(res, getRocketLaunchStats(0, ctx?.companyId || null, false), 200);
      }
    });
}

registerAerospaceRoutes(globalRouteRegistry);
