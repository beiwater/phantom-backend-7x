import type { IncomingMessage, ServerResponse } from "node:http";
import { RouteRegistry, globalRouteRegistry } from "../http/route-registry.ts";
import { sendJson } from "./utils.ts";
import { getArticlesByAuthor } from "../game/newspaper.ts";
import {
  type ChatroomSubscriptionEntry,
  DEFAULT_CHATROOMS,
  CHATROOM_PRESETS,
  getConfiguredChatrooms,
  setConfiguredChatrooms,
  handleChatSubroutes
} from "./social/chat-subroutes.ts";
import { handleProfileSubroutes } from "./social/profile-subroutes.ts";
import { handleActivitySubroutes } from "./social/activity-subroutes.ts";

export {
  type ChatroomSubscriptionEntry,
  DEFAULT_CHATROOMS,
  CHATROOM_PRESETS,
  getConfiguredChatrooms,
  setConfiguredChatrooms
};

export async function handleSocialRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  if (await handleChatSubroutes(req, res, pathname, method, currentCompanyId)) return true;
  if (await handleProfileSubroutes(req, res, pathname, method, currentCompanyId)) return true;
  if (await handleActivitySubroutes(req, res, pathname, method, currentCompanyId)) return true;
  return false;
}

export function registerSocialRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  // Public articles by author
  registry.register({
    method: "GET",
    pattern: "/api/v2/newspaper/articles-by-author/:authorId/",
    owner: "social",
    handler: async (_req, res, _ctx, params) => {
      const authorId = Number(params?.authorId || 0);
      sendJson(res, getArticlesByAuthor(authorId));
    }
  });

  // Royalties are explicitly contract-blocked until the upstream rate and
  // tenure formula is available. Keep the real endpoint exact and guarded;
  // its handler returns 501 instead of a misleading zero balance.
  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/:companyId(\\d+)/royalties/',
    auth: 'company',
    owner: 'social',
    handler: async (req, res, ctx, params) => {
      await handleActivitySubroutes(
        req,
        res,
        `/api/v2/companies/${params.companyId}/royalties/`,
        'GET',
        ctx?.companyId ?? null
      );
    }
  });

  const delegate = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', pattern: string) => {
    registry.register({
      method,
      pattern,
      owner: 'social',
      handler: async (req, res, ctx) => {
        const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
        await handleSocialRoutes(req, res, pathname, method, ctx?.companyId ?? null);
      }
    });
  };

  // Explicit registrations for the live chat/profile/activity endpoints that
  // were still reachable only through router.ts's catch-all social handler.
  // The delegated handlers retain their existing ownership checks and body
  // contracts; the registry now owns their method and path selection.
  delegate('GET', '/api/v2/error-announcement/');
  delegate('POST', '/api/v2/error-announcement/');
  delegate('GET', '/api/v2/contacts/');
  delegate('PATCH', '/api/v2/contacts/:companyId(\\d+)/');
  delegate('DELETE', '/api/v2/contacts/:companyId(\\d+)/');
  delegate('GET', '/api/v2/help-chatroom/');
  delegate('POST', '/api/v2/message/');
  delegate('POST', '/api/v2/messages/');
  delegate('GET', '/api/messages/');
  delegate('PATCH', '/api/messages/');
  delegate('GET', '/api/messages_by_company/');
  delegate('GET', '/api/courses/');
  delegate('POST', '/api/courses/');
  delegate('GET', '/api/courses/:courseId(\\d+)/');
  delegate('PATCH', '/api/courses/:courseId(\\d+)/');
  delegate('DELETE', '/api/courses/:courseId(\\d+)/');
  delegate('POST', '/api/courses/:courseId(\\d+)/join/');
  delegate('GET', '/api/v1/challenges/current/');
  delegate('POST', '/api/v1/challenges/attempt/');
  delegate('POST', '/api/v1/challenges/restart/');
  delegate('GET', '/api/v1/challenges/:challengeId(\\d+)/leaderboard/');
  delegate('GET', '/api/v2/players/unlocked-hqs/');
  delegate('POST', '/api/v2/players/unlocked-hqs/');
  delegate('GET', '/api/v2/players/unlocked-pas/');
  delegate('POST', '/api/v2/players/unlocked-pas/');
}

registerSocialRoutes(globalRouteRegistry);
