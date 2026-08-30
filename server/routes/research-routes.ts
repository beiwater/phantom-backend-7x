import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
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
  if (pathname === '/api/v3/players/research/' || pathname.match(/^\/api\/v3\/players\/research\/(\d+|me)\/$/)) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    sendJson(res, getCompanyResearch(effectiveCompanyId));
    return true;
  }

  // Apply research points
  if (pathname === '/api/v3/players/research/apply/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ discipline: number; points: number }>(req);
    try {
      const result = applyResearch(currentCompanyId, body.discipline, body.points);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  const resourceAbilityMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/resource-ability\/(\d+)\/$/);
  if (resourceAbilityMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    const resourceKind = Number(resourceAbilityMatch[2]);
    try {
      if (method === 'GET') {
        sendJson(res, getResourceResearchAbility(currentCompanyId, resourceKind));
        return true;
      }

      if (method === 'POST') {
        const body = await readJsonBody<{ points?: number }>(req);
        sendJson(res, applyResourceResearch(currentCompanyId, resourceKind, Number(body.points)));
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
