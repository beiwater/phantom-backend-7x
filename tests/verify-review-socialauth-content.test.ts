import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'review-socialauth-content-'));
// Dynamic imports intentionally defer database/module seeding until the isolated DATA_DIR is set.
const { db, registerPlayer } = await import('../server/db/database.ts');
const { runInTransaction } = await import('../server/db/transaction.ts');
const { claimAchievement, getIndividualAchievements, getAchievementsOverview, getAchievementStats } = await import('../server/game/achievements.ts');
const newspaper = await import('../server/game/newspaper.ts');
const { handleNewspaperRoutes } = await import('../server/routes/newspaper-routes.ts');
const { companyId } = registerPlayer(`content_${Date.now()}@test.local`, 'Password123!', 'Content Regression');

// Fresh seeding must link each article to the inserted row, never the edition number.
const seeded = newspaper.getNewspaperIssues(0, undefined, 20, true);
assert.equal(seeded.length, 13);
assert.equal(seeded.filter(issue => issue.published).length, 12);
for (const issue of seeded) assert.equal(issue.articles.length, issue.published ? 4 : 0);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newspaper_articles a JOIN newspaper_issues i ON i.id = a.newspaper_id WHERE i.published IS NULL').get()?.n, 0);

// Scientist uses authoritative discipline patents, persists one tier and pays the next reward.
db.prepare('INSERT INTO research (company_id, discipline, points, patents) VALUES (?, 1, 600, 12)').run(companyId);
assert.equal(getAchievementStats(companyId).maxResearchQuality, 1);
assert.equal(runInTransaction(() => claimAchievement(companyId, 'Scientist')).reward, 8000);
let scientist = getAchievementsOverview(companyId).find(achievement => achievement.id === 'scientist')!;
assert.equal(scientist.stars, 1);
assert.equal(scientist.reward, 40000);
assert.equal(scientist.progress.percent, 50);
assert.ok(scientist.action);
assert.throws(() => claimAchievement(companyId, 'scientist'), /criteria not met/);
db.prepare('UPDATE research SET patents = 62 WHERE company_id = ?').run(companyId);
assert.equal(getIndividualAchievements(companyId).find(achievement => achievement.id === 'scientist')?.reward, 40000);
assert.equal(claimAchievement(companyId, 'scientist').reward, 40000);
assert.throws(() => claimAchievement(companyId, 'Scientist'), /criteria not met/);
scientist = getAchievementsOverview(companyId).find(achievement => achievement.id === 'scientist')!;
assert.equal(scientist.stars, 2);
assert.equal(scientist.reward, 450000);
db.prepare('UPDATE research SET patents = 157562 WHERE company_id = ?').run(companyId);
const remainingRewards = [450000, 1500000, 4000000, 8000000, 8000000, 3000000, 3000000, 3000000, 3000000, 3000000];
for (const reward of remainingRewards) assert.equal(claimAchievement(companyId, 'Scientist').reward, reward);
assert.equal(getAchievementsOverview(companyId).find(achievement => achievement.id === 'scientist')?.stars, 12);
assert.equal(getAchievementsOverview(companyId).find(achievement => achievement.id === 'scientist')?.action, null);
assert.equal(getIndividualAchievements(companyId).some(achievement => achievement.id === 'scientist'), false);
assert.throws(() => claimAchievement(companyId, 'scientist'), /already claimed/);

// Legacy claims count as one star, and aliases cannot claim the same tier twice.
db.prepare('INSERT INTO company_achievements (company_id, achievement_id, collected_at) VALUES (?, ?, ?)').run(companyId, 'Bureaucrat', new Date().toISOString());
db.prepare('INSERT INTO government_bid_contractors (bid_secret, company_id, fulfilled) VALUES (?, ?, ?)').run('content-completed', companyId, 1);
db.prepare('INSERT INTO government_bid_contractors (bid_secret, company_id, fulfilled) VALUES (?, ?, ?)').run('content-pending', companyId, 0);
assert.equal(getAchievementStats(companyId).governmentOrdersCompleted, 1);
assert.throws(() => claimAchievement(companyId, 'bureaucrat'), /criteria not met/);
db.prepare('UPDATE government_bid_contractors SET fulfilled = 1 WHERE bid_secret = ?').run('content-pending');
assert.equal(claimAchievement(companyId, 'GOBureaucrat').reward, 50000);
assert.equal(getAchievementsOverview(companyId).find(achievement => achievement.id === 'bureaucrat')?.stars, 2);

// The Thursday cutoff is inclusive, and overdue publication rolls once per realm.
const realmId = companyId;
const createdAt = '2026-09-30T16:00:00.000Z';
const occurrence = new Date('2026-10-01T16:00:00.000Z');
assert.equal(newspaper.nextPublishDate(new Date(createdAt)).toISOString(), occurrence.toISOString());
const inserted = db.prepare('INSERT INTO newspaper_issues (issue_id, realm_id, published, created_at) VALUES (1, ?, NULL, ?)').run(realmId, createdAt);
const issueId = Number(inserted.lastInsertRowid);
const article = newspaper.createArticle(issueId, '1', companyId)!;
newspaper.updateArticle(article.id, { title: 'Unpublished secret', copy1: 'Never leak draft content' });
newspaper.buyNewspaperSponsor(issueId, 0, companyId, 'Paid advertisement');
assert.equal(newspaper.getArticleById(article.id), null);
assert.deepEqual(newspaper.getNewspaperIssue(1, realmId)?.articles, []);
assert.deepEqual(newspaper.getNewspaperIssues(realmId, undefined, 20, true)[0].articles, []);

let responseBody = '';
const req = { url: `/api/v3/realms/${realmId}/newspaper/`, headers: {} } as IncomingMessage;
const res = { setHeader() {}, getHeader() { return undefined; }, writeHead() {}, end(chunk: string) { responseBody = String(chunk); } } as unknown as ServerResponse;
assert.equal(await handleNewspaperRoutes(req, res, req.url!, 'GET', null, null), true);
const archive = JSON.parse(responseBody) as Array<{ published: string | null; articles: unknown[] }>;
assert.equal(archive.length, 1);
assert.equal(archive[0].published, null);
assert.deepEqual(archive[0].articles, []);
assert.ok(!responseBody.includes('Unpublished secret'));

newspaper.publishDueNewspaperIssues(new Date(occurrence.getTime() - 1));
assert.equal(db.prepare('SELECT published FROM newspaper_issues WHERE id = ?').get(issueId)?.published, null);
runInTransaction(() => newspaper.publishDueNewspaperIssues(occurrence));
assert.equal(db.prepare('SELECT published FROM newspaper_issues WHERE id = ?').get(issueId)?.published, occurrence.toISOString());
assert.equal(newspaper.getArticleById(article.id)?.title, 'Unpublished secret');
const sponsor = newspaper.getNewspaperIssue(1, realmId)?.sponsor0;
assert.ok(sponsor && typeof sponsor === 'object' && 'text' in sponsor);
assert.equal(sponsor.text, 'Paid advertisement');
const next = newspaper.getCurrentBookableIssue(realmId);
assert.equal(next.issue_id, 2);
assert.equal(next.published, null);
newspaper.publishDueNewspaperIssues(occurrence);
assert.equal(newspaper.getCurrentBookableIssue(realmId).id, next.id);
assert.throws(() => newspaper.buyNewspaperSponsor(issueId, 1, companyId), /already published/);
newspaper.publishDueNewspaperIssues(new Date('2026-10-22T16:00:00.000Z'));
assert.equal(newspaper.getCurrentBookableIssue(realmId).issue_id, 3);
assert.equal(newspaper.getCurrentBookableIssue(realmId).created_at, '2026-10-22T16:00:00.000Z');
console.log('PASS achievement tiers, government fulfillment counts, newspaper seeding and publication metadata');
process.exit(0);
