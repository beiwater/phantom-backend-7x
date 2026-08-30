import { db } from '../db/database.ts';
import { getCompanyById, updateCompanySimBoosts, type CompanyRow } from './company.ts';

export interface NewspaperIssueDbRow {
  id: number;
  issue_id: number;
  realm_id: number;
  published: string | null;
  created_at: string;
}

export interface NewspaperArticleDbRow {
  id: number;
  newspaper_id: number;
  realm_id: number;
  title: string;
  type: string;
  copy1: string;
  copy2: string;
  copy3: string;
  author_company_id: number | null;
  author_company_name: string | null;
  translated_by_id: number | null;
  translated_by_name: string | null;
  position: number;
  reactions_json: string;
  reaction_count: number;
  charts_json: string;
  outdated: number;
  created_at: string;
}

export interface NewspaperSponsorDbRow {
  id: number;
  newspaper_id: number;
  position: number;
  company_id: number;
  company_name: string;
  text: string;
  logo: string;
  created_at: string;
}

function findCompany(idOrCompanyId: number): CompanyRow | null {
  const byComp = getCompanyById(idOrCompanyId);
  if (byComp) return byComp;
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(idOrCompanyId) as CompanyRow | undefined;
  return row || null;
}

// 1. Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS newspaper_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER,
    realm_id INTEGER DEFAULT 0,
    published TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS newspaper_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    newspaper_id INTEGER,
    realm_id INTEGER DEFAULT 0,
    title TEXT,
    type TEXT DEFAULT 'CUSTOM',
    copy1 TEXT,
    copy2 TEXT,
    copy3 TEXT,
    author_company_id INTEGER,
    author_company_name TEXT,
    translated_by_id INTEGER,
    translated_by_name TEXT,
    position INTEGER DEFAULT 0,
    reactions_json TEXT DEFAULT '{}',
    reaction_count INTEGER DEFAULT 0,
    charts_json TEXT DEFAULT '[]',
    outdated INTEGER DEFAULT 0,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS newspaper_sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    newspaper_id INTEGER,
    position INTEGER,
    company_id INTEGER,
    company_name TEXT,
    text TEXT,
    logo TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS newspaper_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    newspaper_id INTEGER,
    article_id INTEGER,
    company_id INTEGER,
    reaction TEXT,
    created_at TEXT
  );
`);

// 2. Seed initial issues & articles
(function seedNewspaperData() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM newspaper_issues').get() as { count: number };
  if (countRow.count === 0) {
    const now = new Date();
    const publishedDate1 = new Date(now.getTime() - 7 * 86400000).toISOString();
    const publishedDate2 = new Date(now.getTime() - 86400000).toISOString();

    const insertIssue = db.prepare('INSERT INTO newspaper_issues (issue_id, realm_id, published, created_at) VALUES (?, ?, ?, ?)');
    insertIssue.run(1, 0, publishedDate1, publishedDate1);
    insertIssue.run(2, 0, publishedDate2, publishedDate2);
    insertIssue.run(3, 0, null, new Date().toISOString());

    const insertArticle = db.prepare(`
      INSERT INTO newspaper_articles 
      (newspaper_id, realm_id, title, type, copy1, copy2, copy3, author_company_id, author_company_name, translated_by_id, translated_by_name, position, reactions_json, reaction_count, charts_json, outdated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertArticle.run(
      2, 0, '市场全品类现货贸易与宏观经济展望', 'MARKET_VIEW',
      'SimCompanies 私人服务器市场全品类现货供应充沛，从初级农业、高纯度化学品到高科技电子与航空航天部件均呈现活跃交易。',
      '高科技与零售产业链日趋完善，各大企业通过高品质研发与规模化生产获得了显著的经济效益。',
      '随着自由贸易的发展，更多企业建立起了稳定的供销合同合作关系，整体市场流动性强劲。',
      999901, 'Sim Companies Times', 999902, 'Chief Editor',
      0, JSON.stringify({ THUMBS_UP: 15, REWARD: 4 }), 19, '[]', 0, publishedDate2
    );

    insertArticle.run(
      2, 0, '新手起步指南：从农场到高科技工业帝国', 'CUSTOM',
      '建议初入市场的公司首先在空闲土地上兴建 Farm（农场）并采购水与电力排产基础作物。',
      '积累初始利润后，可逐步升级产业结构，向上游精细化工、芯片电子乃至航天制造进军。',
      '合理利用零售终端（如生鲜超市、加油站）可以有效加速资金回笼，实现良性滚雪球发展。',
      999903, 'Economic Review', null, null,
      1, JSON.stringify({ THUMBS_UP: 28, REWARD: 6 }), 34, '[]', 0, publishedDate2
    );

    insertArticle.run(
      2, 0, '科研突破：专利投入与全品类品质跃升', 'RESEARCH',
      '最新行业研究表明，高品质（Q1-Q12）产品在高端零售与政府订单竞标中具有无可替代的定价优势。',
      '加大实验室科技研发投入，不仅能提升单位产能收益，还能显著巩固企业在行业细分赛道的壁垒。',
      '多家头部企业已开始布局物理与航空研发，预计下一季度高星级产品供给将迎来爆发式增长。',
      999904, 'Research Weekly', null, null,
      2, JSON.stringify({ THUMBS_UP: 12, REWARD: 3 }), 15, '[]', 0, publishedDate2
    );

    insertArticle.run(
      2, 0, '企业供求标签：精准连接上下游产业链', 'TAGS',
      '供求标签系统上线后，各企业只需标记主营采购与供应品类，即可被全服合作伙伴迅速检索与联系。',
      '高效的标签匹配大幅缩减了撮合沟通成本，加速了各类大宗期货与现货合同的履约。',
      '建议各公司定期维护自身标签池，展示企业当前最核心的产能与采购意向。',
      999905, 'Supply Chain Journal', null, null,
      3, JSON.stringify({ THUMBS_UP: 10, REWARD: 2 }), 12, '[]', 0, publishedDate2
    );

    const insertSponsor = db.prepare('INSERT INTO newspaper_sponsors (newspaper_id, position, company_id, company_name, text, logo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertSponsor.run(2, 0, 1, 'Alpha Energy Corp', 'Top quality Power & Water supplier. Reliable long-term daily contracts available!', '', publishedDate2);
    insertSponsor.run(2, 1, 2, 'Global Logistics', 'Fast freight & transport services across all realms. Best bulk rates.', '', publishedDate2);
    insertSponsor.run(2, 2, 3, 'Apex Aerospace', 'Premier supplier of high-tech guidance systems and rocket fuel.', '', publishedDate2);
  }
})();

// 3. Issue & Article Functions
export function getNewspaperIssues(realmId: number = 0, belowId?: number, limit: number = 20) {
  let query = 'SELECT * FROM newspaper_issues WHERE realm_id = ?';
  const params: (number | string)[] = [realmId];
  if (belowId !== undefined && !isNaN(belowId)) {
    query += ' AND issue_id < ?';
    params.push(belowId);
  }
  query += ' ORDER BY issue_id DESC LIMIT ?';
  params.push(limit);

  const issues = db.prepare(query).all(...params) as NewspaperIssueDbRow[];
  return issues.map((iss) => ({
    id: iss.id,
    issueId: iss.issue_id,
    realmId: iss.realm_id,
    published: iss.published,
    articles: db.prepare('SELECT id, title, position, type FROM newspaper_articles WHERE newspaper_id = ? ORDER BY position ASC').all(iss.id) as Array<{ id: number; title: string; position: number; type: string }>
  }));
}

export function getNewspaperIssue(issueId: number, realmId: number = 0) {
  let issue = db.prepare('SELECT * FROM newspaper_issues WHERE issue_id = ? AND realm_id = ?').get(issueId, realmId) as NewspaperIssueDbRow | undefined;
  if (!issue) issue = db.prepare('SELECT * FROM newspaper_issues WHERE issue_id = ?').get(issueId) as NewspaperIssueDbRow | undefined;
  if (!issue) issue = db.prepare('SELECT * FROM newspaper_issues ORDER BY issue_id DESC LIMIT 1').get() as NewspaperIssueDbRow | undefined;
  return issue ? formatNewspaperIssue(issue) : null;
}

export function getNewspaperIssueById(newspaperId: number) {
  const issue = db.prepare('SELECT * FROM newspaper_issues WHERE id = ?').get(newspaperId) as NewspaperIssueDbRow | undefined;
  return issue ? formatNewspaperIssue(issue) : null;
}

function formatNewspaperIssue(issue: NewspaperIssueDbRow) {
  const articleRows = db.prepare('SELECT * FROM newspaper_articles WHERE newspaper_id = ? ORDER BY position ASC').all(issue.id) as NewspaperArticleDbRow[];
  const articles = articleRows.map((r) => formatArticleRow(r, issue));
  const sponsorRows = db.prepare('SELECT * FROM newspaper_sponsors WHERE newspaper_id = ?').all(issue.id) as NewspaperSponsorDbRow[];
  const result: Record<string, unknown> = {
    id: issue.id,
    issueId: issue.issue_id,
    realmId: issue.realm_id,
    published: issue.published,
    articles
  };
  for (const sp of sponsorRows) {
    result[`sponsor${sp.position}`] = { companyName: sp.company_name, companyId: sp.company_id, text: sp.text, logo: sp.logo || '' };
  }
  return result;
}

function formatArticleRow(r: NewspaperArticleDbRow, issue?: NewspaperIssueDbRow) {
  let reactions: Record<string, number> = {};
  try { reactions = JSON.parse(r.reactions_json || '{}'); } catch {}
  let charts: unknown[] = [];
  try { charts = JSON.parse(r.charts_json || '[]'); } catch {}

  return {
    id: r.id,
    title: r.title,
    type: r.type || 'CUSTOM',
    copy1: r.copy1 || '',
    copy2: r.copy2 || '',
    copy3: r.copy3 || '',
    author: r.author_company_id ? { id: r.author_company_id, company: r.author_company_name || 'Anonymous', deleted: false } : null,
    translatedBy: r.translated_by_id ? { id: r.translated_by_id, company: r.translated_by_name || 'Editor', deleted: false } : null,
    position: r.position ?? 0,
    newspaper: issue ? { id: issue.id, realmId: issue.realm_id, issueId: issue.issue_id } : { id: r.newspaper_id, realmId: r.realm_id, issueId: 1 },
    reactions,
    reactionCount: r.reaction_count || 0,
    charts,
    outdated: Boolean(r.outdated),
    featureHqIdx: null
  };
}

export function getArticleById(articleId: number) {
  const r = db.prepare('SELECT * FROM newspaper_articles WHERE id = ?').get(articleId) as NewspaperArticleDbRow | undefined;
  if (!r) return null;
  const issue = db.prepare('SELECT * FROM newspaper_issues WHERE id = ?').get(r.newspaper_id) as NewspaperIssueDbRow | undefined;
  return formatArticleRow(r, issue);
}

export function createArticle(newspaperId: number, type: string = '1', authorCompanyId?: number) {
  const issue = db.prepare('SELECT * FROM newspaper_issues WHERE id = ?').get(newspaperId) as NewspaperIssueDbRow | undefined;
  const realmId = issue ? issue.realm_id : 0;
  const maxPosRow = db.prepare('SELECT MAX(position) as maxPos FROM newspaper_articles WHERE newspaper_id = ?').get(newspaperId) as { maxPos: number | null };
  const position = (maxPosRow.maxPos ?? -1) + 1;
  const comp = authorCompanyId ? findCompany(authorCompanyId) : null;
  const authorName = comp ? comp.name : 'Sim Companies Times';

  const res = db.prepare(`
    INSERT INTO newspaper_articles 
    (newspaper_id, realm_id, title, type, copy1, copy2, copy3, author_company_id, author_company_name, position, reactions_json, reaction_count, charts_json, outdated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newspaperId, realmId, '新专栏文章', type === 'free column article' ? 'CUSTOM' : 'MARKET_VIEW',
    '文章正文第一段...', '文章正文第二段...', '文章正文第三段...', comp?.company_id || authorCompanyId || 999901, authorName,
    position, '{}', 0, '[]', 0, new Date().toISOString()
  );
  return getArticleById(Number(res.lastInsertRowid));
}

export function updateArticle(articleId: number, data: { title?: string; copy1?: string; copy2?: string; copy3?: string; position?: number | string; author?: string; translatedBy?: string; charts?: unknown[] }) {
  const current = db.prepare('SELECT * FROM newspaper_articles WHERE id = ?').get(articleId) as NewspaperArticleDbRow | undefined;
  if (!current) throw new Error('Article not found');

  let newPos = current.position;
  if (data.position === 'switch') {
    newPos = (current.position % 2 === 0) ? current.position + 1 : current.position - 1;
  } else if (typeof data.position === 'number') {
    newPos = data.position;
  }

  let authorName = data.author ?? current.author_company_name;
  let authorId = current.author_company_id;
  if (data.author) {
    const compRow = db.prepare('SELECT company_id, name FROM companies WHERE name = ?').get(data.author) as { company_id: number; name: string } | undefined;
    if (compRow) { authorId = compRow.company_id; authorName = compRow.name; }
  }

  db.prepare(`
    UPDATE newspaper_articles SET
      title = ?, copy1 = ?, copy2 = ?, copy3 = ?, position = ?,
      author_company_id = ?, author_company_name = ?,
      translated_by_name = ?, charts_json = ?
    WHERE id = ?
  `).run(
    data.title ?? current.title, data.copy1 ?? current.copy1, data.copy2 ?? current.copy2, data.copy3 ?? current.copy3,
    newPos, authorId, authorName, data.translatedBy ?? current.translated_by_name,
    data.charts ? JSON.stringify(data.charts) : current.charts_json, articleId
  );
  return getArticleById(articleId);
}

export function deleteArticle(articleId: number) {
  db.prepare('DELETE FROM newspaper_articles WHERE id = ?').run(articleId);
  db.prepare('DELETE FROM newspaper_reactions WHERE article_id = ?').run(articleId);
  return { success: true };
}

export function getTopArticlesByReaction(realmId: number = 0, _reactionType: string = 'THUMBS_UP', limit: number = 15) {
  const rows = db.prepare(`
    SELECT a.*, i.issue_id, i.realm_id as issue_realm_id
    FROM newspaper_articles a
    LEFT JOIN newspaper_issues i ON a.newspaper_id = i.id
    WHERE a.realm_id = ? OR i.realm_id = ?
    ORDER BY a.reaction_count DESC, a.id DESC LIMIT ?
  `).all(realmId, realmId, limit) as Array<NewspaperArticleDbRow & { issue_id: number; issue_realm_id: number }>;

  return {
    topArticles: rows.map((r) => ({
      id: r.id,
      title: r.title,
      author: r.author_company_name ? { company: r.author_company_name, id: r.author_company_id } : { company: 'Sim Companies Times' },
      newspaper: { realmId: r.issue_realm_id ?? realmId, issueId: r.issue_id ?? 1, id: r.newspaper_id },
      reactionCount: r.reaction_count || 0
    }))
  };
}

export function getArticlesByAuthor(companyId: number) {
  const comp = findCompany(companyId);
  const searchId = comp ? comp.company_id : companyId;
  const rows = db.prepare('SELECT id FROM newspaper_articles WHERE author_company_id = ? ORDER BY id DESC').all(searchId) as Array<{ id: number }>;
  return rows.map((r) => getArticleById(r.id));
}

export function getArticlesBySubstring(realmId: number = 0, query: string = '') {
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT id FROM newspaper_articles 
    WHERE (realm_id = ?) AND (title LIKE ? OR copy1 LIKE ? OR copy2 LIKE ? OR copy3 LIKE ?)
    ORDER BY id DESC LIMIT 20
  `).all(realmId, pattern, pattern, pattern, pattern) as Array<{ id: number }>;
  return rows.map((r) => getArticleById(r.id));
}

// 4. Reactions System
export function getCompanyReactionsForNewspaper(newspaperId: number, companyId: number) {
  const comp = findCompany(companyId);
  const searchId = comp ? comp.company_id : companyId;
  const rows = db.prepare('SELECT article_id, reaction FROM newspaper_reactions WHERE newspaper_id = ? AND (company_id = ? OR company_id = ?)').all(newspaperId, searchId, companyId) as Array<{ article_id: number; reaction: string }>;
  return rows.map((r) => ({ articleId: r.article_id, reaction: r.reaction }));
}

export function addArticleReaction(articleId: number, companyId: number, reaction: string) {
  const article = db.prepare('SELECT * FROM newspaper_articles WHERE id = ?').get(articleId) as NewspaperArticleDbRow | undefined;
  if (!article) throw new Error('Article not found');

  const comp = findCompany(companyId);
  const actualCompanyId = comp ? comp.company_id : companyId;

  if (reaction === 'REWARD') {
    if (!comp || comp.simboosts < 5) throw new Error('Not enough SimBoosts to reward article (need 5 SimBoosts)');
    updateCompanySimBoosts(actualCompanyId, -5);
    if (article.author_company_id && article.author_company_id !== actualCompanyId) {
      updateCompanySimBoosts(article.author_company_id, 5);
    }
  }

  const existing = db.prepare('SELECT id FROM newspaper_reactions WHERE article_id = ? AND (company_id = ? OR company_id = ?) AND reaction = ?').get(articleId, actualCompanyId, companyId, reaction);
  if (!existing) {
    db.prepare('INSERT INTO newspaper_reactions (newspaper_id, article_id, company_id, reaction, created_at) VALUES (?, ?, ?, ?, ?)').run(
      article.newspaper_id, articleId, actualCompanyId, reaction, new Date().toISOString()
    );
  }

  let reactions: Record<string, number> = {};
  try { reactions = JSON.parse(article.reactions_json || '{}'); } catch {}
  reactions[reaction] = (reactions[reaction] || 0) + 1;
  const newReactionCount = Object.values(reactions).reduce((a, b) => a + b, 0);

  db.prepare('UPDATE newspaper_articles SET reactions_json = ?, reaction_count = ? WHERE id = ?').run(
    JSON.stringify(reactions), newReactionCount, articleId
  );
  return { success: true, reaction, count: reactions[reaction] };
}

export function removeArticleReaction(articleId: number, companyId: number, reaction: string) {
  const article = db.prepare('SELECT * FROM newspaper_articles WHERE id = ?').get(articleId) as NewspaperArticleDbRow | undefined;
  if (!article) throw new Error('Article not found');

  const comp = findCompany(companyId);
  const actualCompanyId = comp ? comp.company_id : companyId;

  db.prepare('DELETE FROM newspaper_reactions WHERE article_id = ? AND (company_id = ? OR company_id = ?) AND reaction = ?').run(articleId, actualCompanyId, companyId, reaction);

  let reactions: Record<string, number> = {};
  try { reactions = JSON.parse(article.reactions_json || '{}'); } catch {}
  if (reactions[reaction] && reactions[reaction] > 0) reactions[reaction] -= 1;
  const newReactionCount = Object.values(reactions).reduce((a, b) => a + b, 0);

  db.prepare('UPDATE newspaper_articles SET reactions_json = ?, reaction_count = ? WHERE id = ?').run(
    JSON.stringify(reactions), newReactionCount, articleId
  );
  return { success: true, reaction, count: reactions[reaction] || 0 };
}

// 5. Sponsors & Ads System
export function getSponsorParams() {
  return {
    0: { title: 'Bronze Sponsor', subTitle: '(Slots 3-10)', charLimit: 140 },
    1: { title: 'Silver Sponsor', subTitle: '(Slots 1-2)', charLimit: 200 },
    2: { title: 'Golden Sponsor', subTitle: '(Slot 0)', charLimit: 280 }
  };
}

export function getSponsorsForNewspaper(newspaperId: number) {
  const rows = db.prepare('SELECT * FROM newspaper_sponsors WHERE newspaper_id = ?').all(newspaperId) as NewspaperSponsorDbRow[];
  const sponsors: Record<number, unknown> = {};
  for (const r of rows) {
    sponsors[r.position] = { companyName: r.company_name, companyId: r.company_id, text: r.text, logo: r.logo || '' };
  }
  return { sponsors, pricing: { goldenPrice: 20, silverPrice: 10, bronzePrice: 5 } };
}

export function buyNewspaperSponsor(newspaperId: number, position: number, companyId: number, text: string = 'Top quality goods available on exchange and contracts!', priceOverride?: number) {
  const price = priceOverride ?? (position === 0 ? 20 : position <= 2 ? 10 : 5);
  const comp = findCompany(companyId);
  if (!comp || comp.simboosts < price) {
    throw new Error(`Not enough SimBoosts to place sponsor ad (requires ${price} SimBoosts)`);
  }

  updateCompanySimBoosts(comp.company_id, -price);
  db.prepare('DELETE FROM newspaper_sponsors WHERE newspaper_id = ? AND position = ?').run(newspaperId, position);
  db.prepare(`
    INSERT INTO newspaper_sponsors (newspaper_id, position, company_id, company_name, text, logo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newspaperId, position, comp.company_id, comp.name, text, comp.logo || '', new Date().toISOString());

  return { companyName: comp.name, companyId: comp.company_id, text, logo: comp.logo || '' };
}

export function updateNewspaperSponsorText(newspaperId: number, position: number, companyId: number, text: string) {
  const comp = findCompany(companyId);
  const actualId = comp ? comp.company_id : companyId;
  const existing = db.prepare('SELECT * FROM newspaper_sponsors WHERE newspaper_id = ? AND position = ?').get(newspaperId, position) as NewspaperSponsorDbRow | undefined;
  if (!existing) throw new Error('Sponsor slot not found');
  if (existing.company_id !== actualId && existing.company_id !== companyId) throw new Error('Not authorized to edit this ad');

  db.prepare('UPDATE newspaper_sponsors SET text = ? WHERE newspaper_id = ? AND position = ?').run(text, newspaperId, position);
  return { companyName: existing.company_name, companyId: existing.company_id, text, logo: existing.logo || '' };
}
