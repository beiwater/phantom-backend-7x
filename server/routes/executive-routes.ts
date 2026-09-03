import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, requireCapability, setPreparsedBody } from './utils.ts';
import { createGameContext, type GameContext } from '../context/game-context.ts';
import {
  getCompanyExecutivesQuery,
  getExecutiveCandidatesQuery,
  getExecutiveByIdQuery,
  hireExecutiveCommand,
  fireExecutiveCommand,
  assignExecutiveCommand,
  updateExecutiveCommand,
  trainExecutiveCommand,
  scheduleExecutiveTrainingCommand,
  rushExecutiveTrainingCommand,
  cancelExecutiveTrainingCommand,
  createPoachingOfferCommand,
  getPoachingOffersQuery,
  getPoachingOfferByIdQuery,
  updatePoachingOfferCommand,
  dismissPoachingOfferCommand,
  refreshPoachingOfferCommand,
  researchEmployerCommand,
  getHostileOffersQuery,
  getHostileOfferByIdQuery,
  counterHostileOfferCommand,
  letGoHostileOfferCommand,
  rejectHostileOfferCommand,
  researchPoacherCommand,
  type CreatePoachingOfferInput,
  type CounterHostileOfferInput
} from '../application/executives/executive-use-cases.ts';
import { RouteRegistry, globalRouteRegistry, type HttpMethod } from '../http/route-registry.ts';

// Executive commands require an authenticated company; build the context
// once per request past the route-level ownership checks.
let _companyId: number | null = null;
function gameCtx(): GameContext {
  return createGameContext(_companyId as number, _companyId as number, 0);
}

export async function handleExecutiveRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  _companyId = currentCompanyId;
  // Current executives list (v3 & v4)
  const executiveCompanyMatch = pathname.match(/^\/api\/v(3|4)\/(?:companies|executives\/company)\/(\d+|me)\/executives\/?$/) ||
    pathname.match(/^\/api\/v4\/executives\/company\/(\d+|me)\/$/);
  if (
    pathname === '/api/v4/executives/' ||
    pathname === '/api/v4/executives' ||
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
      executives: getCompanyExecutivesQuery(currentCompanyId),
      candidates: getExecutiveCandidatesQuery(currentCompanyId),
      offers: getPoachingOffersQuery(currentCompanyId),
      hostileOffers: getHostileOffersQuery(currentCompanyId),
      achievements: []
    });
    return true;
  }

  // My Offers - Collection (GET & POST)
  if (pathname === '/api/v2/companies/executives/my-offers/' || pathname === '/api/v2/companies/executives/my-offers') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'GET') {
      sendJson(res, { offers: getPoachingOffersQuery(currentCompanyId) });
      return true;
    }
    if (method === 'POST') {
      if (requireCapability(res, currentCompanyId, 'executives', 'create poaching offer')) return true;
      const body = await readJsonBody<CreatePoachingOfferInput>(req);
      try {
        const offer = await createPoachingOfferCommand(gameCtx(), body);
        sendJson(res, {
          ...offer,
          offer,
          success: true,
          offerId: offer.id,
          status: offer.status
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  // My Offers - Single Item (/api/v2/companies/executives/my-offers/:id/)
  const myOfferItemMatch = pathname.match(/^\/api\/v2\/companies\/executives\/my-offers\/(\d+)\/?$/);
  if (myOfferItemMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const offerId = Number(myOfferItemMatch[1]);

    if (method === 'GET') {
      try {
        const offer = getPoachingOfferById(currentCompanyId, offerId);
        sendJson(res, { ...offer, offer });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 404);
      }
      return true;
    }

    if (method === 'PATCH') {
      if (requireCapability(res, currentCompanyId, 'executives', 'update poaching offer')) return true;
      const body = await readJsonBody<{ status?: string; executive?: boolean; salary?: number; accelerated?: boolean }>(req);
      try {
        const offer = await updatePoachingOfferCommand(gameCtx(), offerId, body);
        sendJson(res, {
          ...offer,
          offer,
          success: true,
          offerId: offer.id,
          status: offer.status,
          moneyDelta: 0
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if (method === 'PUT') {
      // Research employer (spends 5 SimBoosts)
      if (requireCapability(res, currentCompanyId, 'executives', 'research employer')) return true;
      try {
        const result = await researchEmployerCommand(gameCtx(), offerId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if (method === 'POST') {
      // Refresh / re-roll offer
      if (requireCapability(res, currentCompanyId, 'executives', 'refresh offer')) return true;
      try {
        const offer = await refreshPoachingOfferCommand(gameCtx(), offerId);
        sendJson(res, { ...offer, offer });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if (method === 'DELETE') {
      // Dismiss offer
      if (requireCapability(res, currentCompanyId, 'executives', 'dismiss offer')) return true;
      try {
        const result = await dismissPoachingOfferCommand(gameCtx(), offerId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  // Hostile Offers - Counter Endpoint (/api/v3/companies/executives/hostile-offers/:id/counter/)
  const hostileCounterMatch = pathname.match(/^\/api\/v3\/companies\/executives\/hostile-offers\/(\d+)\/counter\/?$/);
  if (hostileCounterMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'executives', 'counter hostile offer')) return true;
    const offerId = Number(hostileCounterMatch[1]);
    const body = await readJsonBody<CounterHostileOfferInput>(req);
    try {
      const result = await counterHostileOfferCommand(gameCtx(), offerId, body);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Hostile Offers - Collection (GET)
  if (pathname === '/api/v3/companies/executives/hostile-offers/' || pathname === '/api/v3/companies/executives/hostile-offers') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, { offers: getHostileOffersQuery(currentCompanyId) });
    return true;
  }

  // Hostile Offers - Single Item (/api/v3/companies/executives/hostile-offers/:id/)
  const hostileItemMatch = pathname.match(/^\/api\/v3\/companies\/executives\/hostile-offers\/(\d+)\/?$/);
  if (hostileItemMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const offerId = Number(hostileItemMatch[1]);

    if (method === 'GET') {
      try {
        const offer = getHostileOfferById(currentCompanyId, offerId);
        sendJson(res, { ...offer, offer });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 404);
      }
      return true;
    }

    if (method === 'PATCH') {
      // Let go to competitor (accept poaching)
      if (requireCapability(res, currentCompanyId, 'executives', 'let go executive')) return true;
      try {
        const result = await letGoHostileOfferCommand(gameCtx(), offerId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if (method === 'PUT') {
      // Research poacher (spends 5 SimBoosts)
      if (requireCapability(res, currentCompanyId, 'executives', 'research poacher')) return true;
      try {
        const result = await researchPoacherCommand(gameCtx(), offerId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if (method === 'DELETE') {
      // Reject offer
      if (requireCapability(res, currentCompanyId, 'executives', 'reject hostile offer')) return true;
      try {
        const result = await rejectHostileOfferCommand(gameCtx(), offerId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  // Former executives
  if (pathname.startsWith('/api/') && pathname.includes('/former-executives/')) {
    sendJson(res, { executives: [] });
    return true;
  }

  // Candidates list
  if (pathname === '/api/v4/executives/candidates/' || pathname === '/api/v4/executives/candidates') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getExecutiveCandidatesQuery(currentCompanyId));
    return true;
  }

  // Hire executive
  if ((pathname === '/api/v4/executives/hire/' || pathname === '/api/v4/executives/hire') && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'executives', 'hire executive')) return true;
    const body = await readJsonBody<{ candidateId: number; position?: string }>(req);
    try {
      const exec = await hireExecutiveCommand(gameCtx(), body.candidateId, body.position || 'unassigned');
      sendJson(res, { executive: exec });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Fire executive (/api/v4/executives/:id/fire/ or DELETE /api/v4/executives/:id/)
  const fireMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/fire\/?$/);
  if (fireMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'executives', 'fire executive')) return true;
    const execId = Number(fireMatch[1]);
    try {
      const result = await fireExecutiveCommand(gameCtx(), execId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Assign executive position (/api/v4/executives/:id/assign/)
  const assignMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/assign\/?$/);
  if (assignMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'executives', 'assign executive')) return true;
    const execId = Number(assignMatch[1]);
    const body = await readJsonBody<{ position: string }>(req);
    try {
      const exec = await assignExecutiveCommand(gameCtx(), execId, body.position);
      sendJson(res, { executive: exec });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Train executive (/api/v4/executives/:id/train/)
  const trainMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/train\/?$/);
  if (trainMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'executives', 'train executive')) return true;
    const execId = Number(trainMatch[1]);
    try {
      const result = await trainExecutiveCommand(gameCtx(), execId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Executive trainings lifecycle (/api/v4/executives/:id/trainings/...).
  // Issue #165: the original client POSTs a scheduled training (money cost),
  // PATCHes it to rush with SimBoosts, and DELETEs it to cancel.
  const trainingsBaseMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/?$/);
  if (trainingsBaseMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'executives', 'train executive')) return true;
    try {
      const result = await scheduleExecutiveTrainingCommand(gameCtx(), Number(trainingsBaseMatch[1]));
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  const trainingItemMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/(\d+)\/?$/);
  if (trainingItemMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'executives', 'train executive')) return true;
    try {
      const result = method === 'PATCH'
        ? await rushExecutiveTrainingCommand(gameCtx(), Number(trainingItemMatch[1]), Number(trainingItemMatch[2]))
        : await cancelExecutiveTrainingCommand(gameCtx(), Number(trainingItemMatch[1]), Number(trainingItemMatch[2]));
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Executive item details, updates, dismissal (/api/v4/executives/:id/)
  const execItemMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/?$/);
  if (execItemMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const execId = Number(execItemMatch[1]);

    if (method === 'GET') {
      try {
        const exec = getExecutiveByIdQuery(currentCompanyId, execId);
        sendJson(res, {
          ...exec,
          executive: exec
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 404);
      }
      return true;
    }

    if (method === 'PATCH') {
      if (requireCapability(res, currentCompanyId, 'executives', 'update executive')) return true;
      const body = await readJsonBody<{ salary?: number; position?: string; strikeUntil?: string | null; plansToRetire?: boolean; rushSettle?: boolean }>(req);
      try {
        const exec = await updateExecutiveCommand(gameCtx(), execId, body);
        sendJson(res, {
          ...exec,
          executive: exec
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if (method === 'DELETE') {
      // Dismiss executive with severance
      if (requireCapability(res, currentCompanyId, 'executives', 'fire executive')) return true;
      try {
        const result = await fireExecutiveCommand(gameCtx(), execId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  return false;
}

export function registerExecutiveRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const register = (method: HttpMethod, pattern: string): void => {
    registry.register({
      method,
      pattern,
      owner: 'executives',
      handler: async (req, res, ctx, _params, body) => {
        if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
          setPreparsedBody(req, body);
        }
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        await handleExecutiveRoutes(req, res, pathname, method, ctx?.companyId ?? null);
      }
    });
  };

  register('GET', '/api/v4/executives/');
  register('GET', '/api/v3/companies/:companyId/executives/');
  register('GET', '/api/v4/companies/:companyId/executives/');
  register('GET', '/api/v3/executives/company/:companyId/executives/');
  register('GET', '/api/v4/executives/company/:companyId/');
  register('GET', '/api/v2/companies/executives/my-offers/');
  register('POST', '/api/v2/companies/executives/my-offers/');
  register('GET', '/api/v2/companies/executives/my-offers/:offerId/');
  register('PATCH', '/api/v2/companies/executives/my-offers/:offerId/');
  register('PUT', '/api/v2/companies/executives/my-offers/:offerId/');
  register('POST', '/api/v2/companies/executives/my-offers/:offerId/');
  register('DELETE', '/api/v2/companies/executives/my-offers/:offerId/');
  register('POST', '/api/v3/companies/executives/hostile-offers/:offerId/counter/');
  register('GET', '/api/v3/companies/executives/hostile-offers/');
  register('GET', '/api/v3/companies/executives/hostile-offers/:offerId/');
  register('PATCH', '/api/v3/companies/executives/hostile-offers/:offerId/');
  register('PUT', '/api/v3/companies/executives/hostile-offers/:offerId/');
  register('DELETE', '/api/v3/companies/executives/hostile-offers/:offerId/');
  register('GET', '/api/v3/:scope/:realmId/former-executives/');
  register('GET', '/api/v4/:scope/:realmId/former-executives/');
  register('GET', '/api/v2/companies/:companyId/former-executives/');
  register('GET', '/api/v4/executives/candidates/');
  register('POST', '/api/v4/executives/hire/');
  register('POST', '/api/v4/executives/:executiveId/fire/');
  register('POST', '/api/v4/executives/:executiveId/assign/');
  register('POST', '/api/v4/executives/:executiveId/train/');
  register('POST', '/api/v4/executives/:executiveId/trainings/');
  register('PATCH', '/api/v4/executives/:executiveId/trainings/:trainingId/');
  register('DELETE', '/api/v4/executives/:executiveId/trainings/:trainingId/');
  register('GET', '/api/v4/executives/:executiveId/');
  register('PATCH', '/api/v4/executives/:executiveId/');
  register('DELETE', '/api/v4/executives/:executiveId/');
}

registerExecutiveRoutes(globalRouteRegistry);
