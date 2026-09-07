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
}

registerSocialRoutes(globalRouteRegistry);
