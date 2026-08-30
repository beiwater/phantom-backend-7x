import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getCompanyExecutives,
  getExecutiveById,
  getExecutiveCandidates,
  rushCandidates,
  hireExecutive,
  fireExecutive,
  assignExecutive,
  updateExecutive,
  startTraining,
  rushTraining,
  cancelTraining,
  getMyOffers,
  createMyOffer,
  updateMyOffer,
  researchEmployer,
  dismissMyOffer,
  refreshMyOffer,
  getHostileOffers,
  letGoHostileOffer,
  rejectHostileOffer,
  getFormerExecutives,
  getExecutiveNote,
  setExecutiveNote,
  formatExecutive
} from '../game/executives.ts';

export async function handleExecutiveRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  const effectiveCompanyId = currentCompanyId || 4259175;

  // 1. Candidate Rush
  if (
    (pathname === '/api/v2/executives/candidates/rush/' ||
      pathname === '/api/v4/executives/candidates/rush/' ||
      pathname === '/api/v2/companies/executives/candidates/rush/' ||
      pathname.match(/^\/api\/v4\/executives\/company\/(\d+|me)\/candidates\/rush\/$/)) &&
    (method === 'POST' || method === 'PATCH')
  ) {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    try {
      const candidates = rushCandidates(effectiveCompanyId);
      return sendJson(res, { success: true, candidates }), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 2. Candidates list / generate
  if (
    pathname === '/api/v4/executives/candidates/' ||
    pathname === '/api/v2/executives/candidates/' ||
    pathname === '/api/v2/companies/executives/candidates/' ||
    pathname.match(/^\/api\/v4\/executives\/company\/(\d+|me)\/candidates\/$/)
  ) {
    if (method === 'POST') {
      try {
        const candidates = rushCandidates(effectiveCompanyId);
        return sendJson(res, candidates), true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendJson(res, { error: msg }, 400), true;
      }
    }
    return sendJson(res, getExecutiveCandidates(effectiveCompanyId)), true;
  }

  // 3. Poaching: My Offers (Poacher)
  if (pathname === '/api/v2/companies/executives/my-offers/' || pathname === '/api/v2/executives/my-offers/') {
    if (method === 'GET') {
      return sendJson(res, { offers: getMyOffers(effectiveCompanyId) }), true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
      const body = await readJsonBody<{ agency?: number; slotPosition?: string; skillPosition?: string }>(req);
      try {
        const offer = createMyOffer(effectiveCompanyId, body);
        return sendJson(res, offer), true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendJson(res, { error: msg }, 400), true;
      }
    }
  }

  const myOfferMatch = pathname.match(/^\/api\/v2\/(?:companies\/)?executives\/my-offers\/(\d+)\/$/);
  if (myOfferMatch) {
    const offerId = Number(myOfferMatch[1]);
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    try {
      if (method === 'PATCH') {
        const body = await readJsonBody<{ accelerated?: boolean; executive?: boolean; salary?: number }>(req);
        const updated = updateMyOffer(effectiveCompanyId, offerId, body);
        return sendJson(res, updated), true;
      }
      if (method === 'PUT') {
        const result = researchEmployer(effectiveCompanyId, offerId);
        return sendJson(res, result), true;
      }
      if (method === 'POST') {
        const refreshed = refreshMyOffer(effectiveCompanyId, offerId);
        return sendJson(res, refreshed), true;
      }
      if (method === 'DELETE') {
        const result = dismissMyOffer(effectiveCompanyId, offerId);
        return sendJson(res, result), true;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 4. Hostile Offers (Employer)
  if (
    pathname === '/api/v3/companies/executives/hostile-offers/' ||
    pathname === '/api/v2/executives/hostile-offers/' ||
    pathname === '/api/v2/companies/executives/hostile-offers/'
  ) {
    return sendJson(res, { offers: getHostileOffers(effectiveCompanyId) }), true;
  }

  const hostileOfferMatch = pathname.match(/^\/api\/v[23]\/(?:companies\/)?executives\/hostile-offers\/(\d+)\/$/);
  if (hostileOfferMatch) {
    const offerId = Number(hostileOfferMatch[1]);
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    try {
      if (method === 'PATCH') {
        const result = letGoHostileOffer(effectiveCompanyId, offerId);
        return sendJson(res, result), true;
      }
      if (method === 'PUT') {
        const result = researchEmployer(effectiveCompanyId, offerId);
        return sendJson(res, result), true;
      }
      if (method === 'DELETE') {
        const result = rejectHostileOffer(effectiveCompanyId, offerId);
        return sendJson(res, result), true;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 5. Former executives
  if (pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/former-executives\/$/) || pathname === '/api/v2/executives/former-executives/') {
    return sendJson(res, { executives: getFormerExecutives(effectiveCompanyId) }), true;
  }

  // 6. Executive Note
  const noteMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/note\/$/);
  if (noteMatch) {
    const execId = Number(noteMatch[1]);
    if (method === 'GET') {
      return sendJson(res, { note: getExecutiveNote(execId) }), true;
    }
    if (method === 'PATCH' || method === 'POST') {
      const body = await readJsonBody<{ note?: string }>(req);
      const note = setExecutiveNote(execId, body.note || '');
      return sendJson(res, { note }), true;
    }
  }

  // 7. Training Rush
  const trainingRushMatch =
    pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/(\d+)\/$/) ||
    pathname.match(/^\/api\/v2\/executives\/(\d+)\/training\/rush\/$/) ||
    pathname.match(/^\/api\/v4\/executives\/(\d+)\/rush\/$/) ||
    pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/rush\/$/);
  if (trainingRushMatch && (method === 'PATCH' || method === 'POST')) {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    const execId = Number(trainingRushMatch[1]);
    try {
      const result = rushTraining(effectiveCompanyId, execId);
      return sendJson(res, result), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 8. Cancel Training
  const trainingCancelMatch =
    (pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/(\d+)\/$/) && method === 'DELETE') ||
    ((pathname.match(/^\/api\/v2\/executives\/(\d+)\/training\/$/) || pathname.match(/^\/api\/v2\/executives\/(\d+)\/training\/cancel\/$/)) &&
      (method === 'DELETE' || method === 'POST'));
  if (trainingCancelMatch) {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    const execId = Number(trainingCancelMatch[1]);
    try {
      const result = cancelTraining(effectiveCompanyId, execId);
      return sendJson(res, result), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 9. Start Training
  const startTrainMatch =
    pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/$/) ||
    pathname.match(/^\/api\/v4\/executives\/(\d+)\/train\/$/) ||
    pathname.match(/^\/api\/v2\/executives\/(\d+)\/training\/$/);
  if (startTrainMatch && method === 'POST') {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    const execId = Number(startTrainMatch[1]);
    const body = await readJsonBody<{ training?: string }>(req);
    try {
      const result = startTraining(effectiveCompanyId, execId, body.training || 'g');
      return sendJson(res, result), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 10. Trainings query
  const queryTrainingsMatch =
    pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/(\d+)\/$/) ||
    pathname.match(/^\/api\/v4\/executives\/(\d+)\/trainings\/$/);
  if (queryTrainingsMatch && method === 'GET') {
    const execId = Number(queryTrainingsMatch[1]);
    const e = getExecutiveById(execId, effectiveCompanyId);
    return sendJson(res, { trainings: e ? formatExecutive(e).trainings : [] }), true;
  }

  // 11. Hire executive
  if (
    (pathname === '/api/v4/executives/hire/' ||
      pathname.match(/^\/api\/v4\/executives\/(\d+|me)\/$/) ||
      pathname.match(/^\/api\/v3\/companies\/(\d+|me)\/executives\/$/)) &&
    method === 'POST'
  ) {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    const body = await readJsonBody<{ candidateId?: number; position?: string; candidateData?: { name?: string; avatar?: string; skills?: Record<string, number>; salary?: number; age?: number } }>(req);
    try {
      const exec = hireExecutive(effectiveCompanyId, body.candidateId, body.position || 'unassigned', body.candidateData);
      return sendJson(res, { executive: exec }), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 12. Fire / Dismiss executive
  const fireMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/fire\/$/) || (pathname.match(/^\/api\/v4\/executives\/(\d+)\/$/) && method === 'DELETE');
  if (fireMatch && (method === 'POST' || method === 'DELETE')) {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    const execId = Number(fireMatch[1]);
    try {
      const result = fireExecutive(effectiveCompanyId, execId);
      return sendJson(res, result), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 13. Assign executive position
  const assignMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/assign\/$/);
  if (assignMatch && method === 'POST') {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    const execId = Number(assignMatch[1]);
    const body = await readJsonBody<{ position: string }>(req);
    try {
      const exec = assignExecutive(effectiveCompanyId, execId, body.position);
      return sendJson(res, { executive: exec }), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 14. Update executive (PATCH /api/v4/executives/:id/)
  const execPatchMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/$/);
  if (execPatchMatch && method === 'PATCH') {
    if (!currentCompanyId) return sendJson(res, { error: 'Unauthorized' }, 401), true;
    const execId = Number(execPatchMatch[1]);
    const body = await readJsonBody<{ salary?: number; position?: string; plansToRetire?: boolean; strikeUntil?: string | null; rushSettle?: boolean }>(req);
    try {
      const exec = updateExecutive(effectiveCompanyId, execId, body);
      return sendJson(res, { executive: exec }), true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, { error: msg }, 400), true;
    }
  }

  // 15. Single Executive detail (GET /api/v4/executives/:id/)
  const execGetMatch = pathname.match(/^\/api\/v4\/executives\/(\d+)\/$/);
  if (execGetMatch && method === 'GET') {
    const execId = Number(execGetMatch[1]);
    const e = getExecutiveById(execId, effectiveCompanyId);
    if (!e) return sendJson(res, { error: 'Executive not found' }, 404), true;
    return sendJson(res, formatExecutive(e)), true;
  }

  // 16. Current executives list (v3 & v4)
  if (
    pathname === '/api/v4/executives/' ||
    pathname.match(/^\/api\/v4\/executives\/company\/(\d+|me)\/$/) ||
    pathname.match(/^\/api\/v3\/companies\/(\d+|me)\/executives\/$/)
  ) {
    return sendJson(res, {
      executives: getCompanyExecutives(effectiveCompanyId),
      candidates: getExecutiveCandidates(effectiveCompanyId),
      offers: getMyOffers(effectiveCompanyId),
      hostileOffers: getHostileOffers(effectiveCompanyId),
      achievements: []
    }), true;
  }

  return false;
}
