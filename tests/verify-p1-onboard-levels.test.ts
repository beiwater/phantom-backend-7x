import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

// Regression test for P1-04 (company name must not come from device/user-agent
// data; naming flow must persist) and P1-05 (production collect awards
// experience in the same transaction; level+experience persist and level-ups
// derive from thresholds).
//
// Requires a running private server:
//   PORT=3204 DATA_DIR=<dir> node --experimental-strip-types server/index.ts
//   BASE_URL=http://127.0.0.1:3204 node --experimental-strip-types tests/verify-p1-onboard-levels.test.ts

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3204'}`;

interface AuthData {
  authCompany: {
    company: string;
    companyId: number;
    level: number;
  };
  levelInfo: {
    level: number;
    experience: number;
    experienceToNextLevel: number;
    maxBuildings: number;
  } | null;
}

function sessionCookie(res: Response): string {
  const cookie = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'session cookie must be set');
  return cookie;
}

async function authData(cookie: string): Promise<AuthData> {
  const res = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return res.json() as Promise<AuthData>;
}

async function runTest(): Promise<void> {
  console.log('================================================================');
  console.log(' P1-04 / P1-05 Onboarding Naming + Level Experience Verification');
  console.log('================================================================');

  // ---------- P1-04: registration must not derive company name from device data ----------
  console.log('[1/7] Guest registration does NOT use user-agent-derived company name...');
  const timestamp = Date.now();
  const regRes = await fetch(`${baseUrl}/api/v2/auth/device/auth/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Deliberately hostile user-agent: the old bug named companies after it.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Mac OS 10.15.7) AppleWebKit/537.36 Chrome/999.0'
    },
    body: JSON.stringify({})
  });
  assert.equal(regRes.status, 200);
  const regBody = await regRes.json() as { status: string; redirectUrl: string };
  assert.equal(regBody.status, 'redirect');
  assert.equal(regBody.redirectUrl, '/zh-cn/create/',
    'new players must be sent to the /create/ naming flow');
  const cookie = sessionCookie(regRes);

  const firstAuth = await authData(cookie);
  assert.equal(firstAuth.authCompany.company, '',
    'new company name must be empty (triggers frontend naming flow), not a device string');
  assert.ok(!/mac|os|chrome|android|mozilla/i.test(firstAuth.authCompany.company),
    'company name must not contain user-agent fragments');
  console.log(`  -> redirectUrl=/zh-cn/create/, company=${JSON.stringify(firstAuth.authCompany.company)} (empty) OK`);

  // ---------- P1-04: empty name rejected, named company persists ----------
  console.log('[2/7] Empty/short company name rejected with 400...');
  const emptyRes = await fetch(`${baseUrl}/api/v3/companies/me/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ company: 'ab' })
  });
  assert.equal(emptyRes.status, 400, 'names shorter than 4 chars must be rejected');

  const name = `P1 Onboard Co ${timestamp}`;
  const patchRes = await fetch(`${baseUrl}/api/v3/companies/me/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ company: name })
  });
  assert.equal(patchRes.status, 200, `naming PATCH failed: ${await patchRes.text()}`);

  const namedAuth = await authData(cookie);
  assert.equal(namedAuth.authCompany.company, name, 'company name must match the PATCH payload');
  console.log(`  -> named company persisted: ${name}`);

  // ---------- P1-04: duplicate name rejected with suggestions ----------
  console.log('[3/7] Duplicate company name conflicts and returns suggestions...');
  const reg2Res = await fetch(`${baseUrl}/api/v2/auth/device/auth/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(reg2Res.status, 200);
  const cookie2 = sessionCookie(reg2Res);
  const dupRes = await fetch(`${baseUrl}/api/v3/companies/me/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
    body: JSON.stringify({ company: name })
  });
  assert.equal(dupRes.status, 400, 'duplicate name must be rejected');
  const dupBody = await dupRes.json() as { error?: string; suggestions?: string[] };
  assert.ok(Array.isArray(dupBody.suggestions) && dupBody.suggestions.length > 0,
    'conflict response must include name suggestions like the original API');
  console.log(`  -> conflict suggestions: ${dupBody.suggestions!.slice(0, 2).join(' / ')}`);

  // ---------- P1-05: production start for the named company ----------
  console.log('[4/7] Start a farm production order...');
  const buildingsRes = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, { headers: { Cookie: cookie } });
  assert.equal(buildingsRes.status, 200);
  const buildings = await buildingsRes.json() as Array<{ id: number; category?: string; kind?: string }>;
  const farm = buildings.find(b => b.category === 'production' || b.kind === 'P');
  assert.ok(farm, 'seeded farm building must exist');

  const queueRes = await fetch(`${baseUrl}/api/v2/companies/buildings/${farm!.id}/queue/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ kind: 3, amount: 5, quality: 0 }) // apples
  });
  const queueText = await queueRes.text();
  assert.equal(queueRes.status, 200, `queue start failed: ${queueText}`);
  const queue = JSON.parse(queueText) as { id: number; duration: number; finishes: string };
  assert.ok(queue.id > 0);
  console.log(`  -> queue ${queue.id} started, duration ${queue.duration}s`);

  // ---------- P1-05: collect awards experience; response carries levelInfo ----------
  console.log('[5/7] Collect finished production -> experience awarded in collect response...');
  const waitMs = Math.max(0, Date.parse(queue.finishes) - Date.now()) + 500;
  await new Promise(r => setTimeout(r, waitMs));

  // Arrange: pin the company at level 1 with experience 9 XP below the
  // level-up threshold (Issue #99 canonical table: L1 -> L2 delta is 11 XP)
  // so this single collect (10 XP) both raises experience AND proves
  // threshold-derived level-ups. Level is pinned to 1 because getAuthData
  // clamps displayed level to >= 1 (upstream behavior), which would
  // otherwise make lvlBefore inconsistent with the DB row.
  db.prepare('UPDATE companies SET level = 1, experience = 2 WHERE company_id = ?')
    .run(firstAuth.authCompany.companyId);
  const before = await authData(cookie);
  const lvlBefore = before.levelInfo!.level;
  assert.equal(lvlBefore, 1, 'arranged company must report level 1');

  const collectRes = await fetch(`${baseUrl}/api/v2/order/take/${queue.id}/`, {
    method: 'POST', headers: { Cookie: cookie }
  });
  const collectText = await collectRes.text();
  assert.equal(collectRes.status, 200, `collect failed: ${collectText}`);
  const collectBody = JSON.parse(collectText) as {
    success: boolean;
    levelInfo: { level: number; experience: number; experienceToNextLevel: number } | null;
    levelUp: boolean;
    experienceGained: number;
  };
  assert.equal(collectBody.success, true);
  assert.ok(collectBody.levelInfo, 'collect response MUST carry levelInfo (frontend HUD reads it)');
  assert.equal(collectBody.experienceGained, 10, 'collect must award +10 XP');
  assert.equal(collectBody.levelInfo!.level, lvlBefore + 1,
    'crossing the XP threshold must advance the level inside the same collect');
  assert.equal(collectBody.levelInfo!.experience, 1,
    'leftover XP after level-up must equal gained - threshold remainder (12 - 11)');
  assert.equal(collectBody.levelInfo!.experienceToNextLevel, 12,
    'experienceToNextLevel must be the canonical cumulative delta for L2 (Issue #99)');
  console.log(`  -> lvl ${lvlBefore} -> ${collectBody.levelInfo!.level}, exp ${collectBody.levelInfo!.experience}/${collectBody.levelInfo!.experienceToNextLevel}, levelUp=${collectBody.levelUp}`);

  // ---------- P1-05: new GET keeps level + experience (persisted, no rollback) ----------
  console.log('[6/7] Fresh auth-data GET keeps level + experience (persisted)...');
  const after = await authData(cookie);
  assert.equal(after.levelInfo!.level, collectBody.levelInfo!.level, 'level must persist after refresh');
  assert.equal(after.levelInfo!.experience, collectBody.levelInfo!.experience, 'experience must persist after refresh');
  assert.equal(after.authCompany.level, collectBody.levelInfo!.level, 'authCompany.level must mirror persisted level');
  console.log(`  -> GET after collect: lvl ${after.levelInfo!.level}, exp ${after.levelInfo!.experience}/${after.levelInfo!.experienceToNextLevel} OK`);

  // ---------- P1-05: collect is idempotent (no double XP) ----------
  console.log('[7/7] Re-collecting the same order must not award XP twice...');
  const replay = await fetch(`${baseUrl}/api/v2/order/take/${queue.id}/`, {
    method: 'POST', headers: { Cookie: cookie }
  });
  assert.equal(replay.status, 409, 'already-collected order must fail with Conflict');
  const replayAuth = await authData(cookie);
  assert.equal(replayAuth.levelInfo!.experience, collectBody.levelInfo!.experience, 'no duplicate XP on replay');
  assert.equal(replayAuth.levelInfo!.level, collectBody.levelInfo!.level, 'no duplicate level-up on replay');
  console.log('  -> replay rejected (409), XP unchanged OK');

  console.log('================================================================');
  console.log(' ✅ P1-04 / P1-05 ONBOARD + LEVELS PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
