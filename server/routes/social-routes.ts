import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { db } from '../db/database.ts';
import { getCompanyById } from '../game/company.ts';
import { checkRateLimit } from '../security/rate-limiter.ts';

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
  const row = db.prepare('SELECT value FROM company_settings WHERE company_id = ? AND key = ?')
    .get(companyId, 'chatroom_subscriptions') as { value?: string } | undefined;
  let unsubscribed: string[] = [];
  if (row?.value) {
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (Array.isArray(parsed)) unsubscribed = parsed.map(String);
    } catch {
      unsubscribed = [];
    }
  }
  const stamp = new Date().toISOString();
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
      db.prepare('UPDATE companies SET note = ? WHERE company_id = ?').run(newText, targetCompanyId);
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
      const row = db.prepare('SELECT email_json, popup_json, push_json FROM notification_preferences WHERE company_id = ?')
        .get(currentCompanyId ?? -1) as { email_json?: string; popup_json?: string; push_json?: string } | undefined;
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
      db.prepare(`
        INSERT INTO notification_preferences (company_id, ${column}, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at
      `).run(currentCompanyId, JSON.stringify(flags), new Date().toISOString());
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
  const gameNotificationsMatch =
    pathname === '/api/v2/game-notifications/' ||
    pathname === '/api/v2/game-notifications' ||
    pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/game-notifications\/(?:\d+\/)?$/);
  if (gameNotificationsMatch) {
    if (method === 'DELETE') {
      sendJson(res, { success: true });
      return true;
    }
    sendJson(res, {
      notifications: [],
      unreadCount: 0
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
    sendJson(res, []);
    return true;
  }

  // 7. Chatroom Messages
  const chatroomMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/$/);
  if (chatroomMatch) {
    const room = decodeURIComponent(chatroomMatch[1]);
    const messages = db.prepare(`
      SELECT * FROM chat_messages WHERE room = ? OR room = 'N' OR room = '1' ORDER BY id DESC LIMIT 50
    `).all(room) as Array<{ id: number; room: string; sender_id: number; sender_company: string; text: string; sent_at: string }>;
    const realmByCompanyId = new Map<number, number>(
      (db.prepare('SELECT company_id, realm_id FROM companies').all() as Array<{ company_id: number; realm_id: number }>)
        .map(row => [row.company_id, row.realm_id])
    );

    sendJson(res, messages.reverse().map(m => ({
      id: m.id,
      chatroom: m.room,
      // C-3: frontend resolves the realm badge via Kt[sender.realmId]; a
      // missing realmId crashes the messages page with a TypeError.
      sender: { id: m.sender_id, company: m.sender_company, logo: '', certificates: 0, supporter: false, realmId: realmByCompanyId.get(m.sender_id) ?? 0 },
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

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO chat_messages (room, sender_id, sender_company, text, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(room, comp.company_id, comp.name, text, now);

    sendJson(res, {
      id: Number(result.lastInsertRowid),
      chatroom: room,
      sender: { id: comp.company_id, company: comp.name, logo: '', supporter: false, realmId: comp.realm_id ?? 0 },
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
      db.prepare('INSERT INTO company_settings (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value')
        .run(targetId, 'chatroom_subscriptions', JSON.stringify(subs.filter(s => s.notSubscribed).map(s => s.db_letter)));
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
      db.prepare('UPDATE companies SET note = ? WHERE company_id = ?').run(noteText, currentCompanyId);
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
        const row = db.prepare('SELECT note FROM company_notes WHERE company_id = ? AND about_company_id = ?')
          .get(currentCompanyId, aboutCompanyId) as { note?: string } | undefined;
        sendJson(res, { note: row?.note ?? '' });
        return true;
      }
      const rows = db.prepare(`
        SELECT cn.id, cn.note, cn.priority, c.company_id, c.name, c.realm_id, c.logo
        FROM company_notes cn
        JOIN companies c ON c.company_id = cn.about_company_id
        WHERE cn.company_id = ?
        ORDER BY cn.priority ASC, cn.id ASC
      `).all(currentCompanyId) as Array<{ id: number; note: string; priority: number; company_id: number; name: string; realm_id: number; logo: string }>;
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
      const now = new Date().toISOString();
      if (noteText === '') {
        db.prepare('DELETE FROM company_notes WHERE company_id = ? AND about_company_id = ?').run(currentCompanyId, aboutCompanyId);
        sendJson(res, { note: '' });
        return true;
      }
      db.prepare(`
        INSERT INTO company_notes (company_id, about_company_id, note, priority, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT(company_id, about_company_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
      `).run(currentCompanyId, aboutCompanyId, noteText, now, now);
      sendJson(res, { note: noteText });
      return true;
    }

    if (method === 'PUT') {
      const body = await readJsonBody<{ priority?: string }>(req);
      const direction = String(body?.priority ?? '');
      const row = db.prepare('SELECT id FROM company_notes WHERE company_id = ? AND about_company_id = ?')
        .get(currentCompanyId, aboutCompanyId) as { id?: number } | undefined;
      if (!row?.id) {
        sendJson(res, { error: 'Note not found' }, 404);
        return true;
      }
      if (direction === 'up') {
        db.prepare('UPDATE company_notes SET priority = priority - 1 WHERE id = ?').run(row.id);
      } else if (direction === 'down') {
        db.prepare('UPDATE company_notes SET priority = priority + 1 WHERE id = ?').run(row.id);
      }
      sendJson(res, { success: true });
      return true;
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM company_notes WHERE company_id = ? AND about_company_id = ?').run(currentCompanyId, aboutCompanyId);
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
    const rows = db.prepare(`
      SELECT company_id, name, realm_id, logo
      FROM companies
      WHERE realm_id = ?
        AND lower(replace(name, '/', '-')) LIKE '%' || lower(replace(?, '-', ' ')) || '%'
      ORDER BY company_id ASC
      LIMIT 25
    `).all(realmId, query) as Array<{ company_id: number; name: string; realm_id: number; logo: string }>;
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
    // No local newspaper article storage yet: return the shape the frontend
    // search page consumes ({id, title, author, newspaper:{realmId, issueId}}).
    sendJson(res, []);
    return true;
  }

  // 9. Newspaper single issue
  const newspaperIssueMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/(\d+)\/$/);
  if (newspaperIssueMatch) {
    const realmId = Number(newspaperIssueMatch[1]);
    const issueId = Number(newspaperIssueMatch[2]);
    const now = new Date().toISOString();

    sendJson(res, {
      id: issueId,
      issueId,
      realmId,
      published: now,
      articles: [
        {
          id: 1,
          position: 1,
          title: '私人服务器经济模型平稳运行',
          body: '基于 SQLite 高性能存储与全自研 Node.js/TypeScript 兼容后端的 SimCompanies 私人服务器版本正式上线运行。全品类 Q0-Q12 市场现货已全面铺满，欢迎各家公司开展自由生产与跨行业贸易。',
          author: { id: 999901, company: 'Sim Companies Times' },
          newspaper: { realmId, issueId },
          reactions: [],
          reactionCount: 12
        },
        {
          id: 2,
          position: 2,
          title: '新手创业指南：从农场到高科技帝国',
          body: '建议新手公司首先在土地 B0 上兴建 Farm（农场），采购充足的电力与水资源排产苹果与种子，随后建造生鲜超市（Grocery store）赚取第一桶金，稳步扩大产业版图。',
          author: { id: 999902, company: 'Economic Review' },
          newspaper: { realmId, issueId },
          reactions: [],
          reactionCount: 8
        }
      ]
    });
    return true;
  }

  // 10. Newspaper issue list
  const newspaperListMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/$/);
  if (newspaperListMatch) {
    const realmId = Number(newspaperListMatch[1]);
    const now = new Date().toISOString();
    sendJson(res, [
      {
        id: 1,
        issueId: 1,
        realmId,
        published: now,
        articles: [
          { id: 1, title: '私人服务器经济模型平稳运行', position: 1 },
          { id: 2, title: '新手创业指南：从农场到高科技帝国', position: 2 }
        ]
      }
    ]);
    return true;
  }

  // 10b. Newspaper Top Articles by Reaction: /api/v2/:locale/:realm/articles/top-by-reaction/:reaction/
  const topArticlesMatch = pathname.match(/^\/api\/v2\/[^/]+\/(\d+)\/articles\/top-by-reaction\/(\d+)\/$/);
  if (topArticlesMatch) {
    const realmId = Number(topArticlesMatch[1]);
    sendJson(res, {
      topArticles: [
        {
          id: 1,
          title: '私人服务器经济模型平稳运行',
          author: { id: 999901, company: 'Sim Companies Times' },
          reactions: [{ reaction: 1, count: 28 }],
          newspaper: { realmId, issueId: 1 }
        }
      ]
    });
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
    sendJson(res, []);
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/royalties/')) {
    sendJson(res, { royalties: 0 });
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

  // 12. Polls (only match /api/ endpoints, e.g. /api/v3/:realm/polls/:id/ and /api/v2/polls/:id/vote/)
  if (pathname.startsWith('/api/') && pathname.includes('/polls/')) {
    if (method === 'POST') {
      sendJson(res, { success: true });
      return true;
    }
    sendJson(res, {
      id: 1,
      name: '社区发展调查问卷',
      realmId: 0,
      active: true,
      supportersOnly: false,
      deadline: '2028-12-31T23:59:59Z',
      results: [],
      questions: [
        {
          id: 1,
          label: '你最喜欢的产业是哪一个？',
          description: '选择你最常经营的核心业务方向',
          questionType: 1,
          choices: [
            { id: 1, label: '农业', votes: 42 },
            { id: 2, label: '电子', votes: 58 },
            { id: 3, label: '航空航天', votes: 35 },
            { id: 4, label: '生鲜零售', votes: 29 }
          ]
        }
      ]
    });
    return true;
  }

  // 13. Challenges
  if (pathname.startsWith('/api/') && pathname.includes('/challenges/current/')) {
    sendJson(res, { challenges: [] });
    return true;
  }
  if (pathname.startsWith('/api/') && (pathname.includes('/challenges/attempt/') || pathname.includes('/challenges/restart/'))) {
    sendJson(res, { success: true });
    return true;
  }
  // 14. Courses & Education: /api/courses/
  if (pathname === '/api/courses/' || pathname === '/api/courses') {
    sendJson(res, []);
    return true;
  }
  if (pathname.startsWith('/api/courses/')) {
    sendJson(res, { courses: [], invitations: [], students: [] });
    return true;
  }

  // 15. Contests: /api/v3/:realm/contest/:id/
  if (pathname.startsWith('/api/') && pathname.includes('/contest/')) {
    sendJson(res, {
      contest: { name: "Weekly Production Championship", id: 1, end: new Date(Date.now() + 86400000 * 7).toISOString() },
      participants: []
    });
    return true;
  }

  return false;
}
