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
