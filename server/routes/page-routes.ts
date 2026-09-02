import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import { companyRepository } from '../repositories/company-repository.ts';
/**
 * P1-03: Static page / guide article content route.
 *
 * Root cause: the frontend library ("文库") renders every guide entry as a link
 * to /:locale/pages/:slug/ and the article viewer fetches
 * GET /api/v3/:locale/pages/:slug/ (api_v3_pages in the frontend bundle).
 * No backend route served that endpoint, so every guide article the reader
 * clicked returned 404 {code: 'API_NOT_FOUND'}.
 *
 * Response schema consumed by the article viewer (component rFi):
 *   { slug, slugTitle, title, body, language, lastUpdate, otherLanguages }
 * - `title` is rendered in the h3 heading.
 * - `body` is injected with dangerouslySetInnerHTML.
 * - `lastUpdate` is parsed with Date.parse (rendered via date/time components).
 * - `otherLanguages` must be an array (length drives the language picker).
 * - On fetch error the viewer renders the raw error string: hence missing
 *   slugs must still return 200 with a "内容建设中" placeholder instead of 404.
 */

const PLACEHOLDER_TITLE_ZH = '内容建设中';
const NOT_TRANSLATED_ZH =
  '很抱歉，文库中的文章和指南都是由社区撰写提交，暂时都还只有英文版本。汉化组正在努力翻译中 >_<。';

interface GuideEntry {
  /** URL slug used by /:locale/pages/:slug/ */
  slug: string;
  /** English title (guides are community-authored in English) */
  title: string;
  /** zh-cn title from the frontend locale catalog */
  titleZh: string;
  /** English placeholder body; guides are not yet translated */
  bodyEn: string;
}

const guideBody = (title: string): string =>
  `<p>This guide (<b>${title}</b>) is part of the community-written Sim Companies library. ` +
  `A full rewrite for the private server is in progress; the mechanics described here follow the original game.</p>` +
  `<p>Chinese translation is being worked on by the localization team.</p>`;

/**
 * Complete catalog of /pages/ slugs referenced by the frontend bundle
 * (L().pages("...") calls) plus the /articles/* static routes.
 */
export const GUIDE_CATALOG: GuideEntry[] = [
  { slug: 'realms-guide', title: 'Realms guide', titleZh: '域：简介', bodyEn: guideBody('Realms guide') },
  { slug: 'faq', title: 'Frequently asked questions', titleZh: '常见问题', bodyEn: guideBody('Frequently asked questions') },
  { slug: 'guide-for-beginners', title: 'Guide for beginners', titleZh: '新人指南', bodyEn: guideBody('Guide for beginners') },
  { slug: 'interface-tips', title: 'Interface tips', titleZh: '界面提示', bodyEn: guideBody('Interface tips') },
  { slug: 'supported-platforms', title: 'Supported platforms', titleZh: '支持平台', bodyEn: guideBody('Supported platforms') },
  { slug: 'research-guide', title: 'Research guide', titleZh: '研究指南', bodyEn: guideBody('Research guide') },
  { slug: 'construction-guide', title: 'Construction industry guide', titleZh: '建筑业指南', bodyEn: guideBody('Construction industry guide') },
  { slug: 'bonds-guide', title: 'Bonds guide', titleZh: '债券指南', bodyEn: guideBody('Bonds guide') },
  { slug: 'robotics-and-specialization', title: 'Robotics and specialization', titleZh: '机器人技术和专业', bodyEn: guideBody('Robotics and specialization') },
  { slug: 'executives-guide', title: 'Executives guide', titleZh: '高管指南', bodyEn: guideBody('Executives guide') },
  { slug: 'government-orders', title: 'Government orders guide', titleZh: '政府订单指南', bodyEn: guideBody('Government orders guide') },
  { slug: 'aerospace', title: 'Aerospace industry guide', titleZh: '航空航天业指南', bodyEn: guideBody('Aerospace industry guide') },
  { slug: 'restaurant-guide', title: 'Restaurant guide', titleZh: '餐馆指南', bodyEn: guideBody('Restaurant guide') },
  { slug: 'collectibles-guide', title: 'Collectibles guide', titleZh: '收藏品指南', bodyEn: guideBody('Collectibles guide') },
  { slug: 'reference-prices', title: 'Reference prices and market limits', titleZh: '参考价格和市场限价', bodyEn: guideBody('Reference prices and market limits') },
  { slug: 'supporters-guide', title: 'Supporters guide', titleZh: '支持者指南', bodyEn: guideBody('Supporters guide') },
  { slug: 'submission-guide', title: 'Submission to Sim Companies Times guidelines', titleZh: '提交《Sim Companies时报》文章规则', bodyEn: guideBody('Submission to Sim Companies Times guidelines') },
  { slug: 'economy-model', title: 'Economy simulation model', titleZh: '经济模拟模型', bodyEn: guideBody('Economy simulation model') },
  { slug: 'future-development', title: 'Future development', titleZh: '未来发展', bodyEn: guideBody('Future development') },
  { slug: 'moderators-guide', title: 'Moderators guide', titleZh: '协管指南', bodyEn: guideBody('Moderators guide') },
  { slug: 'suggesting-features', title: 'Suggesting features', titleZh: '建议游戏功能', bodyEn: guideBody('Suggesting features') },
  { slug: 'abundance', title: 'Abundance', titleZh: '丰度', bodyEn: guideBody('Abundance') },
  { slug: 'leveling', title: 'Leveling and Experience Gain', titleZh: '升级和经验获取', bodyEn: guideBody('Leveling and Experience Gain') },
  { slug: 'buildings', title: 'Buildings', titleZh: '建筑', bodyEn: guideBody('Buildings') },
  { slug: 'building-auctions', title: 'Building auctions', titleZh: '建筑拍卖', bodyEn: guideBody('Building auctions') },
  { slug: 'teacher-guide', title: 'Teachers guide', titleZh: '教师指南', bodyEn: guideBody('Teachers guide') }
];

const ARTICLE_CATALOG: Record<string, { title: string; titleZh: string }> = {
  'time-table': { title: 'Time table', titleZh: '时间表' },
  'change-log': { title: 'Change log', titleZh: '变更日志' },
  'generative-ai-disclosure': { title: 'Generative AI disclosure', titleZh: '生成式人工智能声明' },
  'q-and-a-session': { title: 'Q & A session', titleZh: '常见问题' }
};

const GUIDE_BY_SLUG: Record<string, GuideEntry> = Object.fromEntries(
  GUIDE_CATALOG.map(g => [g.slug, g])
);

const SUPPORTED_LANGUAGES = [
  'en', 'de', 'fr', 'pt', 'tr', 'it', 'es', 'zh-cn', 'zh-tw', 'cs', 'pl', 'ru', 'ja'
];

/** GET /api/v3/:locale/pages/:slug/ */
export function getPageArticle(locale: string, rawSlug: string): {
  status: number;
  payload: Record<string, unknown> | null;
} {
  // The frontend sanitizes the slug with Gsn() ([^a-z-] stripped); be equally strict.
  const slug = String(rawSlug).toLowerCase().replace(/[^a-z-]/g, '');
  const lang = SUPPORTED_LANGUAGES.includes(locale) ? locale : 'en';

  if (!slug) {
    return { status: 404, payload: { error: 'Page not found', code: 'PAGE_NOT_FOUND', path: `/api/v3/${locale}/pages/` } };
  }

  const guide = GUIDE_BY_SLUG[slug];
  const article = ARTICLE_CATALOG[slug];
  if (!guide && !article) {
    // Unknown slug: serve an explicit placeholder page (P1-03 contract: no 404
    // for catalog entries; unknown slugs never appear in the catalog).
    return {
      status: 200,
      payload: buildArticle(lang, slug, PLACEHOLDER_TITLE_ZH, PLACEHOLDER_TITLE_ZH,
        `<p>${NOT_TRANSLATED_ZH}</p>`)
    };
  }

  const title = guide ? guide.title : article!.title;
  const titleZh = guide ? guide.titleZh : article!.titleZh;
  const bodyEn = guide ? guide.bodyEn : '';
  return {
    status: 200,
    payload: buildArticle(lang, slug, title, titleZh, `<p>${NOT_TRANSLATED_ZH}</p>${bodyEn}`)
  };
}

function buildArticle(lang: string, slug: string, title: string, titleZh: string, body: string) {
  return {
    slug,
    slugTitle: slug,
    title: lang === 'en' ? title : titleZh,
    body,
    language: lang,
    lastUpdate: new Date().toISOString(),
    otherLanguages: SUPPORTED_LANGUAGES.map(code => ({ code, title }))
  };
}

export async function handlePageRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentPlayerId?: number | null
): Promise<boolean> {
  if (method !== 'GET') return false;

  // Admin Control Panel route — requires an authenticated admin session
  // (Issue #121: the panel previously rendered for anonymous visitors).
  if (pathname === '/admin-xSwwtH67Cr' || pathname === '/admin-xSwwtH67Cr/') {
    let isAdmin = false;
    if (currentPlayerId) {
      isAdmin = companyRepository.isPlayerAdmin(currentPlayerId);
    }
    if (!isAdmin) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body><h1>403 Forbidden</h1><p>Administrator authentication required.</p></body></html>');
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Dashboard - Sim Companies</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #1a1a1a; color: #eee; margin: 0; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; background: #2a2a2a; border-radius: 8px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
    h1 { color: #4CAF50; border-bottom: 1px solid #444; padding-bottom: 12px; margin-top: 0; }
    .card { background: #333; padding: 16px; border-radius: 6px; margin-bottom: 16px; }
    .status { color: #8bc34a; font-weight: bold; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    a { color: #64b5f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sim Companies Admin Control Panel</h1>
    <div class="card">
      <h3>System Status</h3>
      <p>Server Status: <span class="status">ONLINE</span></p>
      <p>Audit System: <span class="status">OPERATIONAL</span></p>
    </div>
    <div class="card">
      <h3>Admin Quick Links</h3>
      <ul>
        <li><a href="/api/v2/audits/">Audits Log (/api/v2/audits/)</a></li>
        <li><a href="/api/v2/moderator-notes/">Moderator Notes (/api/v2/moderator-notes/)</a></li>
        <li><a href="/api/v2/messages-cases/">Reported Messages Cases (/api/v2/messages-cases/)</a></li>
        <li><a href="/api/v2/newcomers/">Newcomers (/api/v2/newcomers/)</a></li>
        <li><a href="/api/v2/audit/recently-deleted/">Recently Deleted (/api/v2/audit/recently-deleted/)</a></li>
        <li><a href="/api/v2/audit/suspended-companies/">Suspended Companies (/api/v2/audit/suspended-companies/)</a></li>
      </ul>
    </div>
  </div>
</body>
</html>`);
    return true;
  }

  // Frontend api_v3_pages: GET /api/v3/pages/:locale/:slug/
  const pageMatch = pathname.match(/^\/api\/v3\/pages\/([a-z-]+)\/([a-z0-9-]+)\/$/);
  if (pageMatch) {
    const { status, payload } = getPageArticle(pageMatch[1], pageMatch[2]);
    sendJson(res, payload, status);
    return true;
  }

  return false;
}
