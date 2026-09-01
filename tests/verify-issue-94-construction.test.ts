import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

// Issue #94: canonical construction economics.
//
// Decompiled spec (server/data/decompile/buildings.json `_meta.upgradeFormula`
// and INDEX.md "建筑造价公式"):
//   qp = { 101: 4, 102: 55, 108: 16, 111: 1 }
//   resourcesForNewBuild = qp[resourceId] * costUnits * 1
//   resourcesForUpgrade  = qp[resourceId] * costUnits * currentSize
//   scrap refund         = 50% of construction materials back at quality 0
//                          (scrapValue = baseCost * size * 0.5), not cash
//   demolition guard     = remaining building valuation must stay >= 80% of
//                          the outstanding bond liability ($5,000 face value
//                          per sold bond unit), else 400 BOND_COLLATERAL_VIOLATION

// Unit-level imports: game-data and domain rules are DB-free (fs-only), so
// they can be exercised directly in the test process.
import {
  CONSTRUCTION_MATERIALS,
  DEMOLITION_REFUND_RATE,
  getBuildingCostUnits,
  getConstructionMaterials
} from '../server/game-data/buildings.ts';
import {
  estimateConstructionCost,
  estimateUpgradeCost,
  estimateDemolitionRefund,
  assertBondCollateralFloor,
  BOND_COLLATERAL_FLOOR
} from '../server/domain/buildings/building-rules.ts';

const TEST_PORT = 3820;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function isPortAvailable(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const tester = net.createServer()
    .once('error', () => resolve(false))
    .once('listening', () => {
      tester.once('close', () => resolve(true)).close();
    })
    .listen(port, '127.0.0.1');
  return promise;
}

async function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return;
      }
    } catch {
      // polling network
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 150);
    await promise;
  }
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`);
}

interface ServerInstance {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
}

async function startTestServer(): Promise<ServerInstance> {
  const portAvailable = await isPortAvailable(TEST_PORT);
  assert.ok(portAvailable, `Port ${TEST_PORT} is not available for testing`);

  const dataDir = path.resolve('data', `test-run-construction-94-${Date.now()}`);
  const nodeBinary = existsSync('/opt/magnate/.node22/bin/node')
    ? '/opt/magnate/.node22/bin/node'
    : process.execPath;

  const child = spawn(
    nodeBinary,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATA_DIR: dataDir,
        SPEED_MULTIPLIER: '100'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(str);
    }
  });

  await waitUntilReachable(`${BASE_URL}/version/`, 30000);

  return {
    child,
    dataDir,
    dbPath: path.join(dataDir, 'simcompanies.sqlite')
  };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `c94_${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}@simcompanies.local`;
  const company = `C94-${label}-${Date.now().toString(36)}`;
  const response = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', company })
  });
  assert.equal(response.status, 200, `register ${label} must succeed`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(v => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'session cookie required');
  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  const auth = (await authRes.json()) as { authCompany: { companyId: number } };
  return { cookie, companyId: auth.authCompany.companyId };
}

type WarehouseRow = { kind: number; quality: number; amount: number };

function warehouseByKind(db: DatabaseSync, companyId: number, quality = 0): Map<number, number> {
  const rows = db.prepare(
    'SELECT kind, quality, amount FROM warehouse WHERE company_id = ? AND quality = ?'
  ).all(companyId, quality) as unknown as WarehouseRow[];
  return new Map(rows.map(r => [Number(r.kind), Number(r.amount)]));
}

function warehouseDelta(before: Map<number, number>, after: Map<number, number>): Map<number, number> {
  const kinds = new Set([...before.keys(), ...after.keys()]);
  const delta = new Map<number, number>();
  for (const kind of kinds) {
    const d = (after.get(kind) ?? 0) - (before.get(kind) ?? 0);
    if (d !== 0) delta.set(kind, d);
  }
  return delta;
}

function moneyOf(db: DatabaseSync, companyId: number): number {
  const row = db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number } | undefined;
  return Number(row?.money ?? 0);
}

function clearConstructionBusy(db: DatabaseSync, buildingId: number): void {
  db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(buildingId);
}

interface ConsumedRow { db_letter: number; quality: number; amount: number }

/** Canonical qp table: { 101: 4, 102: 55, 108: 16, 111: 1 } */
const QP: Record<number, number> = { 101: 4, 102: 55, 108: 16, 111: 1 };
function expectedMaterials(costUnits: number): Record<number, number> {
  return Object.fromEntries(Object.entries(QP).map(([k, q]) => [k, q * costUnits]));
}

async function runTests() {
  console.log('================================================================');
  console.log(' Starting Issue #94 Construction Economics Verification');
  console.log(` Target Port: ${TEST_PORT}`);
  console.log('================================================================');

  const server = await startTestServer();
  const db = new DatabaseSync(server.dbPath);

  try {
    // -------------------------------------------------------------------------
    // Test 1 (unit): canonical material constants and formulas
    // -------------------------------------------------------------------------
    console.log('[Test 1] Canonical qp constants & formula math (unit level)...');
    assert.deepEqual(
      CONSTRUCTION_MATERIALS.map(m => ({ kind: m.kind, perUnit: m.perUnit })),
      [{ kind: 101, perUnit: 4 }, { kind: 102, perUnit: 55 }, { kind: 108, perUnit: 16 }, { kind: 111, perUnit: 1 }],
      'CONSTRUCTION_MATERIALS must equal the canonical qp table'
    );
    assert.equal(DEMOLITION_REFUND_RATE, 0.5, 'scrap refund rate must be 50%');

    // Mine (M): canonical costUnits = 7
    assert.equal(getBuildingCostUnits('M'), 7, 'Mine costUnits must come from the decompiled game data');
    const mineConstruct = estimateConstructionCost('M', 1);
    assert.deepEqual(
      mineConstruct.materials.map(m => ({ kind: m.kind, amount: m.amount })),
      [{ kind: 101, amount: 28 }, { kind: 102, amount: 385 }, { kind: 108, amount: 112 }, { kind: 111, amount: 7 }],
      'new-build materials must be qp * costUnits * 1'
    );

    // Upgrade materials scale with CURRENT size, not the delta
    const mineUpgradeSize3 = estimateUpgradeCost('M', 1, 3);
    assert.deepEqual(
      mineUpgradeSize3.materials.map(m => ({ kind: m.kind, amount: m.amount })),
      [{ kind: 101, amount: 84 }, { kind: 102, amount: 1155 }, { kind: 108, amount: 336 }, { kind: 111, amount: 21 }],
      'upgrade materials must be qp * costUnits * currentSize'
    );
    assert.equal(mineUpgradeSize3.cost, 6900, 'upgrade money cost still scales with the size delta');

    // Scrap refund: 50% of the construction materials, valued at baseCost * size * 0.5
    const mineScrap = estimateDemolitionRefund('M', 6900, 3);
    assert.equal(mineScrap.scrapValue, Math.floor(6900 * 3 * 0.5), 'scrapValue = baseCost * size * 0.5');
    assert.equal('moneyRefund' in mineScrap, false, 'scrap refund must not be cash');
    assert.deepEqual(
      mineScrap.materialRefund.map(m => ({ kind: m.kind, amount: m.amount })),
      [{ kind: 101, amount: 42 }, { kind: 102, amount: 577 }, { kind: 108, amount: 168 }, { kind: 111, amount: 10 }],
      'scrap materials = 50% of qp * costUnits * size, floored'
    );

    // Collateral floor boundary: equality allowed, below rejected
    assert.equal(BOND_COLLATERAL_FLOOR, 0.8);
    assert.doesNotThrow(() => assertBondCollateralFloor(16000, 20000), 'value exactly at the 80% floor is allowed');
    let violationCode = '';
    try {
      assertBondCollateralFloor(15999.99, 20000);
    } catch (err: unknown) {
      violationCode = (err as { code?: string }).code ?? '';
    }
    assert.equal(violationCode, 'BOND_COLLATERAL_VIOLATION', 'below the floor must raise BOND_COLLATERAL_VIOLATION');
    assert.doesNotThrow(() => assertBondCollateralFloor(0, 0), 'no bond liability means no constraint');
    console.log('✅ Test 1 passed');

    // -------------------------------------------------------------------------
    // Test 2 (API): construction consumes qp * costUnits
    // -------------------------------------------------------------------------
    console.log('[Test 2] Construction consumes canonical qp * costUnits materials...');
    const buyer = await registerCompany('buyer');
    const constructor_ = await registerCompany('ctor');
    const ctorHeaders = { Cookie: constructor_.cookie };

    const before = warehouseByKind(db, constructor_.companyId);
    const constructRes = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ctorHeaders },
      body: JSON.stringify({ kind: 'M', position: '2' })
    });
    const constructText = await constructRes.text();
    assert.equal(constructRes.status, 200, `construct Mine must succeed: ${constructText}`);
    const constructBody = JSON.parse(constructText) as { cost: number; building: { id: number }; resourcesConsumed: ConsumedRow[] };
    const mineId = constructBody.building.id;

    const expMine = expectedMaterials(7);
    for (const row of constructBody.resourcesConsumed) {
      assert.equal(row.quality, 0, 'construction consumes quality-0 materials');
      assert.equal(row.amount, expMine[row.db_letter], `consumed ${row.db_letter} must be qp*costUnits (${expMine[row.db_letter]})`);
    }
    const afterConstruct = warehouseByKind(db, constructor_.companyId);
    const deltaConstruct = warehouseDelta(before, afterConstruct);
    assert.deepEqual(
      Object.fromEntries(deltaConstruct),
      { 101: -28, 102: -385, 108: -112, 111: -7 },
      'warehouse must lose exactly qp * costUnits of each construction material'
    );
    assert.equal(constructBody.cost, 6900, 'Mine money cost unchanged');
    console.log('✅ Test 2 passed');

    // -------------------------------------------------------------------------
    // Test 3 (API): upgrade materials scale with the building's CURRENT size
    // -------------------------------------------------------------------------
    console.log('[Test 3] Upgrade materials scale with currentSize (not sizeDelta)...');
    // Upgrade 1 -> 2 (delta 1, currentSize 1): consumes qp * 7 * 1
    clearConstructionBusy(db, mineId);
    const up1Res = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/${mineId}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ctorHeaders },
      body: JSON.stringify({ size: 2 })
    });
    const up1Text = await up1Res.text();
    assert.equal(up1Res.status, 200, `upgrade to 2 must succeed: ${up1Text}`);
    const up1Body = JSON.parse(up1Text) as { building: { level: number }; resourcesConsumed: ConsumedRow[] };
    assert.equal(up1Body.building.level, 2);
    assert.deepEqual(
      up1Body.resourcesConsumed.map(r => [r.db_letter, r.amount]).sort((a, b) => a[0] - b[0]),
      [[101, 28], [102, 385], [108, 112], [111, 7]],
      'upgrade at currentSize=1 consumes qp * costUnits * 1'
    );

    // Upgrade 2 -> 3 (delta 1, currentSize 2): consumes qp * 7 * 2 — the old
    // sizeDelta-based code would have consumed the same as the first upgrade.
    clearConstructionBusy(db, mineId);
    const warehouseBeforeUp2 = warehouseByKind(db, constructor_.companyId);
    const up2Res = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/${mineId}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ctorHeaders },
      body: JSON.stringify({ size: 3 })
    });
    const up2Text = await up2Res.text();
    assert.equal(up2Res.status, 200, `upgrade to 3 must succeed: ${up2Text}`);
    const up2Body = JSON.parse(up2Text) as { building: { level: number }; resourcesConsumed: ConsumedRow[] };
    assert.equal(up2Body.building.level, 3);
    assert.deepEqual(
      up2Body.resourcesConsumed.map(r => [r.db_letter, r.amount]).sort((a, b) => a[0] - b[0]),
      [[101, 56], [102, 770], [108, 224], [111, 14]],
      'upgrade at currentSize=2 consumes qp * costUnits * 2 (double the delta-1 consumption)'
    );
    const deltaUp2 = warehouseDelta(warehouseBeforeUp2, warehouseByKind(db, constructor_.companyId));
    assert.deepEqual(
      Object.fromEntries(deltaUp2),
      { 101: -56, 102: -770, 108: -224, 111: -14 },
      'second upgrade must withdraw exactly the currentSize-scaled amounts'
    );
    console.log('✅ Test 3 passed');

    // -------------------------------------------------------------------------
    // Test 4 (API): scrap refund returns 50% of materials at Q0, not cash
    // -------------------------------------------------------------------------
    console.log('[Test 4] Demolition refunds materials at quality 0, no cash...');
    const scrapBefore = warehouseByKind(db, constructor_.companyId);
    const moneyBeforeScrap = moneyOf(db, constructor_.companyId);
    const demolishRes = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/${mineId}/`, {
      method: 'DELETE',
      headers: { Cookie: constructor_.cookie }
    });
    const demolishText = await demolishRes.text();
    assert.equal(demolishRes.status, 200, `demolish must succeed: ${demolishText}`);
    const demolishBody = JSON.parse(demolishText) as {
      resources: Array<{ db_letter: number; quality: number; amount: number }>;
    };
    // Demolished building: the Mine (costUnits = 7) at size 3 after Test 3.
    // Full materials = qp * 7 * 3 = [84, 1155, 336, 21]; refund = 50% floored
    // = [42, 577, 168, 10] at quality 0.
    assert.deepEqual(
      demolishBody.resources.map(r => ({ db_letter: r.db_letter, quality: r.quality, amount: r.amount }))
        .sort((a, b) => a.db_letter - b.db_letter),
      [
        { db_letter: 101, quality: 0, amount: 42 },
        { db_letter: 102, quality: 0, amount: 577 },
        { db_letter: 108, quality: 0, amount: 168 },
        { db_letter: 111, quality: 0, amount: 10 }
      ],
      'demolition response must list 50% of qp * costUnits * size at quality 0'
    );
    const moneyAfterScrap = moneyOf(db, constructor_.companyId);
    assert.equal(moneyAfterScrap, moneyBeforeScrap, 'demolition must NOT refund cash');
    const deltaScrap = warehouseDelta(scrapBefore, warehouseByKind(db, constructor_.companyId));
    assert.deepEqual(
      Object.fromEntries(deltaScrap),
      { 101: 42, 102: 577, 108: 168, 111: 10 },
      'warehouse must gain the 50% material refund at quality 0'
    );
    const listRes = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/`, { headers: ctorHeaders });
    const list = await listRes.json() as Array<{ id: number }>;
    assert.equal(list.some(b => b.id === mineId), false, 'demolished building must be gone');
    console.log('✅ Test 4 passed');

    // -------------------------------------------------------------------------
    // Test 5 (API): 80% bond collateral floor rejects demolition
    // -------------------------------------------------------------------------
    console.log('[Test 5] Demolition rejected below 80% bond collateral floor...');
    const issuer = await registerCompany('issuer');
    const issuerHeaders = { Cookie: issuer.cookie };
    const now = new Date().toISOString();
    const insertBond = db.prepare(`
      INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at)
      VALUES (?, ?, 0.005, ?, 'active', ?)
    `);
    // Issuer buildings: seeded Farm (cost 6900, size 1) + Grocery (cost 10350, size 1)
    // = 17250 total. 4 sold bond units = $20,000 liability -> 80% floor = $16,000.
    insertBond.run(issuer.companyId, buyer.companyId, 4, now);

    const issuerBuildings = db.prepare(
      'SELECT id, kind, cost, size FROM buildings WHERE company_id = ? ORDER BY position'
    ).all(issuer.companyId) as unknown as Array<{ id: number; kind: string; cost: number; size: number }>;
    const grocery = issuerBuildings.find(b => b.kind === 'G');
    assert.ok(grocery, 'issuer must have the seeded grocery store');

    const issuerWarehouseBefore = warehouseByKind(db, issuer.companyId);
    const issuerMoneyBefore = moneyOf(db, issuer.companyId);
    const rejectRes = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/${grocery.id}/`, {
      method: 'DELETE',
      headers: issuerHeaders
    });
    assert.equal(rejectRes.status, 400, `demolition below the collateral floor must be rejected (got ${rejectRes.status})`);
    const rejectBody = await rejectRes.json() as { error?: string; code?: string };
    assert.equal(rejectBody.code, 'BOND_COLLATERAL_VIOLATION', 'rejection must carry code BOND_COLLATERAL_VIOLATION');
    assert.ok(rejectBody.error, 'rejection must carry an error message');
    assert.equal(moneyOf(db, issuer.companyId), issuerMoneyBefore, 'rejected demolition must not touch money');
    assert.deepEqual(
      warehouseDelta(issuerWarehouseBefore, warehouseByKind(db, issuer.companyId)).size,
      0,
      'rejected demolition must not touch the warehouse'
    );
    const stillThere = db.prepare('SELECT COUNT(*) AS n FROM buildings WHERE id = ?').get(grocery.id) as { n: number };
    assert.equal(Number(stillThere.n), 1, 'rejected demolition must leave the building in place');

    // Positive path: soften the liability to 1 unit ($5,000, floor $4,000) —
    // remaining value after the grocery goes = 6900 >= 4000, so demolition is allowed.
    db.prepare('UPDATE bonds SET amount = 1 WHERE seller_company_id = ?').run(issuer.companyId);
    const allowRes = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/${grocery.id}/`, {
      method: 'DELETE',
      headers: issuerHeaders
    });
    assert.equal(allowRes.status, 200, `demolition above the collateral floor must succeed: ${await allowRes.text()}`);
    console.log('✅ Test 5 passed');

    // -------------------------------------------------------------------------
    // Test 6 (API): the floor protects the LAST remaining collateral
    // -------------------------------------------------------------------------
    console.log('[Test 6] Floor blocks scrapping the last backing building...');
    const lastStand = await registerCompany('last');
    insertBond.run(lastStand.companyId, buyer.companyId, 1, now);
    const lastBuildings = db.prepare(
      'SELECT id, kind, cost, size FROM buildings WHERE company_id = ? ORDER BY position'
    ).all(lastStand.companyId) as unknown as Array<{ id: number; kind: string; cost: number; size: number }>;
    const lastFarm = lastBuildings.find(b => b.kind === 'P');
    const lastGrocery = lastBuildings.find(b => b.kind === 'G');
    assert.ok(lastFarm && lastGrocery, 'last-stand company must have its two seeded buildings');

    // Demolish the farm: remaining = 10350 >= 4000 floor -> allowed.
    const okRes = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/${lastFarm.id}/`, {
      method: 'DELETE',
      headers: { Cookie: lastStand.cookie }
    });
    assert.equal(okRes.status, 200, `scrapping the farm with sufficient remaining value must succeed: ${await okRes.text()}`);

    // Demolish the grocery: remaining = 0 < 4000 floor -> rejected.
    const blockedRes = await fetch(`${BASE_URL}/api/v2/companies/me/buildings/${lastGrocery.id}/`, {
      method: 'DELETE',
      headers: { Cookie: lastStand.cookie }
    });
    assert.equal(blockedRes.status, 400, `scrapping the last backing building must be rejected (got ${blockedRes.status})`);
    const blockedBody = await blockedRes.json() as { code?: string };
    assert.equal(blockedBody.code, 'BOND_COLLATERAL_VIOLATION');
    const survivor = db.prepare('SELECT COUNT(*) AS n FROM buildings WHERE id = ?').get(lastGrocery.id) as { n: number };
    assert.equal(Number(survivor.n), 1, 'last backing building must survive the rejection');
    console.log('✅ Test 6 passed');

    console.log('================================================================');
    console.log(' All Issue #94 construction verifications passed (0 errors)');
    console.log('================================================================');
  } finally {
    db.close();
    server.child.kill('SIGTERM');
    // Await the real exit signal rather than a guessed sleep.
    await once(server.child, 'exit');
    try {
      rmSync(server.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

runTests().catch(err => {
  console.error('❌ Issue #94 construction verification failed:', err);
  process.exit(1);
});
