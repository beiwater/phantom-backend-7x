import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { handleNewspaperRoutes } from '../server/routes/newspaper-routes.ts';
import { getNewspaperIssue, getNewspaperIssues, getArticleById } from '../server/game/newspaper.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface DispatchResult {
  status: number;
  body: Record<string, unknown>;
}

async function dispatch(url: string, playerId: number | null = null): Promise<DispatchResult> {
  const req = { url, method: 'GET', headers: {} } as unknown as IncomingMessage;
  let status = 200;
  let responseData = '';
  const res = {
    statusCode: 200,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(code: number) { status = code; },
    end(chunk?: unknown) { if (chunk) responseData = String(chunk); }
  } as unknown as ServerResponse;

  const parsed = new URL(url, 'http://127.0.0.1');
  const handled = await handleNewspaperRoutes(req, res, parsed.pathname, 'GET', playerId);
  assert.ok(handled, `route must be handled: ${url}`);
  return { status, body: responseData ? (JSON.parse(responseData) as Record<string, unknown>) : {} };
}

const realmId = 194;
db.prepare('DELETE FROM newspaper_issues WHERE realm_id = ?').run(realmId);
db.prepare('DELETE FROM newspaper_articles WHERE realm_id = ?').run(realmId);

const nowIso = new Date().toISOString();
// Insert published issue 1
const pubRes = db.prepare('INSERT INTO newspaper_issues (issue_id, realm_id, published, created_at) VALUES (?, ?, ?, ?)').run(
  1, realmId, nowIso, nowIso
);
const pubIssueDbId = Number(pubRes.lastInsertRowid);

// Insert unpublished issue 2
const unpubRes = db.prepare('INSERT INTO newspaper_issues (issue_id, realm_id, published, created_at) VALUES (?, ?, NULL, ?)').run(
  2, realmId, nowIso
);
const unpubIssueDbId = Number(unpubRes.lastInsertRowid);

// Insert article for published issue
const pubArt = db.prepare(`
  INSERT INTO newspaper_articles (newspaper_id, realm_id, title, type, copy1, author_company_id, author_company_name, position, reactions_json, reaction_count, charts_json, outdated, created_at)
  VALUES (?, ?, 'Published Article', 'CUSTOM', 'Body 1', 1, 'Co', 0, '{}', 0, '[]', 0, ?)
`).run(pubIssueDbId, realmId, nowIso);

// Insert article for unpublished issue
const unpubArt = db.prepare(`
  INSERT INTO newspaper_articles (newspaper_id, realm_id, title, type, copy1, author_company_id, author_company_name, position, reactions_json, reaction_count, charts_json, outdated, created_at)
  VALUES (?, ?, 'Unpublished Article', 'CUSTOM', 'Body 2', 1, 'Co', 0, '{}', 0, '[]', 0, ?)
`).run(unpubIssueDbId, realmId, nowIso);

// 1. Published issue is accessible
const pubView = await dispatch(`/api/v3/realms/${realmId}/newspaper/1/`, null);
assert.equal(pubView.status, 200);
assert.equal(pubView.body.issueId, 1);
assert.equal(pubView.body.published, nowIso);

// 2. Direct access to unpublished issue by regular player is blocked (404)
const unpubView = await dispatch(`/api/v3/realms/${realmId}/newspaper/2/`, null);
assert.equal(unpubView.status, 404, 'Unpublished issue must return 404 for regular players');

// 3. Non-existent issue returns 404 (does NOT fallback to latest)
const nonExistent = await dispatch(`/api/v3/realms/${realmId}/newspaper/999/`, null);
assert.equal(nonExistent.status, 404, 'Non-existent issue must return 404, not fallback');

// 4. Archive issue list only contains published issues
const issuesList = getNewspaperIssues(realmId, undefined, 20, false);
assert.equal(issuesList.length, 1);
assert.equal(issuesList[0].issueId, 1);

// 5. Unpublished article direct access is blocked
const unpubArticleRes = await dispatch(`/api/v3/newspaper/articles/${unpubArt.lastInsertRowid}/`, null);
assert.equal(unpubArticleRes.status, 404, 'Article of unpublished issue must return 404');

const pubArticleRes = await dispatch(`/api/v3/newspaper/articles/${pubArt.lastInsertRowid}/`, null);
assert.equal(pubArticleRes.status, 200);

console.log('PASS unpublished newspaper issues and articles are blocked from direct access (#194)');
