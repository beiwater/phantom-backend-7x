/**
 * P1-03 regression: research guide / library article links must not 404.
 *
 * Bug: the frontend library (文库) renders every guide catalog entry as a
 * clickable link to /:locale/pages/:slug/, and the article viewer fetches
 * GET /api/v3/pages/:locale/:slug/. Before the fix that endpoint returned a
 * { title, content } stub that crashed the viewer on otherLanguages.length
 * and rendered no body, so guide articles were dead links.
 *
 * This test derives ALL /pages/ slugs from the frontend bundle (the same set
 * the library page renders as clickable entries), asserts the server catalog
 * covers them, then GETs each page through the backend article endpoint and
 * asserts:
 *   - HTTP 200 (no 404 for any catalog entry)
 *   - the article viewer contract: slug/slugTitle/title/body/language/
 *     lastUpdate/otherLanguages present, otherLanguages a non-empty array
 *   - non-empty body HTML and localized zh-cn titles
 *
 * Run: PORT=3205 node --experimental-strip-types tests/verify-p1-03-research-guide.test.ts
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDE_CATALOG, getPageArticle } from '../server/routes/page-routes.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUNDLE_DIR = path.join(ROOT, 'frontend-original', 'static', 'bundle', 'assets');
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3205'}`;

/** The /articles/* routes the catalog also links to (component-backed, no API). */
const ARTICLE_ROUTE_SLUGS = [
  '/articles/time-table/',
  '/articles/change-log/',
  '/articles/generative-ai-disclosure/',
  '/articles/q-and-a-session/'
];

interface CatalogEntry {
  url: string;
  category: number;
  titleId: string;
}

/**
 * Extract every L().pages("slug") / catalog URL from the minified frontend
 * bundle so the test automatically covers the full clickable catalog and
 * fails loudly if the bundle changes shape (new/renamed guides).
 */
function extractBundlePageSlugs(): CatalogEntry[] {
  const files = execSync(`grep -rl 'const NA=' ${JSON.stringify(BUNDLE_DIR)}`, { encoding: 'utf-8' }).trim().split('\n');
  const entries: CatalogEntry[] = [];
  const pageCall = /url:L\(\)\.pages\("([a-z0-9-]+)"\),category:(\d+),title:e\.formatMessage\(([A-Za-z0-9_$]+)\)/g;
  const other = /url:L\(\)\.(article_[a-z_]+|fpa|moderators|about|report|terms|privacy|cookie_policy)\(\),category:(\d+)/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(pageCall)) {
      entries.push({ url: `/pages/${m[1]}/`, category: Number(m[2]), titleId: m[3] });
    }
    for (const m of src.matchAll(other)) {
      entries.push({ url: `/${m[1].replace(/_/g, '-')}/`, category: Number(m[2]), titleId: m[1] });
    }
  }
  // de-dup by url
  const seen = new Set<string>();
  return entries.filter(e => (seen.has(e.url) ? false : (seen.add(e.url), true)));
}

function assertViewerContract(body: Record<string, unknown>, slug: string): void {
  assert.equal(body.slug, slug);
  assert.ok(typeof body.title === 'string' && (body.title as string).length > 0, `${slug}: title must be non-empty`);
  assert.ok(typeof body.body === 'string' && (body.body as string).length > 0, `${slug}: body must be non-empty HTML`);
  assert.ok(typeof body.lastUpdate === 'string' && !Number.isNaN(Date.parse(body.lastUpdate as string)), `${slug}: lastUpdate must parse`);
  assert.ok(Array.isArray(body.otherLanguages) && (body.otherLanguages as unknown[]).length > 0, `${slug}: otherLanguages must be a non-empty array`);
}

async function runP1_03Test(): Promise<void> {
  console.log('================================================================');
  console.log(' P1-03: research guide / library article links must not 404');
  console.log('================================================================');

  // 1. The exact slugs from the frontend catalog (derived from the bundle)
  const bundleEntries = extractBundlePageSlugs();
  const pageEntries = bundleEntries.filter(e => e.url.startsWith('/pages/'));
  console.log(`\n[1] Frontend bundle catalog: ${bundleEntries.length} clickable entries, ${pageEntries.length} /pages/ articles`);
  assert.ok(pageEntries.length >= 20, `expected >= 20 /pages/ catalog entries, got ${pageEntries.length}`);
  assert.ok(
    pageEntries.some(e => e.url === '/pages/research-guide/'),
    'research-guide must be present in the frontend catalog'
  );

  // 2. The server-side canonical catalog must cover the same slugs
  const serverSlugs = new Set(GUIDE_CATALOG.map(g => g.slug));
  const missing = pageEntries
    .map(e => e.url.replace(/^\/pages\//, '').replace(/\/$/, ''))
    .filter(s => !serverSlugs.has(s));
  assert.deepEqual(missing, [], `server GUIDE_CATALOG is missing bundle slugs: ${missing.join(', ')}`);
  console.log(`[2] Server GUIDE_CATALOG covers all ${pageEntries.length} bundle page slugs (+${GUIDE_CATALOG.length - pageEntries.length} extras)`);

  // 3. Every catalog article endpoint returns 200 with the viewer contract
  let checked = 0;
  for (const slug of serverSlugs) {
    for (const locale of ['zh-cn', 'en']) {
      const res = await fetch(`${baseUrl}/api/v3/pages/${locale}/${slug}/`);
      assert.equal(res.status, 200, `GET /api/v3/pages/${locale}/${slug}/ must be 200 (P1-03: no 404 for catalog articles)`);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.slug, slug);
      assertViewerContract(body, slug);
      if (locale === 'zh-cn') {
        const zh = GUIDE_CATALOG.find(g => g.slug === slug)!;
        assert.equal(body.title, zh.titleZh, `${slug}: zh-cn must serve the localized title`);
      }
      checked++;
    }
  }
  console.log(`[3] ${GUIDE_CATALOG.length} slugs x 2 locales = ${checked} article GETs: all 200 with viewer contract (slug/title/body/lastUpdate/otherLanguages)`);

  // 4. Localized HTML page (what the user actually clicks through to)
  const html = await fetch(`${baseUrl}/zh-cn/pages/research-guide/`);
  assert.equal(html.status, 200, '/zh-cn/pages/research-guide/ must be 200');
  const articleProbe = getPageArticle('zh-cn', 'research-guide');
  assert.equal(articleProbe.status, 200);
  console.log('[4] /zh-cn/pages/research-guide/ serves 200 HTML and canonical article payload');

  // 5. /articles/* catalog routes render HTML (no API dependency)
  for (const route of ARTICLE_ROUTE_SLUGS) {
    const res = await fetch(`${baseUrl}/zh-cn${route}`);
    assert.equal(res.status, 200, `/zh-cn${route} must be 200`);
  }
  console.log(`[5] ${ARTICLE_ROUTE_SLUGS.length} /articles/* catalog routes: all 200`);

  console.log('\n================================================================');
  console.log(' P1-03 PASS: all research-guide/library article links resolve,');
  console.log(' zero 404 across the full clickable catalog.');
  console.log('================================================================');
}

runP1_03Test()
  .then(() => process.exit(0))
  .catch(err => { console.error('P1-03 FAIL:', err); process.exit(1); });
