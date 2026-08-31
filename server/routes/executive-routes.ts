import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getCompanyExecutives,
  getExecutiveCandidates,
  hireExecutive,
  fireExecutive,
  assignExecutive,
  trainExecutive
} from '../game/executives.ts';

export async function handleExecutiveRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {

  // Current executives list (v3 & v4)
  const executiveCompanyMatch = pathname.match(/^\/api\/v(3|4)\/(?:companies|executives\/company)\/(\d+|me)\/executives\/?$/) ||
    pathname.match(/^\/api\/v4\/executives\/company\/(\d+|me)\/$/);
  if (
    pathname === '/api/v4/executives/' ||
    executiveCompanyMatch
  ) {
    const requestedCompanyId = executiveCompanyMatch
      ? (executiveCompanyMatch[2] || executiveCompanyMatch[1]) === 'me'
        ? currentCompanyId
        : Number(executiveCompanyMatch[2] || executiveCompanyMatch[1])
      : currentCompanyId;
    if (!currentCompanyId || requestedCompanyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, {
      executives: getCompanyExecutives(currentCompanyId),
      candidates: getExecutiveCandidates(currentCompanyId),
      offers: [],
      achievements: []
    });
    return true;
  }

  // Offers & Hostile offers
  if (pathname.startsWith('/api/') && (pathname.includes('/executives/my-offers/') || pathname.includes('/executives/hostile-offers/'))) {
    sendJson(res, { offers: [] });
    return true;
  }

  // Former executives
  if (pathname.startsWith('/api/') && pathname.includes('/former-executives/')) {
    sendJson(res, { executives: [] });
    return true;
  }

  // Candidates list
  if (pathname === '/api/v4/executives/candidates/') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getExecutiveCandidates(currentCompanyId));
    return true;
  }

  // Hire executive
  if (pathname === '/api/v4/executives/hire/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ candidateId: number; position?: string }>(req);
    try {
      const exec = hireExecutive(currentCompanyId, body.candidateId, body.position || 'unassigned');
      sendJson(res, { executive: exec });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Fire executive
  const fireMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/fire\/$/);
  if (fireMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const execId = Number(fireMatch[1]);
    try {
      const result = fireExecutive(currentCompanyId, execId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Assign executive position
  const assignMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/assign\/$/);
  if (assignMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const execId = Number(assignMatch[1]);
    const body = await readJsonBody<{ position: string }>(req);
    try {
      const exec = assignExecutive(currentCompanyId, execId, body.position);
      sendJson(res, { executive: exec });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Train executive
  const trainMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/train\/$/);
  if (trainMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const execId = Number(trainMatch[1]);
    try {
      const result = trainExecutive(currentCompanyId, execId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
