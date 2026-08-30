import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { db } from '../db/database.ts';
import { getCompanyById } from '../game/company.ts';
import { unlockTagSlot } from '../game/simboosts.ts';
import {
  getNewspaperIssues,
  getNewspaperIssue,
  getArticleById,
  createArticle,
  updateArticle,
  deleteArticle,
  getTopArticlesByReaction,
  getArticlesByAuthor,
  getArticlesBySubstring,
  getCompanyReactionsForNewspaper,
  addArticleReaction,
  removeArticleReaction,
  getSponsorParams,
  getSponsorsForNewspaper,
  buyNewspaperSponsor,
  updateNewspaperSponsorText
} from '../game/newspaper.ts';
import {
  getLatestCertificates,
  getRarestCertificates,
  getCertificateDetail,
  getCompanyCertificates
} from '../game/certificates.ts';
import {
  getCompanyTags,
  addCompanyTag,
  deleteCompanyTag,
  searchCompaniesByTags,
  lookupCompany
} from '../game/tags.ts';

export async function handleSocialRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const searchParams = parsedUrl.searchParams;

  // 1. Contacts & Default Chatrooms
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

  // 2. Chatroom Show Rules
  const chatRulesMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/show-rules\/$/);
  if (chatRulesMatch) {
    sendJson(res, { success: true });
    return true;
  }

  // 3. Chatroom Messages
  const chatroomMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/$/);
  if (chatroomMatch && method === 'GET') {
    const room = decodeURIComponent(chatroomMatch[1]);
    let messages = db.prepare(`
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
      messages = db.prepare(`
        SELECT * FROM chat_messages WHERE room = ? OR room = 'N' OR room = '1' ORDER BY id DESC LIMIT 50
      `).all(room) as Array<{ id: number; room: string; sender_id: number; sender_company: string; text: string; sent_at: string }>;
    }

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

  // 4. Send Message
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

  // 5. Newspaper Issue List
  const newspaperListMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/$/);
  if (newspaperListMatch || pathname === '/api/v2/newspaper/issues/' || pathname === '/api/v2/newspaper/') {
    const realmId = newspaperListMatch ? Number(newspaperListMatch[1]) : 0;
    const belowIdParam = searchParams.get('below_id');
    const belowId = belowIdParam ? Number(belowIdParam) : undefined;
    const issues = getNewspaperIssues(realmId, belowId);
    sendJson(res, issues);
    return true;
  }

  // 6. Newspaper Single Issue
  const newspaperIssueMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/newspaper\/(\d+)\/$/);
  if (newspaperIssueMatch) {
    const realmId = Number(newspaperIssueMatch[1]);
    const issueId = Number(newspaperIssueMatch[2]);
    const issue = getNewspaperIssue(issueId, realmId);
    sendJson(res, issue);
    return true;
  }
  const newspaperIssueV2Match = pathname.match(/^\/api\/v2\/newspaper\/issues\/(\d+)\/$/) || pathname.match(/^\/api\/v2\/newspaper\/(\d+)\/$/);
  if (newspaperIssueV2Match) {
    const issueId = Number(newspaperIssueV2Match[1]);
    const issue = getNewspaperIssue(issueId, 0);
    sendJson(res, issue);
    return true;
  }

  // 7. Newspaper Articles Detail & Management
  const articleGetMatch = pathname.match(/^\/api\/v3\/[^/]+\/newspaper\/(\d+)\/article\/(\d+)\/$/);
  if (articleGetMatch) {
    const articleId = Number(articleGetMatch[2]);
    if (method === 'GET') {
      const article = getArticleById(articleId);
      sendJson(res, article || {});
      return true;
    }
    if (method === 'PATCH') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const updated = updateArticle(articleId, body);
      sendJson(res, updated);
      return true;
    }
    if (method === 'DELETE') {
      const deleted = deleteArticle(articleId);
      sendJson(res, deleted);
      return true;
    }
  }

  const articleCreateMatch = pathname.match(/^\/api\/v3\/[^/]+\/newspaper\/(\d+)\/article\/$/);
  if (articleCreateMatch && method === 'POST') {
    const newspaperId = Number(articleCreateMatch[1]);
    const body = await readJsonBody<{ type?: string }>(req);
    const created = createArticle(newspaperId, body.type || '1', currentCompanyId || undefined);
    sendJson(res, created);
    return true;
  }

  const articleDetailV2Match = pathname.match(/^\/api\/v2\/newspaper\/articles\/(\d+)\/$/);
  if (articleDetailV2Match) {
    const articleId = Number(articleDetailV2Match[1]);
    const article = getArticleById(articleId);
    sendJson(res, article || {});
    return true;
  }

  if (pathname === '/de/articles/api/' || pathname === '/articles/api/') {
    const article = getArticleById(1);
    sendJson(res, article || { id: 1, title: 'SimCompanies Times API' });
    return true;
  }

  // 8. Article Top Rankings & Search
  const topArticlesMatch = pathname.match(/^\/api\/v2\/[^/]+\/(\d+)\/articles\/top-by-reaction\/([^/]+)\/$/);
  if (topArticlesMatch) {
    const realmId = Number(topArticlesMatch[1]);
    const reaction = topArticlesMatch[2];
    const top = getTopArticlesByReaction(realmId, reaction);
    sendJson(res, top);
    return true;
  }
  if (pathname === '/api/v2/newspaper/top-articles/') {
    const top = getTopArticlesByReaction(0, 'THUMBS_UP');
    sendJson(res, top);
    return true;
  }

  const articlesByAuthorMatch = pathname.match(/^\/api\/v2\/newspaper\/articles-by-author\/(\d+)\/$/) || pathname.match(/^\/api\/v2\/articles\/by-author\/(\d+)\/$/);
  if (articlesByAuthorMatch) {
    const authorCompanyId = Number(articlesByAuthorMatch[1]);
    const articles = getArticlesByAuthor(authorCompanyId);
    sendJson(res, articles);
    return true;
  }

  const articlesBySubstrMatch = pathname.match(/^\/api\/v2\/newspaper\/articles-by-substring\/(\d+)\/([^/]+)\/$/);
  if (articlesBySubstrMatch) {
    const realmId = Number(articlesBySubstrMatch[1]);
    const query = decodeURIComponent(articlesBySubstrMatch[2]);
    const articles = getArticlesBySubstring(realmId, query);
    sendJson(res, articles);
    return true;
  }

  // 9. Article Reactions
  const reactionMatch = pathname.match(/^\/api\/v1\/article\/(\d+)\/reaction\/([^/]+)$/);
  if (reactionMatch) {
    const articleId = Number(reactionMatch[1]);
    const reaction = reactionMatch[2];
    const compId = currentCompanyId || 1;
    if (method === 'PATCH') {
      try {
        const result = addArticleReaction(articleId, compId, reaction);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Reaction failed';
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    if (method === 'DELETE') {
      const result = removeArticleReaction(articleId, compId, reaction);
      sendJson(res, result);
      return true;
    }
  }

  const ownReactionsMatch = pathname.match(/^\/api\/v1\/newspaper\/(\d+)\/reaction$/);
  if (ownReactionsMatch && method === 'GET') {
    const newspaperId = Number(ownReactionsMatch[1]);
    const compId = currentCompanyId || 1;
    const reactions = getCompanyReactionsForNewspaper(newspaperId, compId);
    sendJson(res, reactions);
    return true;
  }

  const reactPostMatch = pathname.match(/^\/api\/v2\/newspaper\/articles\/(\d+)\/react\/$/) || pathname.match(/^\/api\/v2\/articles\/(\d+)\/react\/$/);
  if (reactPostMatch && method === 'POST') {
    const articleId = Number(reactPostMatch[1]);
    const body = await readJsonBody<{ reaction?: string }>(req);
    const compId = currentCompanyId || 1;
    try {
      const result = addArticleReaction(articleId, compId, body.reaction || 'THUMBS_UP');
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reaction failed';
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 10. Newspaper Sponsors & Ads
  if (pathname === '/api/v2/newspaper/sponsor-params/') {
    sendJson(res, getSponsorParams());
    return true;
  }

  const sponsorListMatch = pathname.match(/^\/api\/v3\/newspaper\/(\d+)\/sponsor\/$/) || pathname.match(/^\/api\/v2\/newspaper\/(\d+)\/sponsor\/$/);
  if (sponsorListMatch && method === 'GET') {
    const newspaperId = Number(sponsorListMatch[1]);
    const data = getSponsorsForNewspaper(newspaperId);
    sendJson(res, data);
    return true;
  }

  const sponsorPosMatch = pathname.match(/^\/api\/v2\/newspaper\/(\d+)\/sponsor\/(\d+)\/$/);
  if (sponsorPosMatch) {
    const newspaperId = Number(sponsorPosMatch[1]);
    const position = Number(sponsorPosMatch[2]);
    const compId = currentCompanyId || 1;
    if (method === 'POST') {
      const body = await readJsonBody<{ text?: string }>(req);
      try {
        const ad = buyNewspaperSponsor(newspaperId, position, compId, body.text);
        sendJson(res, ad);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to buy sponsor ad';
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    if (method === 'PATCH') {
      const body = await readJsonBody<{ text?: string }>(req);
      try {
        const updated = updateNewspaperSponsorText(newspaperId, position, compId, body.text || '');
        sendJson(res, updated);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to update sponsor text';
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  if (pathname === '/api/v2/newspaper/ads/' && method === 'POST') {
    const body = await readJsonBody<{ newspaperId?: number; position?: number; text?: string; price?: number }>(req);
    const compId = currentCompanyId || 1;
    try {
      const ad = buyNewspaperSponsor(body.newspaperId || 3, body.position ?? 0, compId, body.text, body.price);
      sendJson(res, ad);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to place ad';
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 11. Certificates Explorer
  const certLatestMatch = pathname.match(/^\/api\/v2\/certificates-explorer\/(\d+)\/latest\/$/) || pathname.match(/^\/api\/v2\/certificates-explorer\/latest\/$/);
  if (certLatestMatch) {
    const realmId = certLatestMatch[1] ? Number(certLatestMatch[1]) : 0;
    sendJson(res, getLatestCertificates(realmId));
    return true;
  }

  const certRarestMatch = pathname.match(/^\/api\/v2\/certificates-explorer\/(\d+)\/rarest\/$/) || pathname.match(/^\/api\/v2\/certificates-explorer\/rarest\/$/);
  if (certRarestMatch) {
    const realmId = certRarestMatch[1] ? Number(certRarestMatch[1]) : 0;
    sendJson(res, getRarestCertificates(realmId));
    return true;
  }

  const certDetailMatch = pathname.match(/^\/api\/v2\/certificates-explorer\/(\d+)\/certificate\/([^/]+)\/([^/]+)\/([^/]+)\/$/);
  if (certDetailMatch) {
    const realmId = Number(certDetailMatch[1]);
    const kind = Number(certDetailMatch[2]);
    const certId = certDetailMatch[3];
    const extra = certDetailMatch[4];
    sendJson(res, getCertificateDetail(realmId, kind, certId, extra));
    return true;
  }

  if (pathname === '/api/v2/certificates-explorer/' || pathname.startsWith('/api/v2/certificates-explorer/')) {
    sendJson(res, getLatestCertificates(0));
    return true;
  }

  const companyCertsMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/certificates\/$/);
  if (companyCertsMatch) {
    const compId = companyCertsMatch[1] === 'me' ? (currentCompanyId || 1) : Number(companyCertsMatch[1]);
    sendJson(res, getCompanyCertificates(compId));
    return true;
  }

  // 12. Company Tags & Search
  const tagSearchMatch = pathname.match(/^\/api\/v2\/tag-search\/([^/]+)\/$/);
  if (tagSearchMatch) {
    const query = decodeURIComponent(tagSearchMatch[1]);
    sendJson(res, searchCompaniesByTags(query));
    return true;
  }

  const companyTagsMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/tags\/$/);
  if (companyTagsMatch) {
    const compId = companyTagsMatch[1] === 'me' ? (currentCompanyId || 1) : Number(companyTagsMatch[1]);
    if (method === 'GET') {
      sendJson(res, getCompanyTags(compId));
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ kind?: string; buySell?: string }>(req);
      const tags = addCompanyTag(compId, body.kind || '1', body.buySell || 'b');
      sendJson(res, tags);
      return true;
    }
    if (method === 'PATCH') {
      try {
        const result = unlockTagSlot(compId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unlock tag slot failed';
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  const deleteTagMatch = pathname.match(/^\/api\/v2\/companies\/tags\/(\d+)\/$/);
  if (deleteTagMatch && method === 'DELETE') {
    const tagId = Number(deleteTagMatch[1]);
    deleteCompanyTag(tagId, currentCompanyId || undefined);
    sendJson(res, { success: true });
    return true;
  }

  // 13. Company Lookup
  const companyLookup3Match = pathname.match(/^\/api\/v2\/company-lookup\/([^/]+)\/([^/]+)\/([^/]+)\/$/);
  if (companyLookup3Match) {
    const companyIdOrSearch = companyLookup3Match[1];
    const realmId = Number(companyLookup3Match[2]) || 0;
    const companyName = decodeURIComponent(companyLookup3Match[3]);
    const info = lookupCompany(realmId, companyName || companyIdOrSearch);
    sendJson(res, info);
    return true;
  }

  const companyLookup2Match = pathname.match(/^\/api\/v2\/company-lookup\/([^/]+)\/([^/]+)\/$/);
  if (companyLookup2Match) {
    const realmId = Number(companyLookup2Match[1]) || 0;
    const tagOrName = decodeURIComponent(companyLookup2Match[2]);
    const info = lookupCompany(realmId, tagOrName);
    sendJson(res, info);
    return true;
  }

  if (pathname === '/api/v2/company-lookup/' || pathname.startsWith('/api/v2/company-lookup/')) {
    const query = searchParams.get('q') || searchParams.get('name') || searchParams.get('tag') || '1';
    const info = lookupCompany(0, query);
    sendJson(res, info);
    return true;
  }

  // 14. Polls & Challenges
  if (pathname.includes('/polls/')) {
    sendJson(res, { id: 1, question: '你最喜欢的产业是哪一个？', options: ['农业', '电子', '航空航天', '零售'] });
    return true;
  }

  if (pathname.includes('/challenges/current/')) {
    sendJson(res, { challenges: [] });
    return true;
  }

  return false;
}
