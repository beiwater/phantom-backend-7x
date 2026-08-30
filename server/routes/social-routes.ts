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
  // Contacts & Default Chatrooms
  if (pathname === '/api/v2/contacts/') {
    sendJson(res, {
      chatrooms: [
        { name: '[ZH] 游戏', language: 'zh-cn', category: 'game', image: '/chat-icon/234B8B/game.png', db_letter: 'N', realmsShared: true, unread: 0, datetime: new Date().toISOString() },
        { name: '[ZH] 社交', language: 'zh-cn', category: 'social', image: '/chat-icon/4A90E2/social.png', db_letter: 'S', realmsShared: true, unread: 0, datetime: new Date().toISOString() }
      ],
      contacts: [],
      unreadMessagesOtherRealms: [],
      invisible: false,
      ignoringCompanies: [],
      companiesChatBlockingUs: []
    });
    return true;
  }

  // Chatroom Messages
  const chatroomMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/$/);
  if (chatroomMatch) {
    const room = decodeURIComponent(chatroomMatch[1]);
    const messages = db.prepare(`
      SELECT * FROM chat_messages WHERE room = ? ORDER BY id DESC LIMIT 50
    `).all(room) as Array<{ id: number; room: string; sender_id: number; sender_company: string; text: string; sent_at: string }>;

    sendJson(res, messages.reverse().map(m => ({
      id: m.id,
      chatroom: m.room,
      sender: { id: m.sender_id, company: m.sender_company, logo: '', certificates: 0, supporter: false },
      text: m.text,
      datetime: m.sent_at
    })));
    return true;
  }

  // Send Message
  if (pathname === '/api/v2/message/' && method === 'POST') {
    const body = await readJsonBody<{ chatroom?: string; text?: string }>(req);
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    const now = new Date().toISOString();
    const resId = db.prepare(`
      INSERT INTO chat_messages (room, sender_id, sender_company, text, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(body.chatroom || '[ZH] 游戏', comp ? comp.company_id : 2920233, comp ? comp.name : 'Player', body.text || '', now);

    sendJson(res, {
      id: Number(resId.lastInsertRowid),
      chatroom: body.chatroom || '[ZH] 游戏',
      sender: { id: comp ? comp.company_id : 2920233, company: comp ? comp.name : 'Player' },
      text: body.text,
      datetime: now
    });
    return true;
  }

  if (pathname === '/api/messages/' || pathname === '/api/messages_by_company/') {
    sendJson(res, { messages: [], contacts: [] });
    return true;
  }

  // Newspaper
  if (pathname.includes('/newspaper/')) {
    sendJson(res, {
      articles: [
        {
          id: 1,
          title: '私人服务器经济体系平稳启动',
          author: 'Sim Companies Times',
          body: '全自研兼容后端与 SQLite 驱动的私人服务器版本正式上线运行。',
          date: new Date().toISOString()
        }
      ]
    });
    return true;
  }

  // Polls
  if (pathname.includes('/polls/')) {
    sendJson(res, { id: 1, question: '你最喜欢的产业是哪一个？', options: ['农业', '电子', '航空航天', '零售'] });
    return true;
  }

  if (pathname.includes('/challenges/current/')) {
    sendJson(res, { challenge: null });
    return true;
  }

  return false;
}
