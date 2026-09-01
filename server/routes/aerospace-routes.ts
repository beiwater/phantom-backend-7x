import type { IncomingMessage, ServerResponse } from 'node:http';
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
