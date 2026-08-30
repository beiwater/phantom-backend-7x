import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { db } from '../db/database.ts';
import { getCompanyById } from '../game/company.ts';

export async function handleSocialRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
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

  // 2. Game Notifications: /api/v2/game-notifications/
  if (pathname === '/api/v2/game-notifications/' || pathname === '/api/v2/game-notifications') {
    sendJson(res, {
      notifications: [
        {
          id: 1,
          title: "欢迎来到 Sim Companies 私人服务器",
          body: "生产加速 10x，全功能子系统已完整就绪！",
          date: new Date().toISOString(),
          read: true,
          type: "system"
        }
      ],
      unreadCount: 0
    });
    return true;
  }

  // 3. Error Announcements: /api/v2/error-announcement/
  if (pathname === '/api/v2/error-announcement/') {
    sendJson(res, { announcement: null });
    return true;
  }

  // 4. Captcha endpoints: /api/v2/captcha/, /api/v2/registrations/captcha/
  if (pathname.includes('/captcha/')) {
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

    if (messages.length === 0) {
      const now = new Date().toISOString();
      const seedMsgs = [
        { sender_id: 999901, sender_company: 'Solaris Energy Ltd', text: '欢迎来到 Sim Companies 私人服务器版本！全功能已就绪。' },
        { sender_id: 999902, sender_company: 'AgroEmpire Farms', text: '交易所全品类 Q0-Q12 现货充足，随时欢迎采购与挂牌！' }
      ];
      for (const sm of seedMsgs) {
        db.prepare(`
          INSERT INTO chat_messages (room, sender_id, sender_company, text, sent_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(room, sm.sender_id, sm.sender_company, sm.text, now);
      }
    }

    const currentMsgs = db.prepare(`
      SELECT * FROM chat_messages WHERE room = ? OR room = 'N' OR room = '1' ORDER BY id DESC LIMIT 50
    `).all(room) as Array<{ id: number; room: string; sender_id: number; sender_company: string; text: string; sent_at: string }>;

    sendJson(res, currentMsgs.reverse().map(m => ({
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
    const body = await readJsonBody<{ chatroom?: string; text?: string; recipient?: number }>(req);
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    const now = new Date().toISOString();
    const resId = db.prepare(`
      INSERT INTO chat_messages (room, sender_id, sender_company, text, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(body.chatroom || 'N', comp ? comp.company_id : 2920233, comp ? comp.name : 'Player', body.text || '', now);

    sendJson(res, {
      id: Number(resId.lastInsertRowid),
      chatroom: body.chatroom || 'N',
      sender: { id: comp ? comp.company_id : 2920233, company: comp ? comp.name : 'Player', logo: '', supporter: false },
      text: body.text,
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

    return sendJson(res, {
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
  }

  // 10. Newspaper issue list
  const newspaperListMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/$/);
  if (newspaperListMatch) {
    const realmId = Number(newspaperListMatch[1]);
    const now = new Date().toISOString();
    return sendJson(res, [
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
  }

  // 11. Newspaper Sponsor Params
  if (pathname === '/api/v2/newspaper/sponsor-params/') {
    return sendJson(res, {
      sponsorCost: 500,
      sponsorBonus: 100,
      sponsorMinValuation: 100000
    });
  }

  // 12. Polls
  if (pathname.includes('/polls/')) {
    sendJson(res, { id: 1, question: '你最喜欢的产业是哪一个？', options: ['农业', '电子', '航空航天', '零售'] });
    return true;
  }

  // 13. Challenges
  if (pathname.includes('/challenges/current/')) {
    sendJson(res, { challenges: [] });
    return true;
  }
  if (pathname.includes('/challenges/attempt/') || pathname.includes('/challenges/restart/')) {
    sendJson(res, { success: true });
    return true;
  }

  // 14. Courses & Education: /api/courses/
  if (pathname.startsWith('/api/courses/')) {
    sendJson(res, { courses: [], invitations: [], students: [] });
    return true;
  }

  // 15. Contests: /api/v3/:realm/contest/:id/
  if (pathname.includes('/contest/')) {
    sendJson(res, {
      contest: { name: "Weekly Production Championship", id: 1, end: new Date(Date.now() + 86400000 * 7).toISOString() },
      participants: []
    });
    return true;
  }

  return false;
}
