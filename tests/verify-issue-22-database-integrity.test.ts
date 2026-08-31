import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `dbint_${label}_${Date.now()}@simcompanies.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', company: `DbInt-${label}-${Date.now()}` })
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(v => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie);
  const auth = (await (await fetch(`${baseUrl}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } })).json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

async function runDatabaseIntegrityTest() {
  console.log('================================================================');
  console.log(' Starting Issue #22 Database Integrity & Constraints Verification');
  console.log('================================================================');

  // 1. Verify PRAGMA foreign_keys is ON
  console.log('[1/4] Verifying PRAGMA foreign_keys = ON...');
  const fkRow = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  assert.equal(fkRow.foreign_keys, 1, 'foreign_keys PRAGMA must be enabled (1)');
  console.log('  -> PRAGMA foreign_keys = ON confirmed');

  // 2. Verify UNIQUE indexes exist
  console.log('[2/4] Verifying UNIQUE indexes exist on critical tables...');
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uq_%'").all() as { name: string }[];
  const indexNames = indexes.map(i => i.name);
  assert.ok(indexNames.includes('uq_buildings_company_position'), 'uq_buildings_company_position must exist');
  assert.ok(indexNames.includes('uq_warehouse_company_kind_quality'), 'uq_warehouse_company_kind_quality must exist');
  assert.ok(indexNames.includes('uq_research_company_discipline'), 'uq_research_company_discipline must exist');
  assert.ok(indexNames.includes('uq_display_case_company_slot'), 'uq_display_case_company_slot must exist');
  console.log(`  -> Found ${indexNames.length} UNIQUE indexes: ${indexNames.join(', ')}`);

  // 3. Verify duplicate building position is rejected
  console.log('[3/4] Verifying duplicate (company_id, position) building is rejected...');
  const user = await register('dup');
  // The user already has buildings at position 0 and 1 from registration
  let duplicateRejected = false;
  try {
    db.prepare('INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at) VALUES (?, ?, ?, 1, ?, 6900, ?, ?)')
      .run(user.companyId, '0', 'P', 'Dup Farm', 'production', new Date().toISOString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.ok(msg.includes('UNIQUE constraint failed'), `Expected UNIQUE constraint error, got: ${msg}`);
    duplicateRejected = true;
  }
  assert.ok(duplicateRejected, 'Duplicate (company_id, position) must be rejected by UNIQUE index');
  console.log('  -> Duplicate building position correctly rejected by DB constraint');

  // 4. Verify duplicate warehouse row is rejected
  console.log('[4/4] Verifying duplicate (company_id, kind, quality) warehouse row is rejected...');
  let warehouseDupRejected = false;
  try {
    db.prepare('INSERT INTO warehouse (company_id, kind, quality, amount, cost_market, updated_at) VALUES (?, ?, 0, 100, 1.0, ?)')
      .run(user.companyId, 1, new Date().toISOString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.ok(msg.includes('UNIQUE constraint failed'), `Expected UNIQUE constraint error, got: ${msg}`);
    warehouseDupRejected = true;
  }
  assert.ok(warehouseDupRejected, 'Duplicate warehouse row must be rejected by UNIQUE index');
  console.log('  -> Duplicate warehouse row correctly rejected by DB constraint');

  console.log('================================================================');
  console.log(' [OK] ISSUE #22 DATABASE INTEGRITY PASSED ALL CHECKS');
  console.log('================================================================');
}

runDatabaseIntegrityTest().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
