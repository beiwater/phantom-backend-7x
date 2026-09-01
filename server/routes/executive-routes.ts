import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, requireCapability } from './utils.ts';
import {
  getCompanyExecutives,
  getExecutiveCandidates,
  getExecutiveById,
  hireExecutive,
  fireExecutive,
  assignExecutive,
  updateExecutive,
  trainExecutive,
  createPoachingOffer,
  getPoachingOffers,
  getPoachingOfferById,
  updatePoachingOffer,
  dismissPoachingOffer,
  refreshPoachingOffer,
  researchEmployerByPoacher,
  getHostileOffers,
  getHostileOfferById,
  counterHostileOffer,
  letGoHostileOffer,
  rejectHostileOffer,
  researchPoacherByEmployer,
  type CreatePoachingOfferInput,
  type CounterHostileOfferInput
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
      executives: getCompanyExecutives(currentCompanyId),
      candidates: getExecutiveCandidates(currentCompanyId),
      offers: getPoachingOffers(currentCompanyId),
      hostileOffers: getHostileOffers(currentCompanyId),
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
      sendJson(res, { offers: getPoachingOffers(currentCompanyId) });
      return true;
    }
    if (method === 'POST') {
      if (requireCapability(res, currentCompanyId, 'executives', 'create poaching offer')) return true;
      const body = await readJsonBody<CreatePoachingOfferInput>(req);
      try {
        const offer = await createPoachingOffer(currentCompanyId, body);
        sendJson(res, { ...offer, offer });
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
        const offer = await updatePoachingOffer(currentCompanyId, offerId, body);
        sendJson(res, { ...offer, offer, moneyDelta: 0 });
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
        const result = await researchEmployerByPoacher(currentCompanyId, offerId);
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
        const offer = await refreshPoachingOffer(currentCompanyId, offerId);
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
        const result = await dismissPoachingOffer(currentCompanyId, offerId);
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
      const result = await counterHostileOffer(currentCompanyId, offerId, body);
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
    sendJson(res, { offers: getHostileOffers(currentCompanyId) });
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
        const result = await letGoHostileOffer(currentCompanyId, offerId);
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
        const result = await researchPoacherByEmployer(currentCompanyId, offerId);
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
        const result = await rejectHostileOffer(currentCompanyId, offerId);
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
    sendJson(res, getExecutiveCandidates(currentCompanyId));
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
      const exec = await hireExecutive(currentCompanyId, body.candidateId, body.position || 'unassigned');
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
      const result = await fireExecutive(currentCompanyId, execId);
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
      const exec = await assignExecutive(currentCompanyId, execId, body.position);
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
      const result = await trainExecutive(currentCompanyId, execId);
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
        const exec = getExecutiveById(currentCompanyId, execId);
        sendJson(res, { executive: exec });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 404);
      }
      return true;
    }

    if (method === 'PATCH') {
      if (requireCapability(res, currentCompanyId, 'executives', 'update executive')) return true;
      const body = await readJsonBody<{ salary?: number; position?: string; strikeUntil?: string | null; plansToRetire?: boolean }>(req);
      try {
        const exec = await updateExecutive(currentCompanyId, execId, body);
        sendJson(res, { executive: exec });
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
        const result = await fireExecutive(currentCompanyId, execId);
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
