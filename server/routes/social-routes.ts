import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { readJsonBody, sendJson } from './utils.ts';
import { gameNotificationsRepository } from '../repositories/game-notifications-repository.ts';
import { referralsRepository } from '../repositories/referrals-repository.ts';
import { socialRepository } from '../repositories/social-repository.ts';
import { getCompanyById } from '../game/company.ts';
import { checkRateLimit } from '../security/rate-limiter.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { getArticlesBySubstring, getNewspaperIssue, getNewspaperIssues, getTopArticlesByReaction } from '../game/newspaper.ts';
import { NotPurchasableError, listSimboostUse, listUnlockedHqs, listUnlockedPas, selectPa, unlockHq, unlockPa } from '../application/social/unlockables.ts';
import { getActivePoll, getContestView, getPollById, getPollView, votePoll } from '../application/social/polls.ts';
import { getActiveChallenge, getChallengeLeaderboard, getCurrentChallengeState, restartAttempt, startAttempt } from '../application/social/challenges.ts';
import { createCourse, deleteCourse, getCourse, joinCourse, listCourses, updateCourse } from '../application/social/courses.ts';

interface ChatroomSubscriptionEntry {
  name: string;
  language: string;
  category: string;
  image: string;
  db_letter: string;
  realmsShared: boolean;
  protectedForCountry: string | null;
  show_rules?: boolean;
  unread?: number;
  datetime?: string;
  notSubscribed?: boolean;
}

// Default chatroom catalog. `notSubscribed` mirrors the official payload:
// only the rooms a company opted out of (persisted in company_settings)
// carry the flag.
const DEFAULT_CHATROOMS: Array<ChatroomSubscriptionEntry> = [
  { name: 'Supporters', language: 'en', category: 'supporter', image: '/chat-icon/005F73/supporter.png', db_letter: 'P', realmsShared: true, protectedForCountry: null, notSubscribed: true },
  { name: 'Game', language: 'en', category: 'game', image: '/chat-icon/005F73/game.png', db_letter: 'G', realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: 'Help', language: 'en', category: 'help', image: '/chat-icon/005F73/help.png', db_letter: 'H', realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: 'Sales', language: 'en', category: 'sales', image: '/chat-icon/005F73/sales.png', db_letter: 'S', realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: 'Aerospace sales', language: 'en', category: 'sales', image: '/chat-icon/005F73/sales-as.png', db_letter: 'X', realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: 'Social', language: 'en', category: 'social', image: '/chat-icon/005F73/social.png', db_letter: 'C', realmsShared: true, protectedForCountry: null, show_rules: false, unread: 0 },
  { name: 'Roleplay', language: 'en', category: 'roleplay', image: '/chat-icon/005F73/roleplay.png', db_letter: 'R', realmsShared: true, protectedForCountry: null, notSubscribed: true },
  { name: '[ZH] 游戏', language: 'zh-cn', category: 'game', image: '/chat-icon/234B8B/game.png', db_letter: 'N', realmsShared: true, protectedForCountry: null, show_rules: false, unread: 0 },
  { name: '[ZH] 交易', language: 'zh-cn', category: 'sales', image: '/chat-icon/234B8B/sales.png', db_letter: 'k', realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: '[ZH] 社交', language: 'zh-cn', category: 'social', image: '/chat-icon/234B8B/social.png', db_letter: 'n', realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 }
];

function loadChatroomSubscriptions(companyId: number): Array<ChatroomSubscriptionEntry> {
  const settingValue = socialRepository.getCompanySetting(companyId, 'chatroom_subscriptions');
  let unsubscribed: string[] = [];
  if (settingValue) {
    try {
      const parsed: unknown = JSON.parse(settingValue);
      if (Array.isArray(parsed)) unsubscribed = parsed.map(String);
    } catch {
      unsubscribed = [];
    }
  }
  const stamp = virtualClock.nowIso();
  return DEFAULT_CHATROOMS.map(entry => {
    const withStamp: ChatroomSubscriptionEntry = { ...entry, datetime: stamp };
    return unsubscribed.includes(entry.db_letter) ? { ...withStamp, notSubscribed: true } : withStamp;
  });
}

export async function handleSocialRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Public profile articles by author.
  if (pathname.match(/^\/api\/v2\/newspaper\/articles-by-author\/\d+\/$/) && method === 'GET') {
    sendJson(res, []);
    return true;
  }
  // Free-text / company bio
  const freeTextMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/free-text\/?$/);
  if (freeTextMatch) {
    const targetIdStr = freeTextMatch[1];
    const targetCompanyId = targetIdStr === 'me' ? currentCompanyId : Number(targetIdStr);
    if (!targetCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'GET') {
      const comp = getCompanyById(targetCompanyId);
      sendJson(res, comp?.note || '');
      return true;
    }
    if (method === 'POST') {
      // C-1: only the owning company may write its bio. Writes must be
      // session-authenticated and target the authenticated company itself.
      if (!currentCompanyId || targetCompanyId !== currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ freeText?: string }>(req);
      const newText = String(body?.freeText ?? '').slice(0, 2000);
      socialRepository.setCompanyNote(newText, targetCompanyId);
      sendJson(res, newText);
      return true;
    }
  }

  // Player notifications settings: /api/v2/players/notifications/:id
  // P1-06: notification preferences must persist (read -> modify -> save ->
  // reload keeps values). Stored per company in notification_preferences.
  const playerNotificationsMatch = pathname.match(/^\/api\/v2\/players\/notifications(?:\/(\d+))?\/?$/);
  if (playerNotificationsMatch) {
    const CATEGORIES = ['emailNotifications', 'popupNotifications', 'pushNotifications'] as const;
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

    if (method === 'GET') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      sendJson(res, loadRow());
      return true;
    }
    if (method === 'PUT') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ category?: string; emailNotifications?: Record<string, boolean>; popupNotifications?: Record<string, boolean>; pushNotifications?: Record<string, boolean> }>(req);
      const category = String(body?.category ?? '');
      if (!(CATEGORIES as readonly string[]).includes(category)) {
        sendJson(res, { error: 'Unknown notification category' }, 400);
        return true;
      }
      const { category: _drop, ...rest } = body ?? {};
      void _drop;
      const flags = rest[category] ?? {};
      const column = category === 'emailNotifications' ? 'email_json'
        : category === 'popupNotifications' ? 'popup_json' : 'push_json';
      socialRepository.upsertNotificationPreferences(currentCompanyId, column, JSON.stringify(flags), virtualClock.nowIso());
      sendJson(res, loadRow());
      return true;
    }
    if (method === 'POST') {
      sendJson(res, { sent: true });
      return true;
    }
  }

  // 1. Contacts & chatroom sidebar (official contract per HAR): each room carries
  // `image` (icon URL), `datetime`, `db_letter`, `protectedForCountry: null`.
  // Official payload lists only the rooms the company is subscribed to — rooms
  // opted out via /api/v2/companies/chatrooms/:id/ POST are excluded entirely.
  if (pathname === '/api/v2/contacts/') {
    sendJson(res, {
      chatrooms: loadChatroomSubscriptions(currentCompanyId ?? -1)
        .filter(room => !room.notSubscribed)
        .map(({ notSubscribed, ...room }) => ({
          ...room,
          protectedForCountry: room.protectedForCountry ?? null
        })),
      contacts: [],
      unreadMessagesOtherRealms: [],
      invisible: false,
      ignoringCompanies: [],
      companiesChatBlockingUs: []
    });
    return true;
  }

  // 2. Game Notifications: /api/v2/game-notifications/, /api/v2/companies/:id/game-notifications/
  // Issue #112: The frontend indexed lookup requires valid notificationKind enum strings.
  const VALID_NOTIFICATION_KINDS = new Set([
    'EXECUTIVE_OFFER',
    'EXECUTIVE_TRAINING_FINISHED',
    'AGENCY_FAILED',
    'AGENCY_FOUND_EXECUTIVE',
    'EXECUTIVE_STAYED',
    'EXECUTIVE_DECLINED_OFFER',
    'EXECUTIVES_STRIKE',
    'EXECUTIVES_LEFT',
    'EXECUTIVE_WILL_RETIRE',
    'EXECUTIVE_RETIRED',
    'EXECUTIVE_ACCEPTED_OFFER',
    'EXECUTIVE_LEFT',
    'EXECUTIVE_WANTED_TO_ACCEPT_OFFER',
    'EXECUTIVE_BURNOUT',
    'TAGS_EXPIRED',
    'SEASON_START',
    'SEASON_END'
  ]);

  const gameNotificationsMatch =
    pathname === '/api/v2/game-notifications/' ||
    pathname === '/api/v2/game-notifications' ||
    pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/game-notifications\/(?:\d+\/)?$/);
  if (gameNotificationsMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'DELETE') {
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

  // 3. Error Announcements: /api/v2/error-announcement/
  if (pathname === '/api/v2/error-announcement/') {
    sendJson(res, { announcement: null });
    return true;
  }

  // 3b. Help Chatroom: /api/v2/help-chatroom/
  if (pathname === '/api/v2/help-chatroom/' || pathname === '/api/v2/help-chatroom') {
    sendJson(res, {
      name: 'help',
      image: '/static/images/chatroom/help.png'
    });
    return true;
  }

  // 4. Captcha endpoints: /api/v2/captcha/, /api/v2/registrations/captcha/
  if (pathname.startsWith('/api/') && pathname.includes('/captcha/')) {
    sendJson(res, { success: true, verified: true, token: "simcomp-local-captcha-token" });
    return true;
  }

  // 5. Chatroom show rules
  const chatRulesMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/show-rules\/$/);
  if (chatRulesMatch) {
    sendJson(res, { success: true });
    return true;
  }

  // 6. Chatroom from id: /api/v2/chatroom/:room/from-id/:id/
  const chatFromIdMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/from-id\/(\d+)\/$/);
  if (chatFromIdMatch) {
    const room = decodeURIComponent(chatFromIdMatch[1]);
    const fromId = Number(chatFromIdMatch[2]) || 0;
    const messages = socialRepository.listChatMessagesFromId(room, fromId);
    const realmByCompanyId = new Map<number, number>(
      socialRepository.listCompanyRealms().map(row => [row.company_id, row.realm_id])
    );

    sendJson(res, messages.map(m => ({
      id: m.id,
      chatroom: m.room,
      sender: { id: m.sender_id, company: m.sender_company, logo: '', certificates: 0, supporter: false, realmId: realmByCompanyId.get(m.sender_id) ?? 0 },
      body: m.text,
      text: m.text,
      datetime: m.sent_at,
      pinned: false
    })));
    return true;
  }

  // 7. Chatroom Messages
  const chatroomMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/$/);
  if (chatroomMatch) {
    const room = decodeURIComponent(chatroomMatch[1]);
    const messages = socialRepository.listChatMessages(room);
    const realmByCompanyId = new Map<number, number>(
      socialRepository.listCompanyRealms().map(row => [row.company_id, row.realm_id])
    );

    sendJson(res, messages.reverse().map(m => ({
      id: m.id,
      chatroom: m.room,
      // C-3: frontend resolves the realm badge via Kt[sender.realmId]; a
      // missing realmId crashes the messages page with a TypeError.
      sender: { id: m.sender_id, company: m.sender_company, logo: '', certificates: 0, supporter: false, realmId: realmByCompanyId.get(m.sender_id) ?? 0 },
      body: m.text,
      text: m.text,
      datetime: m.sent_at,
      pinned: false
    })));
    return true;
  }

  // 8. Send Message
  if ((pathname === '/api/v2/message/' || pathname === '/api/v2/messages/') && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    const rateCheck = checkRateLimit(`chat:msg:${currentCompanyId}`, 40, 60000);
    if (!rateCheck.allowed) {
      sendJson(res, { error: 'Message rate limit exceeded. Please wait before posting again.', code: 'RATE_LIMITED' }, 429, {
        'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000))
      });
      return true;
    }

    // C-2: the original frontend bundle posts {chatroom, body}; older
    // callers/tests use {chatroom, text}. Accept both spellings.
    const body = await readJsonBody<{ chatroom?: string; text?: string; body?: string; recipient?: number }>(req);
    const room = typeof body.chatroom === 'string' && body.chatroom.trim()
      ? body.chatroom.trim()
      : 'N';
    const rawText = typeof body.text === 'string' ? body.text : typeof body.body === 'string' ? body.body : '';
    const text = rawText.trim();
    if (room.length > 100 || text.length === 0 || text.length > 2000) {
      sendJson(res, { error: 'Chatroom and message text are invalid' }, 400);
      return true;
    }

    const comp = getCompanyById(currentCompanyId);
    if (!comp) {
      sendJson(res, { error: 'Company not found' }, 404);
      return true;
    }

    const now = virtualClock.nowIso();
    const messageId = socialRepository.insertChatMessage(room, comp.company_id, comp.name, text, now);

    sendJson(res, {
      id: messageId,
      chatroom: room,
      sender: { id: comp.company_id, company: comp.name, logo: '', supporter: false, realmId: comp.realm_id ?? 0 },
      body: text,
      text,
      datetime: now
    });
    return true;
  }

  if (pathname === '/api/messages/' || pathname === '/api/messages_by_company/') {
    sendJson(res, { messages: [], contacts: [], unreadMessages: [] });
    return true;
  }

  // 8b. Per-company chatroom subscriptions: /api/v2/companies/chatrooms/:companyId/
  // C-10: the account-settings/chatrooms page and the messages sidebar consume
  // this list; shape mirrors the official HAR payload. POST persists the
  // subscription toggles as {added: [db_letter], deleted: [db_letter]}.
  const chatroomSubsMatch = pathname.match(/^\/api\/v2\/companies\/chatrooms\/(\d+|me)\/?$/);
  if (chatroomSubsMatch) {
    const targetId = chatroomSubsMatch[1] === 'me' ? currentCompanyId : Number(chatroomSubsMatch[1]);
    if (!targetId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ added?: string[]; deleted?: string[] }>(req);
      const added = Array.isArray(body?.added) ? body.added.map(String) : [];
      const deleted = Array.isArray(body?.deleted) ? body.deleted.map(String) : [];
      let subs = loadChatroomSubscriptions(targetId);
      for (const letter of added) {
        subs = subs.map(s => (s.db_letter === letter ? { ...s, notSubscribed: false } : s));
      }
      for (const letter of deleted) {
        subs = subs.map(s => (s.db_letter === letter ? { ...s, notSubscribed: true } : s));
      }
      socialRepository.upsertCompanySetting(targetId, 'chatroom_subscriptions', JSON.stringify(subs.filter(s => s.notSubscribed).map(s => s.db_letter)));
      sendJson(res, subs);
      return true;
    }
    sendJson(res, loadChatroomSubscriptions(targetId));
    return true;
  }

  // 8c. Private notes about other companies.
  // C-11: GET /api/v2/companies/me/my-note/ returns the own bio string;
  // GET /api/v2/companies/me/note/ lists notes written about other
  // companies; /api/v2/companies/me/note/:aboutId/ reads, writes, prioritizes
  // and deletes one entry. All writes are scoped to the session company.
  const myNoteMatch = pathname.match(/^\/api\/v2\/companies\/me\/my-note\/?$/);
  if (myNoteMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ note?: string }>(req);
      const noteText = String(body?.note ?? '').slice(0, 4000);
      socialRepository.setCompanyNote(noteText, currentCompanyId);
      sendJson(res, noteText);
      return true;
    }
    const comp = getCompanyById(currentCompanyId);
    sendJson(res, comp?.note ?? '');
    return true;
  }

  const noteListMatch = pathname.match(/^\/api\/v2\/companies\/me\/note\/(\d+)?\/?$/);
  if (noteListMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const aboutCompanyId = noteListMatch[1] ? Number(noteListMatch[1]) : null;

    if (method === 'GET') {
      if (aboutCompanyId) {
        sendJson(res, { note: socialRepository.getCompanyNote(currentCompanyId, aboutCompanyId) ?? '' });
        return true;
      }
      const rows = socialRepository.listCompanyNotes(currentCompanyId);
      sendJson(res, rows.map(row => ({
        id: row.id,
        note: row.note,
        about: {
          id: row.company_id,
          company: row.name,
          logo: row.logo || '',
          realmId: row.realm_id ?? 0,
          deleted: false,
          online: 'n/a'
        }
      })));
      return true;
    }

    if (!aboutCompanyId) {
      sendJson(res, { error: 'Company id required' }, 400);
      return true;
    }

    if (method === 'POST') {
      const body = await readJsonBody<{ note?: string }>(req);
      const noteText = String(body?.note ?? '').slice(0, 4000);
      const now = virtualClock.nowIso();
      if (noteText === '') {
        socialRepository.deleteCompanyNote(currentCompanyId, aboutCompanyId);
        sendJson(res, { note: '' });
        return true;
      }
      socialRepository.upsertCompanyNote(currentCompanyId, aboutCompanyId, noteText, now, now);
      sendJson(res, { note: noteText });
      return true;
    }

    if (method === 'PUT') {
      const body = await readJsonBody<{ priority?: string }>(req);
      const direction = String(body?.priority ?? '');
      const noteId = socialRepository.getCompanyNoteId(currentCompanyId, aboutCompanyId);
      if (!noteId) {
        sendJson(res, { error: 'Note not found' }, 404);
        return true;
      }
      if (direction === 'up') {
        socialRepository.decrementCompanyNotePriority(noteId);
      } else if (direction === 'down') {
        socialRepository.incrementCompanyNotePriority(noteId);
      }
      sendJson(res, { success: true });
      return true;
    }

    if (method === 'DELETE') {
      socialRepository.deleteCompanyNote(currentCompanyId, aboutCompanyId);
      sendJson(res, { success: true });
      return true;
    }
  }

  // 8d. Search: company name lookup and newspaper article substring search.
  // C-6: /zh-cn/search/ and several contract/PM autocomplete widgets call
  // these; both were 404 and replaced the page with an error boundary.
  const companyListMatch = pathname.match(/^\/api\/v2\/companies\/list\/(\d+)\/([^/]+)\/$/);
  if (companyListMatch && method === 'GET') {
    const realmId = Number(companyListMatch[1]);
    const query = decodeURIComponent(companyListMatch[2]).replace(/-/g, ' ').trim();
    if (query.length < 1) {
      sendJson(res, []);
      return true;
    }
    const rows = socialRepository.searchCompaniesByRealm(realmId, query);
    sendJson(res, rows.map(row => ({
      companyId: row.company_id,
      company: row.name,
      logo: row.logo || '',
      realmId: row.realm_id ?? 0,
      deleted: false
    })));
    return true;
  }

  const articlesSubstringMatch = pathname.match(/^\/api\/v2\/newspaper\/articles-by-substring\/(\d+)\/([^/]+)\/$/);
  if (articlesSubstringMatch && method === 'GET') {
    const realmId = Number(articlesSubstringMatch[1]);
    const query = decodeURIComponent(articlesSubstringMatch[2]);
    sendJson(res, getArticlesBySubstring(realmId, query));
    return true;
  }

  // 9. Newspaper single issue
  const newspaperIssueMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/(\d+)\/$/);
  if (newspaperIssueMatch) {
    const realmId = Number(newspaperIssueMatch[1]);
    const issueId = Number(newspaperIssueMatch[2]);
    const issue = getNewspaperIssue(issueId, realmId);
    if (!issue) {
      sendJson(res, { error: 'Newspaper issue not found' }, 404);
      return true;
    }
    sendJson(res, issue);
    return true;
  }

  // 10. Newspaper issue list
  const newspaperListMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/$/);
  if (newspaperListMatch) {
    const realmId = Number(newspaperListMatch[1]);
    const belowId = search.get('belowId') !== null ? Number(search.get('belowId')) : undefined;
    const limit = search.get('limit') !== null ? Number(search.get('limit')) : undefined;
    sendJson(res, getNewspaperIssues(realmId, belowId, limit ?? 20));
    return true;
  }

  // 10b. Newspaper Top Articles by Reaction: /api/v2/:locale/:realm/articles/top-by-reaction/:reaction/
  const topArticlesMatch = pathname.match(/^\/api\/v2\/[^/]+\/(\d+)\/articles\/top-by-reaction\/(\d+)\/$/);
  if (topArticlesMatch) {
    const realmId = Number(topArticlesMatch[1]);
    sendJson(res, { topArticles: getTopArticlesByReaction(realmId) });
    return true;
  }

  // 10c. Newspaper Reactions (v1)
  if (pathname.startsWith('/api/') && pathname.includes('/newspaper/') && pathname.includes('/reaction')) {
    sendJson(res, []);
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/article/') && pathname.includes('/reaction')) {
    sendJson(res, { success: true });
    return true;
  }

  // 10d. Referrals & Royalties
  if (pathname.startsWith('/api/') && pathname.includes('/referrals/')) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, referralsRepository.findReferredBy(currentCompanyId).map(r => ({
      company: { id: r.referredCompanyId },
      code: r.code,
      created: r.createdAt,
      rewardsPaid: r.rewardsPaid
    })));
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/royalties/')) {
    sendJson(res, { royalties: 0 });
    return true;
  }
  // Unlocked HQ skins (GET list / POST unlock with SimBoost debit).
  if (pathname === '/api/v2/players/unlocked-hqs/' || pathname === '/api/v2/players/unlocked-hqs') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'GET') {
      sendJson(res, listUnlockedHqs(currentCompanyId));
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req);
      try {
        sendJson(res, await unlockHq(currentCompanyId, Number(body.idx)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: message }, err instanceof NotPurchasableError ? 400 : 402);
      }
      return true;
    }
  }
  // Unlocked personal assistants (GET list / POST unlock with SimBoost debit).
  if (pathname === '/api/v2/players/unlocked-pas/' || pathname === '/api/v2/players/unlocked-pas') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'GET') {
      sendJson(res, { unlockedPAs: listUnlockedPas(currentCompanyId) });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req);
      const kind = String(body.personalAssistant ?? '');
      try {
        const unlocked = await unlockPa(currentCompanyId, kind);
        await selectPa(currentCompanyId, kind);
        sendJson(res, { unlockedPAs: unlocked });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: message }, err instanceof NotPurchasableError ? 400 : 402);
      }
      return true;
    }
  }
  // Per-company SimBoost spend history.
  const simboostsUseMatch = pathname.match(/^\/api\/v2\/players\/simboosts-use\/(\d+|me)\/?$/);
  if (simboostsUseMatch && method === 'GET') {
    const targetId = simboostsUseMatch[1] === 'me' ? currentCompanyId : Number(simboostsUseMatch[1]);
    if (!targetId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, listSimboostUse(targetId));
    return true;
  }
  if (pathname.startsWith('/api/') && (pathname.includes('/unlocked-hqs/') || pathname.includes('/unlocked-pas/'))) {
    sendJson(res, []);
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/simboosts-use/')) {
    sendJson(res, []);
    return true;
  }

  // 11. Newspaper Sponsor Params
  if (pathname === '/api/v2/newspaper/sponsor-params/') {
    sendJson(res, {
      sponsorCost: 500,
      sponsorBonus: 100,
      sponsorMinValuation: 100000
    });
    return true;
  }

  // 12. Polls: GET /api/v3/:realm/polls/:id/ and POST /api/v2/polls/:pollId/:questionId/vote/
  const pollGetMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/polls\/(\d+)\/$/);
  if (pollGetMatch && method === 'GET') {
    const poll = getPollById(Number(pollGetMatch[2])) ?? getActivePoll(Number(pollGetMatch[1]));
    if (!poll) {
      sendJson(res, { error: 'Poll not found' }, 404);
      return true;
    }
    sendJson(res, getPollView(poll, currentCompanyId));
    return true;
  }
  const pollVoteMatch = pathname.match(/^\/api\/v2\/polls\/(\d+)\/(\d+)\/vote\/$/);
  if (pollVoteMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody(req);
    try {
      votePoll(Number(pollVoteMatch[1]), Number(pollVoteMatch[2]), Number(body.choice), currentCompanyId);
      sendJson(res, { success: true });
    } catch (err) {
      sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
    }
    return true;
  }

  // 13. Challenges (v1): current / attempt / restart / leaderboard.
  if (pathname === '/api/v1/challenges/current/' && method === 'GET') {
    if (!currentCompanyId) {
      sendJson(res, { challenge: null, attempt: null });
      return true;
    }
    sendJson(res, getCurrentChallengeState(currentCompanyId));
    return true;
  }
  if ((pathname === '/api/v1/challenges/attempt/' || pathname === '/api/v1/challenges/restart/') && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const challenge = getActiveChallenge();
    if (!challenge) {
      sendJson(res, { error: 'No challenge running' }, 404);
      return true;
    }
    const company = getCompanyById(currentCompanyId);
    if (pathname.includes('/attempt/')) {
      startAttempt(challenge.id, currentCompanyId, company?.name ?? '', company?.logo ?? null, company?.realm_id ?? 0);
    } else {
      restartAttempt(challenge.id, currentCompanyId);
    }
    sendJson(res, { success: true });
    return true;
  }
  const challengeBoardMatch = pathname.match(/^\/api\/v1\/challenges\/(\d+)\/leaderboard\/$/);
  if (challengeBoardMatch && method === 'GET') {
    const board = getChallengeLeaderboard(Number(challengeBoardMatch[1]), currentCompanyId ?? -1);
    if (!board) {
      sendJson(res, { error: 'Challenge not found' }, 404);
      return true;
    }
    sendJson(res, board);
    return true;
  }

  // 14. Courses & Education: /api/courses/
  if ((pathname === '/api/courses/' || pathname === '/api/courses') && method === 'GET') {
    sendJson(res, listCourses());
    return true;
  }
  if ((pathname === '/api/courses/' || pathname === '/api/courses') && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body.name || !String(body.name).trim()) {
      sendJson(res, { error: 'Course name required' }, 400);
      return true;
    }
    sendJson(res, createCourse(String(body.teacher ?? ''), String(body.name), String(body.start ?? ''), currentCompanyId));
    return true;
  }
  const courseMatch = pathname.match(/^\/api\/courses\/(\d+)\/$/);
  if (courseMatch) {
    const courseId = Number(courseMatch[1]);
    if (method === 'GET') {
      const course = getCourse(courseId);
      if (!course) {
        sendJson(res, { error: 'Course not found' }, 404);
        return true;
      }
      sendJson(res, course);
      return true;
    }
    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      const updated = updateCourse(courseId, {
        start: body.start === true ? true : undefined,
        maxStudents: typeof body.maxStudents === 'number' ? body.maxStudents : undefined,
        studentsPaying: typeof body.studentsPaying === 'boolean' ? body.studentsPaying : undefined,
        publicChatroomsDisabled: typeof body.publicChatroomsDisabled === 'boolean' ? body.publicChatroomsDisabled : undefined,
        html: typeof body.html === 'string' ? body.html : undefined
      });
      if (!updated) {
        sendJson(res, { error: 'Course not found' }, 404);
        return true;
      }
      sendJson(res, updated);
      return true;
    }
    if (method === 'DELETE') {
      sendJson(res, { success: deleteCourse(courseId) });
      return true;
    }
  }
  if (currentCompanyId && pathname.match(/^\/api\/courses\/\d+\/join\/$/) && method === 'POST') {
    const courseId = Number(pathname.match(/^\/api\/courses\/(\d+)\/join\/$/)![1]);
    const company = getCompanyById(currentCompanyId);
    if (!company) {
      sendJson(res, { error: 'Company not found' }, 404);
      return true;
    }
    joinCourse(courseId, currentCompanyId, company.name, company.logo ?? null, company.realm_id ?? 0);
    sendJson(res, { success: true });
    return true;
  }
  if (pathname.startsWith('/api/courses/')) {
    sendJson(res, { courses: [], invitations: [], students: [] });
    return true;
  }

  // 15. Contests: GET /api/v3/:realm/contest/:id/
  const contestMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/contest\/(\d+)\/$/);
  if (contestMatch && method === 'GET') {
    const contest = getContestView(Number(contestMatch[1]), Number(contestMatch[2]));
    if (!contest) {
      sendJson(res, { error: 'Contest not found' }, 404);
      return true;
    }
    sendJson(res, contest);
    return true;
  }

  return false;
}
export function registerSocialRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  // Historical #83 stub: the endpoint is intentionally an empty public list.
  // Registering it here prevents ownership from depending on the legacy
  // newspaper/social handler order.
  registry.register({
    method: 'GET',
    pattern: '/api/v2/newspaper/articles-by-author/:authorId/',
    owner: 'social',
    handler: async (_req, res) => { sendJson(res, []); }
  });
}

registerSocialRoutes(globalRouteRegistry);
