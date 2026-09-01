import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { sendDomainError } from '../compatibility/simcompanies/response-helpers.ts';
import {
  addArticleReaction,
  removeArticleReaction,
  getCompanyReactionsForNewspaper,
  getArticleById,
  getNewspaperIssues,
  getNewspaperIssue,
  getCurrentBookableIssue,
  getSponsorParams,
  getSponsorsForNewspaper,
  buyNewspaperSponsor,
  getTopArticlesByReaction,
  TOP_ARTICLES_LIMIT
} from '../game/newspaper.ts';

const REACTION_TYPES = new Set(['THUMBS_UP', 'REWARD']);

/**
 * Issue #83 — Newspaper routes (ad slots, reward reactions, top articles).
 *
 * Dispatched from router.ts BEFORE the legacy social handler: social's
 * hardcoded sponsor-params / top-by-reaction stubs would otherwise shadow
 * the real endpoints below. Every handler returns false for paths it does
 * not own so the rest of the social surface keeps working unchanged.
 */
export async function handleNewspaperRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  _currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  try {
    // 1. Sponsor params (Redux `newspaper.sponsorParams`) — public pricing metadata.
    if (pathname === '/api/v2/newspaper/sponsor-params/' && method === 'GET') {
      sendJson(res, getSponsorParams());
      return true;
    }

    // 2. Per-issue sponsors incl. tier pricing (§3: GET /api/v3/newspaper/{id}/sponsor/).
    const v3SponsorMatch = pathname.match(/^\/api\/v3\/newspaper\/(\d+)\/sponsor\/$/);
    if (v3SponsorMatch && method === 'GET') {
      sendJson(res, getSponsorsForNewspaper(Number(v3SponsorMatch[1])));
      return true;
    }

    // 3. Sponsor slots of the current bookable (unpublished) issue of a realm.
    const sponsorListMatch = pathname.match(/^\/api\/v2\/newspaper\/[^/]+\/(\d+)\/sponsor\/$/);
    if (sponsorListMatch && method === 'GET') {
      const realmId = Number(sponsorListMatch[1]);
      const issue = getCurrentBookableIssue(realmId);
      sendJson(res, {
        newspaperId: issue.id,
        issueId: issue.issue_id,
        realmId,
        published: issue.published,
        ...getSponsorsForNewspaper(issue.id)
      });
      return true;
    }

    // 4. Book an ad slot on the current bookable issue (deducts SimBoosts).
    const sponsorBookMatch = pathname.match(/^\/api\/v2\/newspaper\/[^/]+\/(\d+)\/sponsor\/(\d+)\/$/);
    if (sponsorBookMatch && method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Authentication required', code: 'UNAUTHORIZED' }, 401);
        return true;
      }
      const body = await readJsonBody<{ text?: string }>(req);
      const realmId = Number(sponsorBookMatch[1]);
      const slot = Number(sponsorBookMatch[2]);
      const issue = getCurrentBookableIssue(realmId);
      const booked = buyNewspaperSponsor(issue.id, slot, currentCompanyId, typeof body?.text === 'string' ? body.text : undefined);
      sendJson(res, {
        ...booked,
        newspaperId: issue.id,
        issueId: issue.issue_id,
        realmId
      });
      return true;
    }

    // 5. v2 reactions endpoint: POST books a reaction (REWARD tips 5 SimBoosts),
    //    DELETE toggles it off (no refund for tips).
    const v2ReactionMatch = pathname.match(/^\/api\/v2\/articles\/(\d+)\/reactions\/$/);
    if (v2ReactionMatch && (method === 'POST' || method === 'DELETE')) {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Authentication required', code: 'UNAUTHORIZED' }, 401);
        return true;
      }
      const body = await readJsonBody<{ type?: string }>(req);
      const queryType = new URL(req.url || '/', 'http://localhost').searchParams.get('type');
      const type = String(body?.type ?? queryType ?? 'THUMBS_UP').toUpperCase();
      if (!REACTION_TYPES.has(type)) {
        sendJson(res, { error: `Unknown reaction type: ${type}`, code: 'UNKNOWN_REACTION' }, 400);
        return true;
      }
      const articleId = Number(v2ReactionMatch[1]);
      const result = method === 'POST'
        ? addArticleReaction(articleId, currentCompanyId, type)
        : removeArticleReaction(articleId, currentCompanyId, type);
      sendJson(res, result);
      return true;
    }

    // 6. v1 spec reactions (§4): PATCH adds, DELETE removes, explicit type in path.
    const v1ReactionMatch = pathname.match(/^\/api\/v1\/article\/(\d+)\/reaction\/([A-Za-z_]+)\/$/);
    if (v1ReactionMatch && (method === 'PATCH' || method === 'DELETE')) {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Authentication required', code: 'UNAUTHORIZED' }, 401);
        return true;
      }
      const type = String(v1ReactionMatch[2]).toUpperCase();
      if (!REACTION_TYPES.has(type)) {
        sendJson(res, { error: `Unknown reaction type: ${type}`, code: 'UNKNOWN_REACTION' }, 400);
        return true;
      }
      const articleId = Number(v1ReactionMatch[1]);
      const result = method === 'PATCH'
        ? addArticleReaction(articleId, currentCompanyId, type)
        : removeArticleReaction(articleId, currentCompanyId, type);
      sendJson(res, result);
      return true;
    }

    // 7. The reader's own reactions for a newspaper issue (§4: toggle state).
    const v1ReactionListMatch = pathname.match(/^\/api\/v1\/newspaper\/(\d+)\/reaction\/$/);
    if (v1ReactionListMatch && method === 'GET') {
      if (!currentCompanyId) {
        sendJson(res, []);
        return true;
      }
      sendJson(res, getCompanyReactionsForNewspaper(Number(v1ReactionListMatch[1]), currentCompanyId));
      return true;
    }

    // 8. Top articles leaderboard: ranked by total upvotes + tips (§6, gsr = 15).
    const topMatch = pathname.match(/^\/api\/v2\/[^/]+\/(\d+)\/articles\/top-by-reaction\/([A-Za-z0-9_]+)\/$/);
    if (topMatch && method === 'GET') {
      sendJson(res, getTopArticlesByReaction(Number(topMatch[1]), topMatch[2].toUpperCase(), TOP_ARTICLES_LIMIT));
      return true;
    }

    // 9. Single article fetch (§1: api_v3_article_get).
    const v3ArticleMatch = pathname.match(/^\/api\/v3\/newspaper\/(\d+)\/article\/(\d+)\/$/);
    if (v3ArticleMatch && method === 'GET') {
      const article = getArticleById(Number(v3ArticleMatch[2]));
      if (!article) {
        sendJson(res, { error: 'Article not found', code: 'NOT_FOUND' }, 404);
        return true;
      }
      sendJson(res, article);
      return true;
    }

    // 10. Newspaper issue list + single issue (§1: real data instead of stubs).
    const v3IssueListMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/$/);
    if (v3IssueListMatch && method === 'GET') {
      const belowIdRaw = new URL(req.url || '/', 'http://localhost').searchParams.get('below_id');
      const belowId = belowIdRaw !== null && !isNaN(Number(belowIdRaw)) ? Number(belowIdRaw) : undefined;
      sendJson(res, getNewspaperIssues(Number(v3IssueListMatch[1]), belowId, 20));
      return true;
    }
    const v3IssueMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/(\d+)\/$/);
    if (v3IssueMatch && method === 'GET') {
      const issue = getNewspaperIssue(Number(v3IssueMatch[2]), Number(v3IssueMatch[1]));
      if (!issue) {
        sendJson(res, { error: 'Newspaper issue not found', code: 'NOT_FOUND' }, 404);
        return true;
      }
      sendJson(res, issue);
      return true;
    }

    return false;
  } catch (err: unknown) {
    sendDomainError(res, err);
    return true;
  }
}
