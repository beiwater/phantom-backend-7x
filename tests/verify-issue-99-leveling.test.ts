import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

// Pure domain imports (no db side effects) — used to mirror the server's exact
// duration math so boundary amounts are derived, not hardcoded.
import {
  LEVEL_CAP,
  getCumulativeXpForLevel,
  getXpRequiredForLevel,
  getTierForLevel,
  checkCapability,
  computeLevelInfo,
  QueueDurationLimitError
} from '../server/domain/leveling/level-rules.ts';
import { DomainError } from '../server/errors/domain-error.ts';
import { calculateProductionRate, calculateProductionTime } from '../server/game-data/buildings.ts';
import { calculateRetailDuration, getAuthoritativeRetailPrice } from '../server/game-data/retail.ts';

const TEST_PORT = Number(process.env.PORT || '3880');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Issue #99 constants under test:
//   canonical cumulative XP table (L1=5, L5=50, L10=550, L15=6k, L20=68k, ...)
//   queue duration limits per tier (L0-4: 2h, L5-14: 24h, L15+: 48h)
//   contracts send/accept unlock at level 2 (GET stays public)
const LIMITS = { L0: 2 * 3600, L5: 24 * 3600, L15: 48 * 3600 };

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

// Polls a separately-spawned OS process over real HTTP; the server's readiness
// is genuinely wall-clock-bound (fake timers cannot advance another process),
// so a real retry delay is required here (ts-no-test-timers exception).
async function waitUntilReachable(url: string, timeoutMs: number = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return;
      }
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 150));
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

  const dataDir = path.resolve('data', `test-run-issue-99-${Date.now()}`);
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
        DATA_DIR: dataDir
        // NOTE: no SPEED_MULTIPLIER — the test process mirrors the server's
        // duration math with the same default multiplier (1.0).
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3880] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `lvl99_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Leveling ${label} ${Date.now()}`
    })
  });
  assert.equal(res.status, 200, `Registration should return 200 for ${label}`);

  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.find((v) => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie must be returned');

  const authRes = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(authRes.status, 200, 'Auth data should return 200');
  const authData = (await authRes.json()) as {
    companyPublicInfo?: { id: number };
    authCompany?: { companyId?: number; id?: number };
  };
  const companyId = authData.companyPublicInfo?.id || authData.authCompany?.companyId || authData.authCompany?.id || 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId };
}

function setLevel(db: DatabaseSync, companyId: number, level: number, experience = 0): void {
  db.prepare('UPDATE companies SET level = ?, experience = ? WHERE company_id = ?')
    .run(level, experience, companyId);
}

function insertBuilding(
  db: DatabaseSync,
  companyId: number,
  position: string,
  kind: string,
  category: string
): number {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, ?, 1, 'Test Building', 13800, ?, ?)
  `).run(companyId, position, kind, category, now);
  return Number(result.lastInsertRowid);
}

function seedResource(
  db: DatabaseSync,
  companyId: number,
  kind: number,
  quality: number,
  amount: number
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1.0, ?)
    ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = excluded.amount
  `).run(companyId, kind, quality, amount, now);
}

function warehouseAmount(db: DatabaseSync, companyId: number, kind: number, quality: number): number {
  const row = db.prepare(
    'SELECT amount FROM warehouse WHERE company_id = ? AND kind = ? AND quality = ?'
  ).get(companyId, kind, quality) as { amount: number } | undefined;
  return row ? Number(row.amount) : 0;
}

function busyUntilOf(db: DatabaseSync, buildingId: number): string | null {
  const row = db.prepare('SELECT busy_until FROM buildings WHERE id = ?').get(buildingId) as
    | { busy_until: string | null }
    | undefined;
  return row?.busy_until ?? null;
}

function queueCount(db: DatabaseSync, buildingId: number): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM production_queues WHERE building_id = ?'
  ).get(buildingId) as { n: number };
  return Number(row.n);
}

function headers(cookie: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Cookie: cookie };
}

// ---------------------------------------------------------------------------
// Duration math mirrors (identical functions/args the server use cases run).
// ---------------------------------------------------------------------------
const APPLES = 3; // kind 3: farm raw rate 250/h, normal-state rate is salary-adjusted
const FARM_PER_HOUR = calculateProductionRate(APPLES, 1, 0, { economyState: 1 });

/** Largest amount within a duration limit and the first amount over it. */
function productionAmountsFor(seconds: number): { exact: number; over: number } {
  let low = 0;
  let high = Math.max(1, Math.ceil((seconds / 3600) * FARM_PER_HOUR) + 1);
  while (calculateProductionTime(APPLES, high, 1, 0, { economyState: 1 }) <= seconds) {
    high *= 2;
  }
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (calculateProductionTime(APPLES, middle, 1, 0, { economyState: 1 }) <= seconds) {
      low = middle;
    } else {
      high = middle;
    }
  }
  assert.ok(calculateProductionTime(APPLES, low, 1, 0, { economyState: 1 }) <= seconds);
  assert.ok(calculateProductionTime(APPLES, high, 1, 0, { economyState: 1 }) > seconds);
  return { exact: low, over: high };
}

const RETAIL_PRICE = (() => {
  const { defaultPrice, maxPrice } = getAuthoritativeRetailPrice(APPLES, 0);
  return Math.min(Math.max(defaultPrice, 0), maxPrice); // start-retail's clamp
})();
const retailDuration = (units: number) =>
  calculateRetailDuration(APPLES, units, 1, { quality: 0, price: RETAIL_PRICE, buildingKind: 'G' });

/** Smallest units count whose retail duration strictly exceeds `seconds`. */
function retailUnitsExceeding(seconds: number): number {
  let lo = 1;
  let hi = 200000; // duration cap is 7 days; far above every tier limit
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (retailDuration(mid) > seconds) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

async function runIssue99LevelingTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Starting Issue #99: Leveling (XP table / queue limits / contracts L2)');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');

  // -----------------------------------------------------------------------
  // PART A — canonical cumulative XP table (pure domain)
  // -----------------------------------------------------------------------
  console.log('\n[A/6] Canonical cumulative XP anchors...');
  const ANCHORS: Array<[number, number]> = [
    [0, 0], [1, 5], [5, 50], [10, 550], [15, 6_000], [20, 68_000],
    [25, 250_000], [30, 600_000], [35, 1_200_000], [40, 2_100_000],
    [45, 3_300_000], [50, 4_800_000], [55, 6_600_000], [60, 8_700_000]
  ];
  for (const [level, xp] of ANCHORS) {
    assert.equal(getCumulativeXpForLevel(level), xp, `cumulative XP to reach L${level} must be ${xp}`);
  }
  // Interpolated levels stay strictly monotone with positive per-level deltas.
  let prev = 0;
  for (let l = 1; l <= LEVEL_CAP; l++) {
    const cum = getCumulativeXpForLevel(l);
    assert.ok(cum > prev, `cumulative XP must strictly increase at L${l}`);
    assert.ok(getXpRequiredForLevel(l - 1) >= 1, `per-level delta must be >= 1 at L${l - 1}`);
    prev = cum;
  }
  // experienceToNextLevel reflects the cumulative delta.
  assert.equal(getXpRequiredForLevel(0), 5, 'advancing from L0 needs the L1 delta (5 XP)');
  assert.equal(getXpRequiredForLevel(1), getCumulativeXpForLevel(2) - getCumulativeXpForLevel(1));
  assert.equal(getXpRequiredForLevel(19), getCumulativeXpForLevel(20) - getCumulativeXpForLevel(19));
  assert.equal(getXpRequiredForLevel(LEVEL_CAP), Infinity, 'level cap can never be crossed');
  assert.equal(getXpRequiredForLevel(-5), 5, 'negative levels clamp to 0');
  const capDto = computeLevelInfo({ level: LEVEL_CAP, experience: 123 });
  assert.equal(capDto.experienceToNextLevel, 420_000, 'cap DTO reports a finite last delta');
  assert.ok(Number.isFinite(capDto.experienceToNextLevel), 'experienceToNextLevel must serialize (no Infinity)');
  console.log('  ✔ anchors 5/50/550/6k/68k/.../8.7M exact, monotone, deltas = cumulative differences');

  console.log('\n[A/6] Tier queue-duration bands (2h / 24h / 48h)...');
  for (const [level, limit] of [[0, LIMITS.L0], [4, LIMITS.L0], [5, LIMITS.L5], [14, LIMITS.L5], [15, LIMITS.L15], [59, LIMITS.L15]] as const) {
    assert.equal(getTierForLevel(level).timeLimitS, limit, `L${level} queue limit must be ${limit}s`);
    assert.equal(computeLevelInfo({ level }).timeLimit, limit, `L${level} levelInfo.timeLimit must be ${limit}s`);
  }
  const durErr = new QueueDurationLimitError(7215, 7200, 'Production');
  assert.ok(durErr instanceof DomainError, 'QueueDurationLimitError must be a DomainError');
  assert.equal(durErr.statusCode, 400, 'queue duration limit must map to HTTP 400');
  assert.equal(durErr.code, 'QUEUE_DURATION_LIMIT', 'error code must be QUEUE_DURATION_LIMIT');
  console.log('  ✔ 7200s / 86400s / 172800s bands + 400 QUEUE_DURATION_LIMIT error contract');

  console.log('\n[A/6] Contracts capability unlocks at level 2 (pure gate)...');
  assert.deepEqual(checkCapability(0, 'contracts'), { allowed: false, requiredLevel: 2 });
  assert.deepEqual(checkCapability(1, 'contracts'), { allowed: false, requiredLevel: 2 });
  assert.deepEqual(checkCapability(2, 'contracts'), { allowed: true, requiredLevel: 2 });
  assert.equal(checkCapability(10, 'contracts').allowed, true);
  assert.equal(computeLevelInfo({ level: 1 }).capabilities.contracts, false, 'levelInfo must match the gate below L2');
  assert.equal(computeLevelInfo({ level: 2 }).capabilities.contracts, true, 'levelInfo must match the gate from L2');
  // Other capabilities keep their tier-driven unlocks.
  assert.equal(checkCapability(4, 'research').allowed, false);
  assert.equal(checkCapability(10, 'research').allowed, true);
  console.log('  ✔ contracts denied at L0/L1, allowed from L2; tier unlocks untouched');

  // -----------------------------------------------------------------------
  // Boot server + companies
  // -----------------------------------------------------------------------
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('\n✔ Test server started successfully on port', TEST_PORT);
    const db = new DatabaseSync(server.dbPath);

    const cL0 = await registerCompany('l0');
    const cL8 = await registerCompany('l8');
    const cL20 = await registerCompany('l20');
    const cRet0 = await registerCompany('ret0');
    const cRet8 = await registerCompany('ret8');
    const cRet20 = await registerCompany('ret20');
    const cXp = await registerCompany('xp');
    const cLvl = await registerCompany('lvl');
    const cGate = await registerCompany('gate');
    const cSender = await registerCompany('sender');
    const cRecipient = await registerCompany('recipient');
    console.log(`✔ Registered test companies (${cL0.companyId}, ${cL8.companyId}, ${cL20.companyId}, ...)`);
    setLevel(db, cL8.companyId, 8);
    setLevel(db, cL20.companyId, 20);
    setLevel(db, cRet8.companyId, 8);
    setLevel(db, cRet20.companyId, 20);
    setLevel(db, cGate.companyId, 1);
    setLevel(db, cSender.companyId, 2);
    setLevel(db, cRecipient.companyId, 1);

    // ---------------------------------------------------------------------
    // PART B — production queue duration limits (L0 / L5 / L15 bands)
    // ---------------------------------------------------------------------
    console.log('\n[B/6] Production queue duration limits (farm, apples)...');
    const mkFarm = (company: { companyId: number }, position: string) =>
      insertBuilding(db, company.companyId, position, 'P', 'production');

    const exact0 = productionAmountsFor(LIMITS.L0);
    const exact5 = productionAmountsFor(LIMITS.L5);
    const exact15 = productionAmountsFor(LIMITS.L15);

    // L0: the largest amount within 2h is allowed...
    const farm0a = mkFarm(cL0, 'r1');
    let res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${farm0a}/queue/`, {
      method: 'POST', headers: headers(cL0.cookie),
      body: JSON.stringify({ kind: APPLES, amount: exact0.exact })
    });
    assert.equal(res.status, 200, `L0 production at the 2h boundary must be allowed: ${await res.text()}`);
    const duration0 = calculateProductionTime(APPLES, exact0.exact, 1, 0, { economyState: 1 });
    assert.ok(duration0 <= LIMITS.L0);
    const q0 = db.prepare('SELECT duration_seconds FROM production_queues WHERE building_id = ?').get(farm0a) as { duration_seconds: number };
    assert.equal(q0.duration_seconds, duration0, 'queue row must persist the calculated duration');

    // L0: one apple over 2h is rejected before any side effect.
    const farm0b = mkFarm(cL0, 'r2');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${farm0b}/queue/`, {
      method: 'POST', headers: headers(cL0.cookie),
      body: JSON.stringify({ kind: APPLES, amount: exact0.over })
    });
    assert.equal(res.status, 400, 'L0 production exceeding 2h must be rejected with 400');
    let err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'QUEUE_DURATION_LIMIT', 'rejection must carry QUEUE_DURATION_LIMIT code');
    assert.match(err.error!, /7200/, 'error must surface the tier limit');
    assert.equal(queueCount(db, farm0b), 0, 'rejected queue must not be created');
    assert.equal(busyUntilOf(db, farm0b), null, 'rejected start must leave the building idle');

    // L5 band: the largest amount within 24h is allowed, next amount rejected.
    const farm8a = mkFarm(cL8, 'r1');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${farm8a}/queue/`, {
      method: 'POST', headers: headers(cL8.cookie),
      body: JSON.stringify({ kind: APPLES, amount: exact5.exact })
    });
    assert.equal(res.status, 200, `L8 production at the 24h boundary must be allowed: ${await res.text()}`);
    const farm8b = mkFarm(cL8, 'r2');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${farm8b}/queue/`, {
      method: 'POST', headers: headers(cL8.cookie),
      body: JSON.stringify({ kind: APPLES, amount: exact5.over })
    });
    assert.equal(res.status, 400, 'L8 production exceeding 24h must be rejected with 400');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'QUEUE_DURATION_LIMIT');
    assert.equal(queueCount(db, farm8b), 0, 'rejected 24h+ queue must not be created');

    // L15 band: what exceeds L5 still fits, but the first amount over 48h does not.
    const farm20a = mkFarm(cL20, 'r1');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${farm20a}/queue/`, {
      method: 'POST', headers: headers(cL20.cookie),
      body: JSON.stringify({ kind: APPLES, amount: exact5.over }) // first amount > 24h, <= 48h
    });
    assert.equal(res.status, 200, 'L20 production beyond 24h still fits the L15 band');
    const farm20b = mkFarm(cL20, 'r2');
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${farm20b}/queue/`, {
      method: 'POST', headers: headers(cL20.cookie),
      body: JSON.stringify({ kind: APPLES, amount: exact15.over })
    });
    assert.equal(res.status, 400, 'L20 production exceeding 48h must be rejected with 400');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'QUEUE_DURATION_LIMIT');
    assert.equal(queueCount(db, farm20b), 0, 'rejected 48h+ queue must not be created');
    console.log('  ✔ 2h boundary at L0, 24h boundary at L5 band, 48h boundary at L15 band');

    // ---------------------------------------------------------------------
    // PART C — retail queue duration limits (grocery)
    // ---------------------------------------------------------------------
    console.log('\n[C/6] Retail queue duration limits (grocery, apples)...');
    const mkStore = (company: { companyId: number }, position: string) =>
      insertBuilding(db, company.companyId, position, 'G', 'sales');
    const sell = (cookie: string, buildingId: number, units: number) =>
      fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
        method: 'POST', headers: headers(cookie),
        body: JSON.stringify({ kind: APPLES, amount: units, price: RETAIL_PRICE })
      });

    const unitsOver2h = retailUnitsExceeding(LIMITS.L0);
    const unitsAt2h = unitsOver2h - 1;
    const unitsOver24h = retailUnitsExceeding(LIMITS.L5);
    const unitsOver48h = retailUnitsExceeding(LIMITS.L15);
    assert.ok(retailDuration(unitsAt2h) <= LIMITS.L0, 'mirror sanity: at-2h units fit the L0 band');
    assert.ok(retailDuration(unitsOver24h) <= LIMITS.L15, 'mirror sanity: over-24h units fit the L15 band');

    // NOTE: accepted retail sales award duration-sized XP, which can promote
    // the company across a tier boundary mid-part. Every rejection case is
    // therefore run BEFORE any accepted sale for the same company.

    // L0: exceeding sale rejected with no stock movement and no busy window.
    const store0 = mkStore(cRet0, 'r1');
    seedResource(db, cRet0.companyId, APPLES, 0, unitsOver2h + 100);
    res = await sell(cRet0.cookie, store0, unitsOver2h);
    assert.equal(res.status, 400, 'L0 retail exceeding 2h must be rejected with 400');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'QUEUE_DURATION_LIMIT', 'retail rejection must carry QUEUE_DURATION_LIMIT code');
    assert.match(err.error!, /Retail/, 'rejection must identify the retail subject');
    assert.equal(
      warehouseAmount(db, cRet0.companyId, APPLES, 0), unitsOver2h + 100,
      'rejected sale must not consume warehouse stock'
    );
    assert.equal(busyUntilOf(db, store0), null, 'rejected sale must leave the store idle');

    // L8: over-24h sale still rejected (company not yet promoted)...
    const store8b = mkStore(cRet8, 'r2');
    seedResource(db, cRet8.companyId, APPLES, 0, unitsOver24h + 100);
    res = await sell(cRet8.cookie, store8b, unitsOver24h);
    assert.equal(res.status, 400, 'L8 retail exceeding 24h must be rejected with 400');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'QUEUE_DURATION_LIMIT');
    assert.equal(
      warehouseAmount(db, cRet8.companyId, APPLES, 0), unitsOver24h + 100,
      'rejected 24h+ sale must not consume stock'
    );

    // ...and the over-2h sale is allowed at L8 (after the rejection so its
    // XP award cannot alter the band under test).
    const store8a = mkStore(cRet8, 'r1');
    seedResource(db, cRet8.companyId, APPLES, 0, unitsOver2h + 100);
    res = await sell(cRet8.cookie, store8a, unitsOver2h);
    assert.equal(res.status, 200, `L8 retail above 2h must be allowed: ${await res.text()}`);

    // L20: over-48h sale rejected before any XP-awarding acceptance.
    const store20b = mkStore(cRet20, 'r2');
    seedResource(db, cRet20.companyId, APPLES, 0, unitsOver48h + 100);
    res = await sell(cRet20.cookie, store20b, unitsOver48h);
    assert.equal(res.status, 400, 'L20 retail exceeding 48h must be rejected with 400');
    err = (await res.json()) as { error?: string; code?: string };
    assert.equal(err.code, 'QUEUE_DURATION_LIMIT');

    // ...then the over-24h sale is allowed at L20 (L15 band).
    const store20a = mkStore(cRet20, 'r1');
    seedResource(db, cRet20.companyId, APPLES, 0, unitsOver24h + 100);
    res = await sell(cRet20.cookie, store20a, unitsOver24h);
    assert.equal(res.status, 200, `L20 retail above 24h must be allowed: ${await res.text()}`);
    console.log('  ✔ retail 2h/24h/48h bands enforced, stock untouched on rejection');

    // L0 at-limit sale (fits exactly under 2h) — run last: the awarded XP
    // legitimately levels the L0 company up.
    const store0b = mkStore(cRet0, 'r2');
    seedResource(db, cRet0.companyId, APPLES, 0, unitsAt2h);
    res = await sell(cRet0.cookie, store0b, unitsAt2h);
    assert.equal(res.status, 200, `L0 retail just under 2h must be allowed: ${await res.text()}`);
    assert.ok(busyUntilOf(db, store0b), 'accepted sale must occupy the busy window');
    console.log('  ✔ at-limit L0 sale accepted and occupies the busy window');

    // ---------------------------------------------------------------------
    // PART D — XP thresholds drive level-ups end-to-end (collect +10 XP)
    // ---------------------------------------------------------------------
    console.log('\n[D/6] Level-up through the canonical table (collect +10 XP)...');
    // L1 -> L2 delta is 11 XP under the canonical table (was 45 in the old
    // invented formula): pin experience 2 so one collect (10 XP) crosses it.
    setLevel(db, cXp.companyId, 1, 2);
    const plant = insertBuilding(db, cXp.companyId, 'r1', 'E', 'production'); // power, kind 1
    res = await fetch(`${BASE_URL}/api/v2/companies/buildings/${plant}/queue/`, {
      method: 'POST', headers: headers(cXp.cookie),
      body: JSON.stringify({ kind: 1, amount: 1 }) // 5s duration
    });
    const queueText = await res.text();
    assert.equal(res.status, 200, `power queue must start: ${queueText}`);
    const queue = JSON.parse(queueText) as { id: number; finishes: string };
    await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(queue.finishes) - Date.now()) + 500));
    res = await fetch(`${BASE_URL}/api/v2/order/take/${queue.id}/`, {
      method: 'POST', headers: headers(cXp.cookie)
    });
    const collectText = await res.text();
    assert.equal(res.status, 200, `collect must succeed: ${collectText}`);
    const collected = JSON.parse(collectText) as {
      success: boolean;
      experienceGained: number;
      levelUp: boolean;
      levelInfo: { level: number; experience: number; experienceToNextLevel: number };
    };
    assert.equal(collected.success, true);
    assert.equal(collected.experienceGained, 10, 'collect must award +10 XP');
    assert.equal(collected.levelUp, true, '2 + 10 XP must cross the canonical L1->L2 delta of 11');
    assert.equal(collected.levelInfo.level, 2, 'company must reach level 2 (old table would stall at 1)');
    assert.equal(collected.levelInfo.experience, 1, 'leftover XP must be 12 - 11 = 1');
    assert.equal(collected.levelInfo.experienceToNextLevel, 12, 'experienceToNextLevel must be the L2 cumulative delta');

    // levelInfo deltas track the cumulative table at every audited level.
    const expectedDeltas: Array<[number, number]> = [
      [1, getCumulativeXpForLevel(2) - getCumulativeXpForLevel(1)],
      [5, 100], [10, 1_090], [15, 12_400], [20, 36_400]
    ];
    for (const [level, delta] of expectedDeltas) {
      setLevel(db, cLvl.companyId, level, 0);
      const auth = (await (await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: headers(cLvl.cookie) })).json()) as {
        levelInfo: { level: number; experienceToNextLevel: number };
      };
      assert.equal(auth.levelInfo.level, level);
      assert.equal(auth.levelInfo.experienceToNextLevel, delta, `L${level} experienceToNextLevel must be ${delta}`);
    }
    assert.equal(
      (await (await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: headers(cLvl.cookie) })).json() as Promise<{ levelInfo: { capabilities: { contracts: boolean } } }>).levelInfo.capabilities.contracts,
      true
    );
    console.log('  ✔ collect leveled 1->2 (delta 11), auth-data deltas 100/1090/12400/36400 at L5/L10/L15/L20');

    // ---------------------------------------------------------------------
    // PART E — contracts: send/accept unlock at L2, GET stays public
    // ---------------------------------------------------------------------
    console.log('\n[E/6] Contracts unlock at level 2...');
    seedResource(db, cSender.companyId, 29, 0, 100);

    // L1 send is capability-gated with the corrected threshold.
    res = await fetch(`${BASE_URL}/api/v2/contracts/`, {
      method: 'POST', headers: headers(cGate.cookie),
      body: JSON.stringify({ recipient: cRecipient.companyId, kind: 29, quality: 0, amount: 10, price: 100 })
    });
    assert.equal(res.status, 403, 'L1 contract send must be rejected with 403');
    err = (await res.json()) as { error?: string };
    assert.match(err.error!, /unlocks at level 2/, 'send gate must surface the level-2 unlock');

    // GETs stay public (no capability gate at L1).
    for (const path of ['/api/v2/contracts-incoming/', '/api/v2/contracts-outgoing/']) {
      res = await fetch(`${BASE_URL}${path}`, { headers: headers(cGate.cookie) });
      assert.equal(res.status, 200, `GET ${path} must stay public at L1`);
    }

    // L2 sender can send.
    res = await fetch(`${BASE_URL}/api/v2/contracts/`, {
      method: 'POST', headers: headers(cSender.cookie),
      body: JSON.stringify({ recipient: cRecipient.companyId, kind: 29, quality: 0, amount: 10, price: 100 })
    });
    const sendText = await res.text();
    assert.equal(res.status, 200, `L2 contract send must be allowed: ${sendText}`);
    const contract = JSON.parse(sendText) as { id: number; status?: string };
    assert.ok(contract.id > 0, 'send must return the created contract');
    const outgoing = (await (await fetch(`${BASE_URL}/api/v2/contracts-outgoing/`, { headers: headers(cSender.cookie) })).json()) as Array<{ id: number }>;
    assert.ok(outgoing.some((c) => c.id === contract.id), 'sent contract must be listed as outgoing');

    // L1 recipient still cannot accept...
    res = await fetch(`${BASE_URL}/api/v2/contracts/${contract.id}/accept/`, {
      method: 'POST', headers: headers(cRecipient.cookie)
    });
    assert.equal(res.status, 403, 'L1 contract accept must be rejected with 403');
    err = (await res.json()) as { error?: string };
    assert.match(err.error!, /unlocks at level 2/, 'accept gate must surface the level-2 unlock');

    // ...but from L2 the whole supply agreement flow completes.
    const recipientMoneyBefore = (db.prepare('SELECT money FROM companies WHERE company_id = ?').get(cRecipient.companyId) as { money: number }).money;
    setLevel(db, cRecipient.companyId, 2);
    res = await fetch(`${BASE_URL}/api/v2/contracts/${contract.id}/accept/`, {
      method: 'POST', headers: headers(cRecipient.cookie)
    });
    const acceptText = await res.text();
    assert.equal(res.status, 200, `L2 contract accept must be allowed: ${acceptText}`);
    const accepted = JSON.parse(acceptText) as { success: boolean; moneyDelta: number };
    assert.equal(accepted.success, true);
    assert.equal(accepted.moneyDelta, -1000, 'accept must charge amount * price = 1000');
    const recipientMoneyAfter = (db.prepare('SELECT money FROM companies WHERE company_id = ?').get(cRecipient.companyId) as { money: number }).money;
    assert.equal(recipientMoneyAfter, recipientMoneyBefore - 1000, 'acceptance must persist the debit');
    assert.equal(warehouseAmount(db, cRecipient.companyId, 29, 0), 10, 'recipient warehouse must gain the contracted goods');
    console.log('  ✔ send/accept 403 at L1 (unlocks at level 2), full flow succeeds from L2, GETs public');

    // ---------------------------------------------------------------------
    // PART F — regression guards around the changed gates
    // ---------------------------------------------------------------------
    console.log('\n[F/6] Regression guards...');
    // The old invented formula must be gone: L1->L2 is 11 XP, not 45.
    assert.notEqual(getXpRequiredForLevel(1), 45, 'old linear formula (L1: 45) must be replaced');
    assert.notEqual(getXpRequiredForLevel(0), 40, 'old linear formula (L0: 40) must be replaced');
    // Tier capability fields stay decompile-canonical (the override lives in the gate).
    assert.equal(getTierForLevel(0).contracts, false);
    assert.equal(getTierForLevel(5).contracts, true);
    console.log('  ✔ old 40+5l formula gone; tier table unchanged, override isolated to the gate');

    console.log('\n================================================================');
    console.log(' All Issue #99 Leveling Assertions PASSED with 0 ERRORS!');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.child.kill('SIGTERM');
      if (existsSync(server.dataDir)) {
        try {
          rmSync(server.dataDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup error
        }
      }
    }
  }
}

runIssue99LevelingTest().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
