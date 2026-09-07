import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../utils.ts";
import { gameNotificationsRepository } from "../../repositories/game-notifications-repository.ts";
import { socialRepository } from "../../repositories/social-repository.ts";
import { getCompanyById } from "../../game/company.ts";
import { virtualClock } from "../../core/virtual-clock.ts";
import {
  getArticlesByAuthor,
  getArticlesBySubstring,
  getNewspaperIssue,
  getNewspaperIssues,
  getTopArticlesByReaction
} from "../../game/newspaper.ts";

const VALID_NOTIFICATION_KINDS = new Set([
  "EXECUTIVE_OFFER",
  "EXECUTIVE_TRAINING_FINISHED",
  "AGENCY_FAILED",
  "AGENCY_FOUND_EXECUTIVE",
  "EXECUTIVE_STAYED",
  "EXECUTIVE_DECLINED_OFFER",
  "EXECUTIVES_STRIKE",
  "EXECUTIVES_LEFT",
  "EXECUTIVE_WILL_RETIRE",
  "EXECUTIVE_RETIRED",
  "EXECUTIVE_ACCEPTED_OFFER",
  "EXECUTIVE_LEFT",
  "EXECUTIVE_WANTED_TO_ACCEPT_OFFER",
  "EXECUTIVE_BURNOUT",
  "TAGS_EXPIRED",
  "SEASON_START",
  "SEASON_END"
]);

export async function handleProfileSubroutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Public profile articles by author.
  const authorMatch = pathname.match(/^\/api\/v2\/newspaper\/articles-by-author\/(\d+)\/$/);
  if (authorMatch && method === "GET") {
    const authorId = Number(authorMatch[1]);
    sendJson(res, getArticlesByAuthor(authorId));
    return true;
  }

  // Free-text / company bio
  const freeTextMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/free-text\/?$/);
  if (freeTextMatch) {
    const targetIdStr = freeTextMatch[1];
    const targetCompanyId = targetIdStr === "me" ? currentCompanyId : Number(targetIdStr);
    if (!targetCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    if (method === "GET") {
      const comp = getCompanyById(targetCompanyId);
      sendJson(res, comp?.note || "");
      return true;
    }
    if (method === "POST") {
      if (!currentCompanyId || targetCompanyId !== currentCompanyId) {
        sendJson(res, { error: "Unauthorized" }, 401);
        return true;
      }
      const body = await readJsonBody<{ freeText?: string }>(req);
      const newText = String(body?.freeText ?? "").slice(0, 2000);
      socialRepository.setCompanyNote(newText, targetCompanyId);
      sendJson(res, newText);
      return true;
    }
  }

  // Player notifications settings: /api/v2/players/notifications/:id
  const playerNotificationsMatch = pathname.match(/^\/api\/v2\/players\/notifications(?:\/(\d+))?\/?$/);
  if (playerNotificationsMatch) {
    const CATEGORIES = ["emailNotifications", "popupNotifications", "pushNotifications"] as const;
    const loadRow = (): Record<string, Record<string, boolean>> => {
      const row = socialRepository.getNotificationPreferences(currentCompanyId ?? -1);
      const parse = (raw: string | undefined): Record<string, boolean> => {
        if (!raw) return {};
        try { return JSON.parse(raw); } catch { return {}; }
      };
      return {
        emailNotifications: parse(row?.email_json),
        popupNotifications: parse(row?.popup_json),
        pushNotifications: parse(row?.push_json)
      };
    };

    if (method === "GET") {
      if (!currentCompanyId) {
        sendJson(res, { error: "Unauthorized" }, 401);
        return true;
      }
      sendJson(res, loadRow());
      return true;
    }
    if (method === "PUT") {
      if (!currentCompanyId) {
        sendJson(res, { error: "Unauthorized" }, 401);
        return true;
      }
      const body = await readJsonBody<{ category?: string; emailNotifications?: Record<string, boolean>; popupNotifications?: Record<string, boolean>; pushNotifications?: Record<string, boolean> }>(req);
      const category = String(body?.category ?? "");
      if (!(CATEGORIES as readonly string[]).includes(category)) {
        sendJson(res, { error: "Unknown notification category" }, 400);
        return true;
      }
      const { category: _drop, ...rest } = body ?? {};
      void _drop;
      const flags = rest[category] ?? {};
      const column = category === "emailNotifications" ? "email_json"
        : category === "popupNotifications" ? "popup_json" : "push_json";
      socialRepository.upsertNotificationPreferences(currentCompanyId, column, JSON.stringify(flags), virtualClock.nowIso());
      sendJson(res, loadRow());
      return true;
    }
    if (method === "POST") {
      sendJson(res, { sent: true });
      return true;
    }
  }

  // Game Notifications: /api/v2/game-notifications/, /api/v2/companies/:id/game-notifications/
  const gameNotificationsMatch =
    pathname === "/api/v2/game-notifications/" ||
    pathname === "/api/v2/game-notifications" ||
    pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/game-notifications\/(?:\d+\/)?$/);
  if (gameNotificationsMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    if (method === "DELETE") {
      gameNotificationsRepository.markAllRead(currentCompanyId);
      sendJson(res, { success: true });
      return true;
    }
    const rawList = gameNotificationsRepository.list(currentCompanyId);
    const validNotifications = rawList
      .filter(n => VALID_NOTIFICATION_KINDS.has(n.type))
      .map(n => ({
        id: n.id,
        notificationKind: n.type,
        read: n.read,
        datetime: n.createdAt,
        executive: n.payload?.executive || null,
        season: n.payload?.season || null
      }));
    const unreadCount = validNotifications.filter(n => !n.read).length;
    sendJson(res, {
      notifications: validNotifications,
      unreadCount
    });
    return true;
  }

  // Private notes about other companies: /api/v2/companies/me/my-note/
  const myNoteMatch = pathname.match(/^\/api\/v2\/companies\/me\/my-note\/?$/);
  if (myNoteMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody<{ note?: string }>(req);
      const noteText = String(body?.note ?? "").slice(0, 4000);
      socialRepository.setCompanyNote(noteText, currentCompanyId);
      sendJson(res, noteText);
      return true;
    }
    const comp = getCompanyById(currentCompanyId);
    sendJson(res, comp?.note ?? "");
    return true;
  }

  const noteListMatch = pathname.match(/^\/api\/v2\/companies\/me\/note\/(\d+)?\/?$/);
  if (noteListMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    const aboutCompanyId = noteListMatch[1] ? Number(noteListMatch[1]) : null;

    if (method === "GET") {
      if (aboutCompanyId) {
        sendJson(res, { note: socialRepository.getCompanyNote(currentCompanyId, aboutCompanyId) ?? "" });
        return true;
      }
      const rows = socialRepository.listCompanyNotes(currentCompanyId);
      sendJson(res, rows.map(row => ({
        id: row.id,
        note: row.note,
        about: {
          id: row.company_id,
          company: row.name,
          logo: row.logo || "",
          realmId: row.realm_id ?? 0,
          deleted: false,
          online: "n/a"
        }
      })));
      return true;
    }

    if (!aboutCompanyId) {
      sendJson(res, { error: "Company id required" }, 400);
      return true;
    }

    if (method === "POST") {
      const body = await readJsonBody<{ note?: string }>(req);
      const noteText = String(body?.note ?? "").slice(0, 4000);
      const now = virtualClock.nowIso();
      if (noteText === "") {
        socialRepository.deleteCompanyNote(currentCompanyId, aboutCompanyId);
        sendJson(res, { note: "" });
        return true;
      }
      socialRepository.upsertCompanyNote(currentCompanyId, aboutCompanyId, noteText, now, now);
      sendJson(res, { note: noteText });
      return true;
    }

    if (method === "PUT") {
      const body = await readJsonBody<{ priority?: string }>(req);
      const direction = String(body?.priority ?? "");
      const noteId = socialRepository.getCompanyNoteId(currentCompanyId, aboutCompanyId);
      if (!noteId) {
        sendJson(res, { error: "Note not found" }, 404);
        return true;
      }
      if (direction === "up") {
        socialRepository.decrementCompanyNotePriority(noteId);
      } else if (direction === "down") {
        socialRepository.incrementCompanyNotePriority(noteId);
      }
      sendJson(res, { success: true });
      return true;
    }

    if (method === "DELETE") {
      socialRepository.deleteCompanyNote(currentCompanyId, aboutCompanyId);
      sendJson(res, { success: true });
      return true;
    }
  }

  // Company list / search
  const companyListMatch = pathname.match(/^\/api\/v2\/companies\/list\/(\d+)\/([^/]+)\/$/);
  if (companyListMatch && method === "GET") {
    const realmId = Number(companyListMatch[1]);
    const query = decodeURIComponent(companyListMatch[2]).replace(/-/g, " ").trim();
    if (query.length < 1) {
      sendJson(res, []);
      return true;
    }
    const rows = socialRepository.searchCompaniesByRealm(realmId, query);
    sendJson(res, rows.map(row => ({
      companyId: row.company_id,
      company: row.name,
      logo: row.logo || "",
      realmId: row.realm_id ?? 0,
      deleted: false
    })));
    return true;
  }

  // Newspaper article lookups
  const articlesSubstringMatch = pathname.match(/^\/api\/v2\/newspaper\/articles-by-substring\/(\d+)\/([^/]+)\/$/);
  if (articlesSubstringMatch && method === "GET") {
    const realmId = Number(articlesSubstringMatch[1]);
    const query = decodeURIComponent(articlesSubstringMatch[2]);
    sendJson(res, getArticlesBySubstring(realmId, query));
    return true;
  }

  const newspaperIssueMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/(\d+)\/$/);
  if (newspaperIssueMatch) {
    const realmId = Number(newspaperIssueMatch[1]);
    const issueId = Number(newspaperIssueMatch[2]);
    const issue = getNewspaperIssue(issueId, realmId);
    if (!issue) {
      sendJson(res, { error: "Newspaper issue not found" }, 404);
      return true;
    }
    sendJson(res, issue);
    return true;
  }

  const newspaperListMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/$/);
  if (newspaperListMatch) {
    const realmId = Number(newspaperListMatch[1]);
    const search = new URL(req.url || "", "http://127.0.0.1").searchParams;
    const belowId = search.get("belowId") !== null ? Number(search.get("belowId")) : undefined;
    const limit = search.get("limit") !== null ? Number(search.get("limit")) : undefined;
    sendJson(res, getNewspaperIssues(realmId, belowId, limit ?? 20));
    return true;
  }

  const topArticlesMatch = pathname.match(/^\/api\/v2\/[^/]+\/(\d+)\/articles\/top-by-reaction\/(\d+)\/$/);
  if (topArticlesMatch) {
    const realmId = Number(topArticlesMatch[1]);
    sendJson(res, { topArticles: getTopArticlesByReaction(realmId) });
    return true;
  }

  if (pathname.startsWith("/api/") && pathname.includes("/newspaper/") && pathname.includes("/reaction")) {
    sendJson(res, []);
    return true;
  }
  if (pathname.startsWith("/api/") && pathname.includes("/article/") && pathname.includes("/reaction")) {
    sendJson(res, { success: true });
    return true;
  }

  if (pathname === "/api/v2/newspaper/sponsor-params/") {
    sendJson(res, {
      sponsorCost: 500,
      sponsorBonus: 100,
      sponsorMinValuation: 100000
    });
    return true;
  }

  return false;
}
