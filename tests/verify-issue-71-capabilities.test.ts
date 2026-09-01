import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

// Issue #71 regression: level capabilities are server-authoritative.
// 1) Level 0 cannot mutate research/bonds/executives/contracts (403 with unlock level).
// 2) At the unlock level the same mutations succeed.
// 3) Construct slot enforcement uses the canonical maxBuildings from levelInfo.
// 4) Fresh auth-data (refresh) capabilities match actual backend behavior.

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const time = Date.now();
  const email = `cap71_${label}_${time}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Cap71 ${label} ${time}` })
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie);
  const auth = await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } })).json();
  return { cookie, companyId: auth.authCompany.companyId };
}

function headers(cookie: string) {
  return { 'Content-Type': 'application/json', Cookie: cookie };
}

async function runIssue71CapabilitiesTest() {
  console.log('================================================================');
  console.log(' Starting Issue #71 Capability Enforcement Verification');
  console.log('================================================================');

  // ---------- Part 1: Level 0 — all four subsystem mutations must 403 ----------
  const l0 = await register('l0');
  const h0 = headers(l0.cookie);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 29, 0, 5000, 0, 0, 0, 0, 1.0, ?)')
    .run(l0.companyId, new Date().toISOString());

  console.log('[1/4] Level 0 mutations must be rejected with 403 + unlock reason...');
  const researchRes = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST', headers: h0, body: JSON.stringify({ discipline: 1, points: 10 })
  });
  assert.equal(researchRes.status, 403, 'research must be capability-gated');
  assert.match((await researchRes.json()).error, /unlocks at level 10/);

  const bondRes = await fetch(`${baseUrl}/api/v2/bonds/sell/`, {
    method: 'POST', headers: h0, body: JSON.stringify({ amount: 50000, interest: 0.005 })
  });
  assert.equal(bondRes.status, 403, 'bond issue must be capability-gated');
  assert.match((await bondRes.json()).error, /unlocks at level 10/);

  const hireRes = await fetch(`${baseUrl}/api/v4/executives/hire/`, {
    method: 'POST', headers: h0, body: JSON.stringify({ candidateId: 1, position: 'unassigned' })
  });
  assert.equal(hireRes.status, 403, 'executive hire must be capability-gated');
  assert.match((await hireRes.json()).error, /unlocks at level 15/);

  const contractRes = await fetch(`${baseUrl}/api/v2/contracts/`, {
    method: 'POST', headers: h0, body: JSON.stringify({ recipient: 999902, kind: 54, quality: 0, amount: 10, price: 100 })
  });
  assert.equal(contractRes.status, 403, 'contract send must be capability-gated');
  // Issue #99: contracts unlock at level 2 (was the tier-table level 5).
  assert.match((await contractRes.json()).error, /unlocks at level 2/);
  console.log('  -> research/bonds/executives/contracts all 403 with unlock-at-level reason');

  // ---------- Part 2: Level 10 — unlocked subsystems succeed ----------
  console.log('[2/4] Level 10 unlocks research/bonds/contracts (executives stays locked)...');
  const l10 = await register('l10');
  db.prepare('UPDATE companies SET level = 10, money = 1000000, simboosts = 5000 WHERE company_id = ?').run(l10.companyId);
  const h10 = headers(l10.cookie);
  db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at) VALUES (?, 29, 0, 5000, 0, 0, 0, 0, 1.0, ?)')
    .run(l10.companyId, new Date().toISOString());

  const researchL10 = await fetch(`${baseUrl}/api/v3/players/research/apply/`, {
    method: 'POST', headers: h10, body: JSON.stringify({ discipline: 1, points: 10 })
  });
  assert.equal(researchL10.status, 200, 'research must work at its unlock level 10');

  const bondL10 = await fetch(`${baseUrl}/api/v2/bonds/sell/`, {
    method: 'POST', headers: h10, body: JSON.stringify({ amount: 50000, interest: 0.005 })
  });
  assert.equal(bondL10.status, 200, 'bond issue must work at its unlock level 10');

  const hireL10 = await fetch(`${baseUrl}/api/v4/executives/hire/`, {
    method: 'POST', headers: h10, body: JSON.stringify({ candidateId: 1, position: 'unassigned' })
  });
  assert.equal(hireL10.status, 403, 'executives must stay locked until 15');
  console.log('  -> unlocked subsystems return 200, still-locked executives 403');

  // ---------- Part 3: Canonical slot policy ----------
  console.log('[3/4] Construct slot limit equals levelInfo.maxBuildings (canonical)...');
  const authL10 = await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: h10 })).json();
  const maxBuildings = authL10.levelInfo.maxBuildings;
  assert.equal(maxBuildings, 6, 'level 10 tier maxBuildings must be 6 (no extra slots)');

  // Highest allowed position = maxBuildings - 1; first locked = maxBuildings.
  const lockedPos = await fetch(`${baseUrl}/api/v2/companies/me/buildings/`, {
    method: 'POST', headers: h10, body: JSON.stringify({ kind: 'P', position: String(maxBuildings) })
  });
  assert.equal(lockedPos.status, 400, 'position == maxBuildings must be locked');
  assert.match((await lockedPos.json()).error, /locked/);
  console.log(`  -> construct rejects position ${maxBuildings} (canonical maxBuildings=${maxBuildings})`);

  // ---------- Part 4: Refresh persistence ----------
  console.log('[4/4] Fresh auth-data capabilities match actual behavior...');
  const refreshed = await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: h0 })).json();
  const caps = refreshed.levelInfo.capabilities;
  assert.equal(caps.research, false);
  assert.equal(caps.bonds, false);
  assert.equal(caps.executives, false);
  assert.equal(caps.contracts, false);
  assert.equal(refreshed.levelInfo.maxBuildings, 4, 'level 0 canonical maxBuildings must be 4');
  console.log('  -> refresh returns caps all-false at L0, consistent with the 403s above');

  console.log('================================================================');
  console.log(' ✅ ISSUE #71 CAPABILITY ENFORCEMENT PASSED ALL CHECKS');
  console.log('================================================================\n');
}

runIssue71CapabilitiesTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
