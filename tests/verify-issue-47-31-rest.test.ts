/**
 * Issue #47 + #31 regression tests (rest items).
 *
 * #47: a building under construction/upgrade (busy_until in the future) must
 * reject, with 409 CONFLICT:
 *   - start production (POST /api/v1/buildings/:id/busy/ with kind/amount)
 *   - repeated upgrade (PATCH /api/v2/companies/me/buildings/:id/ { size })
 * The busy marker is authoritative even with an empty production queue
 * (a freshly constructed building has no queue rows yet). Active recreation
 * upkeep (busy category 'u', P1-09) legitimately occupies busy_until and is
 * exempt: the upkeep start itself already 409s when busy (verify-round3-
 * leisure-move.test.ts) and lift/place stay allowed (P1-10 semantics).
 *
 * #31: replacing a building (PATCH .../ { rebuild: true } → replaceExisting)
 * must NOT silently delete a building that still has an active (resolved=0)
 * production queue — that orphans the queue rows forever (inputs never
 * refunded, output never collectible). Server responds 409 'cancel production
 * first'; after cancelling, the replace succeeds and no orphan rows remain.
 * Historical resolved queue rows are allowed to remain.
 *
 * Run: PORT=3604 node --experimental-strip-types tests/verify-issue-47-31-rest.test.ts
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3604'}`;


const send = async (method: string, p: string, body?: unknown, cookie?: string) => {
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
};

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `i4731_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Issue4731 Co ${label} ${Date.now()}` })
  });
  assert.equal(res.status, 200, `signup must succeed, got ${res.status}`);
  const cookie = (res.headers.getSetCookie?.() || [])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'signup must set sessionid cookie');
  const auth = await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie! } })).json() as { authCompany: AuthCompany };
  return { cookie: cookie!, companyId: auth.authCompany.companyId };
}

/** Open the shared game DB read-only for orphan-row assertions. */
function openDb(): DatabaseSync {
  const dbPath = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'simcompanies.sqlite')
    : path.join(process.cwd(), 'data', 'simcompanies.sqlite');
  return new DatabaseSync(dbPath, { readOnly: true });
}

async function main(): Promise<void> {
  const db = openDb();

  // ------------------------------------------------------------------
  // Issue #47-①: start production during construction busy → 409
  // ------------------------------------------------------------------
  {
    const { cookie } = await register('busy-prod');
    const construct = await send('POST', '/api/v2/companies/me/buildings/', { kind: 'P', position: '2' }, cookie);
    assert.equal(construct.status, 200, 'construct must succeed');
    const buildingId = (construct.json as { building: { id: number } }).building.id;
    assert.ok((construct.json as { building: { busy: { duration: number } | null } }).building.busy,
      'fresh construction must carry a busy marker');

    const premature = await send('POST', `/api/v1/buildings/${buildingId}/busy/`, { kind: 66, amount: 100 }, cookie);
    assert.equal(premature.status, 409,
      `start production during construction busy must be 409, got ${premature.status}: ${JSON.stringify(premature.json)}`);

    // No queue row may have been created by the rejected request.
    const queue = await send('GET', `/api/v2/companies/buildings/${buildingId}/queue/`, undefined, cookie);
    const queueItems = (queue.json ?? []) as unknown[];
    assert.equal(queueItems.length, 0, 'rejected production start must not create a queue row');

    // After the busy window the same request succeeds.
    await new Promise(r => setTimeout(r, 11000));
    const after = await send('POST', `/api/v1/buildings/${buildingId}/busy/`, { kind: 66, amount: 100 }, cookie);
    assert.equal(after.status, 200, `production must start after construction completes, got ${after.status}: ${JSON.stringify(after.json)}`);
    console.log('PASS #47: production during construction busy → 409; allowed after completion');
  }

  // ------------------------------------------------------------------
  // Issue #47-②: repeated upgrade during construction/upgrade busy → 409
  // ------------------------------------------------------------------
  {
    const { cookie } = await register('busy-upg');
    const construct = await send('POST', '/api/v2/companies/me/buildings/', { kind: 'P', position: '2' }, cookie);
    assert.equal(construct.status, 200);
    const buildingId = (construct.json as { building: { id: number } }).building.id;

    const repeat = await send('PATCH', `/api/v2/companies/me/buildings/${buildingId}/`, { size: 2 }, cookie);
    assert.equal(repeat.status, 409,
      `upgrade during construction busy must be 409, got ${repeat.status}: ${JSON.stringify(repeat.json)}`);

    // Upgrade after completion works and re-arms the busy window.
    await new Promise(r => setTimeout(r, 11000));
    const upgrade = await send('PATCH', `/api/v2/companies/me/buildings/${buildingId}/`, { size: 2 }, cookie);
    assert.equal(upgrade.status, 200, `upgrade after busy must succeed, got ${upgrade.status}`);
    const upgradedId = ((upgrade.json as { building?: { id: number } }).building?.id) ?? buildingId;

    // Immediate second upgrade inside the new busy window → 409 again.
    const repeat2 = await send('PATCH', `/api/v2/companies/me/buildings/${upgradedId}/`, { size: 3 }, cookie);
    assert.equal(repeat2.status, 409,
      `repeated upgrade inside upgrade busy must be 409, got ${repeat2.status}: ${JSON.stringify(repeat2.json)}`);
    console.log('PASS #47: upgrade during busy → 409 (construction and upgrade windows)');
  }

  // ------------------------------------------------------------------
  // Issue #31: replaceExisting must not orphan an active queue
  // ------------------------------------------------------------------
  {
    const { cookie, companyId } = await register('orphan');

    const countOrphans = (): number => (db.prepare(`
      SELECT COUNT(*) AS c FROM production_queues pq
      LEFT JOIN buildings b ON b.id = pq.building_id
      WHERE b.id IS NULL AND pq.resolved = 0 AND pq.company_id = ?
    `).get(companyId) as { c: number }).c;

    // Seed production on the pre-seeded farm (position 0).
    const list = await send('GET', '/api/v2/companies/me/buildings/', undefined, cookie);
    const farm = ((list.json ?? []) as Array<{ id: number; kind: string }>).find(b => b.kind === 'P');
    assert.ok(farm, 'seeded farm must exist');

    const start = await send('POST', `/api/v1/buildings/${farm!.id}/busy/`, { kind: 66, amount: 35 }, cookie);
    assert.equal(start.status, 200, 'production start must succeed');

    // Replace while the queue is ACTIVE → 409, building survives.
    const replaceBusy = await send('PATCH', `/api/v2/companies/me/buildings/${farm!.id}/`, { rebuild: true }, cookie);
    assert.equal(replaceBusy.status, 409,
      `replace with active queue must be 409, got ${replaceBusy.status}: ${JSON.stringify(replaceBusy.json)}`);
    assert.match(String((replaceBusy.json as { error?: string }).error), /cancel production/i,
      '409 must tell the player to cancel production first');
    assert.equal(countOrphans(), 0, 'rejected replace must not orphan queue rows');

    const details = await send('GET', `/api/v2/companies/me/buildings/${farm!.id}/`, undefined, cookie);
    assert.equal(details.status, 200, 'building must survive the rejected replace');
    const queue = await send('GET', `/api/v2/companies/buildings/${farm!.id}/queue/`, undefined, cookie);
    assert.equal((((queue.json ?? []) as unknown[])).length, 1, 'active queue item must survive the rejected replace');

    // Cancel production → replace now succeeds.
    const cancel = await send('DELETE', `/api/v1/buildings/${farm!.id}/busy/`, undefined, cookie);
    assert.equal(cancel.status, 200, 'cancel must succeed');

    const replace = await send('PATCH', `/api/v2/companies/me/buildings/${farm!.id}/`, { rebuild: true }, cookie);
    assert.equal(replace.status, 200,
      `replace after cancel must succeed, got ${replace.status}: ${JSON.stringify(replace.json)}`);
    assert.equal(countOrphans(), 0, 'replace after cancel must not leave unresolved orphan rows');
    console.log('PASS #31: replace with active queue → 409; after cancel → 200 and no orphan rows');
  }

  db.close();
  console.log('\nALL Issue #47/#31 rest regressions PASS');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Issue #47/#31 FAIL:', err); process.exit(1); });
