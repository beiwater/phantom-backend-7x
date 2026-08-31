import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { db } from '../db/database.ts';
import { getCompanyById } from '../game/company.ts';
import { checkRateLimit } from '../security/rate-limiter.ts';

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
      const body = await readJsonBody<{ freeText?: string }>(req);
      const newText = String(body.freeText ?? '').slice(0, 2000);
      db.prepare('UPDATE companies SET note = ? WHERE company_id = ?').run(newText, targetCompanyId);
      sendJson(res, newText);
      return true;
    }
  }

  // Player notifications settings: /api/v2/players/notifications/:id
  const playerNotificationsMatch = pathname.match(/^\/api\/v2\/players\/notifications(?:\/(\d+))?\/?$/);
  if (playerNotificationsMatch) {
    if (method === 'GET') {
      sendJson(res, {
        emailNotifications: { new_contract: true, bonds_sold: true, idle_building: true },
        popupNotifications: { new_contract: true, buy_order_fill: true },
        pushNotifications: { new_contract: true, idle_building: true }
      });
      return true;
    }
    if (method === 'PUT') {
      const body = await readJsonBody<any>(req);
      sendJson(res, {
        emailNotifications: body?.emailNotifications || {},
        popupNotifications: body?.popupNotifications || {},
        pushNotifications: body?.pushNotifications || {}
      });
      return true;
    }
    if (method === 'POST') {
      sendJson(res, { sent: true });
      return true;
    }
  }

  // 1. Contacts & Default Chatrooms (Must include unreadMessages: [])
  if (pathname === '/api/v2/contacts/') {
    sendJson(res, {
      chatrooms: [
        { name: '[ZH] 游戏', language: 'zh-cn', category: 'game', icon: 'chat-23488b.png', db_letter: 'N', realmsShared: true, protectedForCountry: 'None', show_rules: false, unread: 0, date: new Date().toISOString() },
        { name: '[ZH] 交易', language: 'zh-cn', category: 'sales', icon: 'chat-23488b.png', db_letter: '1', realmsShared: false, protectedForCountry: 'None', show_rules: false, unread: 0, date: new Date().toISOString() },
        { name: '[ZH] 帮助', language: 'zh-cn', category: 'help', icon: 'chat-23488b.png', db_letter: 'H', realmsShared: true, protectedForCountry: 'None', show_rules: false, unread: 0, date: new Date().toISOString() },
        { name: '[EN] Game', language: 'en', category: 'game', icon: 'chat-23488b.png', db_letter: 'E', realmsShared: true, protectedForCountry: 'None', show_rules: false, unread: 0, date: new Date().toISOString() },
        { name: '[EN] Sales', language: 'en', category: 'sales', icon: 'chat-23488b.png', db_letter: 'S', realmsShared: false, protectedForCountry: 'None', show_rules: false, unread: 0, date: new Date().toISOString() }
      ],
      contacts: [],
      unreadMessages: [],
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

    sendJson(res, messages.reverse().map(m => ({
      id: m.id,
      chatroom: m.room,
      sender: { id: m.sender_id, company: m.sender_company, logo: '', certificates: 0, supporter: false },
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

    const body = await readJsonBody<{ chatroom?: string; text?: string; recipient?: number }>(req);
    const room = typeof body.chatroom === 'string' && body.chatroom.trim()
      ? body.chatroom.trim()
      : 'N';
    const text = typeof body.text === 'string' ? body.text.trim() : '';
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
      sender: { id: comp.company_id, company: comp.name, logo: '', supporter: false },
      text,
      datetime: now
    });
    return true;
  }

  if (pathname === '/api/messages/' || pathname === '/api/messages_by_company/') {
    sendJson(res, { messages: [], contacts: [], unreadMessages: [] });
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
