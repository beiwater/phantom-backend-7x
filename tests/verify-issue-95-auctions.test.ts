/**
 * Verification test suite for Issue #95: Building Auctions.
 *
 * Verifies (decompiled spec: 24-hour hidden sealed-bid / Vickrey auctions):
 *   1. Listing: buildingAuctions capability gate (level >= 20), eligibility
 *      gates (building level >= 5 OR extractor abundance >= 95%), busy-building
 *      rejection, immediate slot release, min bid = scrap value
 *      (baseCost * size * 0.5), guaranteed return = minBid * 0.8, 24h window,
 *      concurrent-auction SimBoost pricing (free / 15 / 30).
 *   2. Sealed bids: hidden amounts (owner-only visibility), escrow at
 *      placement, re-bid delta re-escrow, withdrawal refund, below-min-bid and
 *      max-bid validation, no bids leaked on auction detail.
 *   3. 24h settlement: Vickrey second-price payout with 20% seller commission,
 *      single-bid reserve floor (minBid), loser escrow refunds, no-bid return
 *      of the building to the seller, idempotent re-settlement.
 *   4. Reposition queue: winner receives the building at position 'l'
 *      (35-slot queue), queue capacity enforced at bid time.
 *
 * Run with Node 22:
 *   /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-95-auctions.test.ts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

// Isolated environment MUST be configured before any server module import so
// the test process shares the spawned server's dedicated SQLite DATA_DIR.
const PORT = '3850';
const DATA_DIR = path.resolve('data', `test-run-auction-${PORT}-${Date.now()}`);
process.env.PORT = PORT;
process.env.DATA_DIR = DATA_DIR;

const baseUrl = `http://127.0.0.1:${PORT}`;

interface ApiResult {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
}

function errorText(json: ApiResult['json']): string {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'error' in json) {
    return String((json as Record<string, unknown>).error);
  }
  return JSON.stringify(json);
}

async function api(
  cookie: string,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<ApiResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let json: Record<string, unknown> | unknown[] | null = null;
  try {
    json = await response.json() as Record<string, unknown>;
  } catch {
    // Non-JSON response
  }
  return { status: response.status, json };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `auction_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: `Auction Co ${label} ${Date.now()}` })
  });
  assert.equal(response.status, 200, `Registration failed for ${label}: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie missing');
  const auth = await api(cookie as string, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(auth.status, 200);
  const companyId = (auth.json as { authCompany: { companyId: number } }).authCompany.companyId;
  return { cookie: cookie as string, companyId };
}

interface AuthCompanyView {
  money: number;
  simBoosts: number;
}

async function authCompany(cookie: string): Promise<AuthCompanyView> {
  const res = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(res.status, 200);
  const c = (res.json as { authCompany: { money: number; simBoosts: number } }).authCompany;
  return { money: Number(c.money), simBoosts: Number(c.simBoosts) };
}

interface CompanyBuilding {
  id: number;
  kind: string;
  level: number;
  size: number;
  position: string;
  cost: number;
}

async function companyBuildings(cookie: string): Promise<CompanyBuilding[]> {
  const res = await api(cookie, 'GET', '/api/v2/companies/me/buildings/');
  assert.equal(res.status, 200);
  return (res.json as unknown as CompanyBuilding[]) || [];
}

async function waitUntilReachable(url: string, timeoutMs: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const deadline = Date.now() + timeoutMs;
  const probe = async (): Promise<void> => {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {
        // Retry
      }
      // Real wall-clock polling is unavoidable: this waits for a separately
      // spawned OS process (the HTTP server) to bind its port — there is no
      // in-process signal or fake timer for another process's startup.
      await new Promise(res => setTimeout(res, 400));
    }
    reject(new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`));
  };
  void probe();
  return promise;
}

interface TestServer {
  child: ChildProcess;
  dataDir: string;
}

async function startTestServer(portNumber: number): Promise<TestServer> {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(portNumber),
        DATA_DIR
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', chunk => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) {
      process.stderr.write(`[test-srv] ${text}`);
    }
  });

  await waitUntilReachable(`http://127.0.0.1:${portNumber}/version/`, 30000);
  return { child, dataDir: DATA_DIR };
}

interface TestOutcome {
  name: string;
  ok: boolean;
  error?: unknown;
}

// Dynamic import is REQUIRED here despite static import being possible: ESM
// hoists static imports, so '../server/config.ts' would read process.env.DATA_DIR
// before the assignments at the top of this file run. The import ORDER is the
// runtime-selected behavior under test (shared dedicated SQLite DATA_DIR).
const { db } = await import('../server/db/database.ts');
const { settleDueAuctions } = await import('../server/game/building-auctions.ts');

// The spawned server process holds a second connection to the same SQLite
// file. WAL + a busy timeout keep the test process's direct reads/writes from
// colliding with the server's short write transactions.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

/** Insert a building row directly (deterministic scaffolding, not under test). */
function insertBuilding(companyId: number, kind: string, size: number, position: string, cost: number, abundance: number | null = null): number {
  const result = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, busy_until, created_at, abundance, original_abundance)
    VALUES (?, ?, ?, ?, ?, ?, 'production', NULL, ?, ?, ?)
  `).run(
    companyId,
    position,
    kind,
    size,
    kind === 'M' ? 'Mine' : kind === 'P' ? 'Farm' : 'Building',
    cost,
    new Date().toISOString(),
    abundance === null ? 100.0 : abundance,
    abundance === null ? 100.0 : abundance
  );
  return Number(result.lastInsertRowid);
}

function setCompany(companyId: number, fields: { level?: number; money?: number; simboosts?: number }): void {
  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (fields.level !== undefined) { sets.push('level = ?'); values.push(fields.level); }
  if (fields.money !== undefined) { sets.push('money = ?'); values.push(fields.money); }
  if (fields.simboosts !== undefined) { sets.push('simboosts = ?'); values.push(fields.simboosts); }
  values.push(companyId);
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE company_id = ?`).run(...values);
}

function getDbMoney(companyId: number): number {
  const row = db.prepare('SELECT money FROM companies WHERE company_id = ?').get(companyId) as { money: number };
  return Number(row.money);
}

interface AuctionView {
  id: number;
  buildingId: number;
  buildingKind: string;
  buildingSize: number;
  realm: number;
  startedAt: string;
  promoted: boolean;
  sellerId: number;
  auctionbuildingabundanceSet: Array<{ resourceKind: number; abundanceLevel: string }>;
  minBid: number;
  guaranteedReturn: number;
  closesAt: string;
  seller: { id: number; company: string; logo: string; deleted: boolean; realmId: number; certificates: number; contestWins: number };
  winningBid?: number | null;
}

interface BidView {
  id: number;
  buildingAuctionId: number;
  amount: number;
  created: string;
}

async function runIssue95Tests(): Promise<TestOutcome[]> {
  const results: TestOutcome[] = [];

  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ PASS: ${name}`);
    } catch (err: unknown) {
      results.push({ name, ok: false, error: err });
      console.error(`  ✗ FAIL: ${name}`);
      console.error(err instanceof Error ? err.stack || err.message : err);
    }
  }

  // ------------------------------------------------------------------ setup
  const seller = await registerCompany('seller');
  const buyerA = await registerCompany('buyera');
  const buyerB = await registerCompany('buyerb');
  const buyerC = await registerCompany('buyerc');
  const buyerD = await registerCompany('buyerd');

  // Deterministic company state (level 20 unlocks buildingAuctions).
  setCompany(seller.companyId, { level: 20, money: 1_000_000, simboosts: 1000 });
  for (const buyer of [buyerA, buyerB, buyerC, buyerD]) {
    setCompany(buyer.companyId, { level: 20, money: 1_000_000, simboosts: 1000 });
  }

  // Building scaffolding on the seller. Fresh companies are seeded with a
  // size-1 Farm at position '0' (used as the research reference below) and a
  // Grocery store at '1', so scaffolding starts at position '2':
  //  - farm1: level 5 Farm (eligible via level gate) — the 3-bid Vickrey auction
  //  - farm2: level 1 Farm (ineligible: neither level nor abundance)
  //  - farm3: level 5 Farm (eligible) — single-bid reserve-floor auction
  //  - mine1: level 1 Mine with 97% abundance (eligible via abundance gate)
  //  - mine2: level 1 Mine with 80% abundance (ineligible: <95%)
  //  - farmBusy: level 5 Farm left busy (construction) — busy rejection
  const farm4 = Number((db.prepare('SELECT id FROM buildings WHERE company_id = ? AND position = ?')
    .get(seller.companyId, '0') as { id: number }).id);
  const farm1 = insertBuilding(seller.companyId, 'P', 5, '2', 6900);
  const farm2 = insertBuilding(seller.companyId, 'P', 1, '3', 6900);
  const farm3 = insertBuilding(seller.companyId, 'P', 5, '4', 6900);
  const mine1 = insertBuilding(seller.companyId, 'M', 1, '5', 6900, 97);
  const mine2 = insertBuilding(seller.companyId, 'M', 1, '6', 6900, 80);
  const farmBusy = insertBuilding(seller.companyId, 'P', 5, '7', 6900);
  db.prepare('UPDATE buildings SET busy_until = ? WHERE id = ?')
    .run(new Date(Date.now() + 3600 * 1000).toISOString(), farmBusy);

  // --------------------------------------------------------- 1. gates & DTO
  await test('listing requires the buildingAuctions capability (level >= 20)', async () => {
    const poor = await registerCompany('poor');
    const res = await api(poor.cookie, 'POST', '/api/v2/building-auctions/', { buildingId: farm1 });
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${errorText(res.json)}`);
    const message = errorText(res.json);
    assert.match(message, /unlocks at level 20/, `Capability message expected, got: ${message}`);
  });

  await test('busy buildings cannot be listed', async () => {
    const res = await api(seller.cookie, 'POST', '/api/v2/building-auctions/', { buildingId: farmBusy });
    assert.equal(res.status, 409, `Expected 409, got ${res.status}: ${errorText(res.json)}`);
    assert.match(errorText(res.json), /busy/i);
  });

  await test('eligibility gate: building level >= 5 or extractor abundance >= 95%', async () => {
    const farmTooSmall = await api(seller.cookie, 'POST', '/api/v2/building-auctions/', { buildingId: farm2 });
    assert.equal(farmTooSmall.status, 400, `size-1 Farm must be ineligible: ${errorText(farmTooSmall.json)}`);
    assert.match(errorText(farmTooSmall.json), /not eligible/);

    const poorDeposit = await api(seller.cookie, 'POST', '/api/v2/building-auctions/', { buildingId: mine2 });
    assert.equal(poorDeposit.status, 400, `80% abundance Mine must be ineligible: ${errorText(poorDeposit.json)}`);
  });

  await test('listing a level-5 building succeeds with decompiled DTO values', async () => {
    const res = await api(seller.cookie, 'POST', '/api/v2/building-auctions/', { buildingId: farm1 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    const auction = res.json as unknown as AuctionView;

    assert.ok(auction.id > 0, 'auction id assigned');
    assert.equal(auction.buildingId, farm1);
    assert.equal(auction.buildingKind, 'P');
    assert.equal(auction.buildingSize, 5);
    assert.equal(auction.sellerId, seller.companyId);
    assert.equal(auction.promoted, false);
    // min bid = scrap value = baseCost * size * 0.5 = 6900 * 5 * 0.5
    assert.equal(auction.minBid, 17250);
    // guaranteed return = minBid - 20% fee
    assert.equal(auction.guaranteedReturn, 13800);
    // non-extractor buildings expose no abundance entries
    assert.deepEqual(auction.auctionbuildingabundanceSet, []);
    assert.equal(auction.seller.id, seller.companyId);
    assert.ok(auction.seller.company.length > 0);
    // 24-hour window
    const spanMs = Date.parse(auction.closesAt) - Date.parse(auction.startedAt);
    assert.ok(Math.abs(spanMs - 24 * 3600 * 1000) < 60 * 1000, `24h window expected, got ${spanMs}ms`);
  });

  await test('listing frees the seller building slot immediately', async () => {
    const buildings = await companyBuildings(seller.cookie);
    assert.ok(!buildings.some(b => b.id === farm1), 'listed building must leave the seller lot');
  });

  await test('abundance-eligible extractor lists with decompiled abundance levels', async () => {
    const before = await authCompany(seller.cookie);
    const res = await api(seller.cookie, 'POST', '/api/v2/building-auctions/0/', { buildingId: mine1 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    const auction = res.json as unknown as AuctionView;
    assert.equal(auction.minBid, 3450, 'scrap value = 6900 * 1 * 0.5');
    assert.equal(auction.guaranteedReturn, 2760);
    // Mine produces resources 14/15/42/68 (canonical data); 97% -> VeryGood
    const set = auction.auctionbuildingabundanceSet;
    assert.deepEqual(set.map(e => e.resourceKind).sort((a, b) => a - b), [14, 15, 42, 68]);
    assert.ok(set.every(e => e.abundanceLevel === 'VeryGood'), `VeryGood expected at 97%: ${JSON.stringify(set)}`);

    // Second concurrent auction costs 15 SimBoosts (decompiled [0, 15, 30]).
    const after = await authCompany(seller.cookie);
    assert.equal(before.simBoosts - after.simBoosts, 15, '2nd concurrent auction costs 15 SimBoosts');
  });

  await test('third concurrent auction costs 30 SimBoosts', async () => {
    const before = await authCompany(seller.cookie);
    const res = await api(seller.cookie, 'POST', '/api/v2/building-auctions/0/', { buildingId: farm3 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    const after = await authCompany(seller.cookie);
    assert.equal(before.simBoosts - after.simBoosts, 30, '3rd concurrent auction costs 30 SimBoosts');
  });

  // ------------------------------------------------------ 2. sealed bidding
  // Auction ids are AUTOINCREMENT (farm1=1, mine1=2, farm3=3 on a fresh DB);
  // ids >= 2 resolve to auction detail on GET /building-auctions/:id/ while
  // 0 and 1 stay realm listings.
  let farm1AuctionId = 0;
  let farm3AuctionId = 0;
  let mine1AuctionId = 0;
  {
    const list = (await api('', 'GET', '/api/v2/building-auctions/0/')).json as { buildingAuctions: AuctionView[] };
    farm1AuctionId = list.buildingAuctions.find(a => a.buildingId === farm1)!.id;
    farm3AuctionId = list.buildingAuctions.find(a => a.buildingId === farm3)!.id;
    mine1AuctionId = list.buildingAuctions.find(a => a.buildingId === mine1)!.id;
  }

  await test('active auction listings are reachable via realm and bare collection', async () => {
    const realmRes = await api('', 'GET', '/api/v2/building-auctions/0/');
    assert.equal(realmRes.status, 200);
    const realmList = (realmRes.json as { buildingAuctions: AuctionView[] }).buildingAuctions;
    assert.ok(realmList.some(a => a.buildingId === farm1), 'farm1 auction in realm 0 listing');
    assert.ok(realmList.some(a => a.buildingId === mine1), 'mine1 auction in realm 0 listing');

    // Realm id 1 keeps its listing semantic even though auction id 1 exists.
    const emptyRealm = await api('', 'GET', '/api/v2/building-auctions/1/');
    assert.equal((emptyRealm.json as { buildingAuctions: unknown[] }).buildingAuctions.length, 0);

    const bare = await api('', 'GET', '/api/v2/building-auctions/');
    assert.equal((bare.json as { buildingAuctions: unknown[] }).buildingAuctions.length, 3);

    // Auction ids >= 2 resolve to the single-auction detail object.
    const detail = await api('', 'GET', `/api/v2/building-auctions/${mine1AuctionId}/`);
    assert.equal((detail.json as unknown as AuctionView).buildingId, mine1, 'detail object by auction id');

    const unlocks = await api('', 'GET', '/api/v2/building-auctions/active-unlocks/');
    assert.equal(unlocks.status, 200);
    assert.deepEqual((unlocks.json as { activeUnlocks: unknown[] }).activeUnlocks, []);
  });

  await test('similar-auctions research returns same-kind active auctions', async () => {
    const byBuilding = await api('', 'GET', `/api/v2/building-auctions/research-by-building/${farm4}/`);
    assert.equal(byBuilding.status, 200);
    const similarBuildings = (byBuilding.json as { similarBuildingAuctions: AuctionView[] }).similarBuildingAuctions;
    assert.deepEqual(
      similarBuildings.map(a => a.buildingKind),
      ['P', 'P'],
      'farm1 + farm3 (kind P) expected'
    );

    const farm1AuctionId = ((await api('', 'GET', '/api/v2/building-auctions/0/')).json as { buildingAuctions: AuctionView[] })
      .buildingAuctions.find(a => a.buildingId === farm1)!.id;
    const byAuction = await api('', 'POST', `/api/v2/building-auctions/research-by-auction/${farm1AuctionId}/`);
    assert.equal(byAuction.status, 200);
    const similarAuctions = (byAuction.json as { similarBuildingAuctions: AuctionView[] }).similarBuildingAuctions;
    assert.equal(similarAuctions.length, 1, 'farm1 excluded from its own research');
    assert.equal(similarAuctions[0].buildingId, farm3);
  });

  await test('sealed bid placement escrows cash and stays hidden', async () => {
    const before = await authCompany(buyerA.cookie);
    const res = await api(buyerA.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 20000 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    const bid = res.json as unknown as BidView;
    assert.equal(bid.buildingAuctionId, farm1AuctionId);
    assert.equal(bid.amount, 20000);

    const after = await authCompany(buyerA.cookie);
    assert.equal(Math.round(before.money - after.money), 20000, 'bid cash escrowed at placement');

    // Own bids visible with amounts...
    const mine = await api(buyerA.cookie, 'GET', '/api/v2/building-auctions/bids/me/');
    assert.equal(mine.status, 200);
    const bids = (mine.json as { bids: BidView[] }).bids;
    assert.equal(bids.length, 1);
    assert.equal(bids[0].amount, 20000);

    // ...but never to another company (sealed).
    const otherView = await api(buyerB.cookie, 'GET', `/api/v2/building-auctions/bids/${buyerA.companyId}/`);
    assert.equal(otherView.status, 403, `Sealed amounts must be owner-only: ${errorText(otherView.json)}`);
    const otherMine = await api(buyerB.cookie, 'GET', '/api/v2/building-auctions/bids/me/');
    assert.equal((otherMine.json as { bids: unknown[] }).bids.length, 0);

    // Auction detail leaks no bid data at all (farm3AuctionId >= 2 resolves
    // to the single-auction detail object).
    const detail = await api('', 'GET', `/api/v2/building-auctions/${farm3AuctionId}/`);
    assert.equal(detail.status, 200);
    const detailJson = detail.json as Record<string, unknown>;
    assert.ok(!('bids' in detailJson), 'auction detail must not expose bids');
    assert.ok(!JSON.stringify(detailJson).includes('"amount"'), 'no bid amounts in detail');
  });

  await test('re-bidding replaces the sealed bid and re-escrows only the difference', async () => {
    const before = await authCompany(buyerA.cookie);
    const res = await api(buyerA.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 40000 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    const after = await authCompany(buyerA.cookie);
    assert.equal(Math.round(before.money - after.money), 20000, 'only the +20000 delta is debited');

    const mine = (await api(buyerA.cookie, 'GET', '/api/v2/building-auctions/bids/me/')).json as { bids: BidView[] };
    assert.equal(mine.bids.length, 1, 'one active bid per company per auction');
    assert.equal(mine.bids[0].amount, 40000);
  });

  await test('bid validation: below minimum, above maximum, malformed', async () => {
    const belowMin = await api(buyerB.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 100 });
    assert.equal(belowMin.status, 400);
    assert.match(errorText(belowMin.json), /greater than or equal to 17250/);

    const aboveMax = await api(buyerB.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 5e8 + 1 });
    assert.equal(aboveMax.status, 400);

    const malformed = await api(buyerB.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 'lots' });
    assert.equal(malformed.status, 400);

    const unknownAuction = await api(buyerB.cookie, 'POST', '/api/v2/building-auctions/bids/99999999/', { amount: 50000 });
    assert.equal(unknownAuction.status, 404);
  });

  await test('the original client shape POST /bids/:companyId/ {buildingAuctionId, amount} is accepted', async () => {
    const res = await api(buyerB.cookie, 'POST', `/api/v2/building-auctions/bids/${buyerB.companyId}/`, {
      buildingAuctionId: farm1AuctionId,
      amount: 30000
    });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    assert.equal((res.json as unknown as BidView).amount, 30000);

    const spoofed = await api(buyerB.cookie, 'POST', `/api/v2/building-auctions/bids/${buyerA.companyId}/`, {
      buildingAuctionId: farm1AuctionId,
      amount: 31000
    });
    assert.equal(spoofed.status, 403, 'cannot place bids for another company');
  });

  await test('withdrawing a bid refunds the escrow', async () => {
    const bidRes = await api(buyerB.cookie, 'POST', `/api/v2/building-auctions/bids/${buyerB.companyId}/`, {
      buildingAuctionId: mine1AuctionId,
      amount: 5000
    });
    assert.equal(bidRes.status, 200, `Expected 200, got ${bidRes.status}: ${errorText(bidRes.json)}`);
    const bidId = (bidRes.json as unknown as BidView).id;

    const before = await authCompany(buyerB.cookie);
    const del = await api(buyerB.cookie, 'DELETE', `/api/v2/building-auctions/bids/me/${bidId}/`);
    assert.equal(del.status, 200, `Expected 200, got ${del.status}: ${errorText(del.json)}`);
    const after = await authCompany(buyerB.cookie);
    assert.equal(Math.round(after.money - before.money), 5000, 'escrow refunded on withdrawal');

    const mine = (await api(buyerB.cookie, 'GET', '/api/v2/building-auctions/bids/me/')).json as { bids: BidView[] };
    // buyerB still holds the farm1 bid; only the mine1 bid must be gone.
    assert.ok(!mine.bids.some(b => b.buildingAuctionId === mine1AuctionId), 'withdrawn bid gone from my bids');
    assert.equal(mine.bids.length, 1, 'unrelated farm1 bid untouched');
  });

  await test('reposition queue capacity (35) is enforced at bid time', async () => {
    // Fill buyerD's reposition queue to the cap.
    for (let i = 0; i < 35; i++) {
      insertBuilding(buyerD.companyId, 'P', 1, `l${i === 0 ? '' : i}`, 6900);
    }
    const res = await api(buyerD.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 50000 });
    assert.equal(res.status, 409, `Full queue must reject bids: ${errorText(res.json)}`);
    assert.match(errorText(res.json), /Reposition queue is full/);
  });

  await test('promoting an auction costs 30 SimBoosts and flags the listing', async () => {
    const before = await authCompany(seller.cookie);
    const res = await api(seller.cookie, 'POST', `/api/v2/building-auctions/${farm3AuctionId}/promote/`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${errorText(res.json)}`);
    const after = await authCompany(seller.cookie);
    assert.equal(before.simBoosts - after.simBoosts, 30);

    // farm3AuctionId >= 2, so the detail object is reachable.
    const detail = await api('', 'GET', `/api/v2/building-auctions/${farm3AuctionId}/`);
    assert.equal((detail.json as unknown as AuctionView).promoted, true);

    const foreign = await api(buyerA.cookie, 'POST', `/api/v2/building-auctions/${farm1AuctionId}/promote/`);
    assert.equal(foreign.status, 403, 'only the seller promotes their own auction');
  });

  // ------------------------------------------------- 3. 24h Vickrey settle
  // Money snapshots taken right before the auction window is force-closed.
  const snap = {
    seller: getDbMoney(seller.companyId),
    buyerA: getDbMoney(buyerA.companyId),
    buyerB: getDbMoney(buyerB.companyId),
    buyerC: getDbMoney(buyerC.companyId)
  };
  const buyerCBid = 18250; // single bid on farm3 (reserve floor scenario)
  {
    const buyerCBefore = getDbMoney(buyerC.companyId);
    const bidRes = await api(buyerC.cookie, 'POST', `/api/v2/building-auctions/bids/${buyerC.companyId}/`, {
      buildingAuctionId: farm3AuctionId,
      amount: buyerCBid
    });
    assert.equal(bidRes.status, 200, `farm3 bid failed: ${errorText(bidRes.json)}`);
    assert.equal(Math.round(buyerCBefore - getDbMoney(buyerC.companyId)), buyerCBid);
    snap.buyerC = getDbMoney(buyerC.companyId); // escrowed state

    const thirdBid = await api(buyerC.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 35000 });
    assert.equal(thirdBid.status, 200);
    snap.buyerC = getDbMoney(buyerC.companyId);
  }

  // Force the 24h window to elapse for all three auctions.
  const past = new Date(Date.now() - 1000).toISOString();
  for (const id of [farm1AuctionId, farm3AuctionId, mine1AuctionId]) {
    db.prepare('UPDATE building_auctions SET closes_at = ? WHERE id = ?').run(past, id);
  }

  await test('a closed auction settles lazily on the mutation path', async () => {
    // Any auction mutation first sweeps due auctions — this POST lands after
    // settlement, so the closed auction answers 404.
    const res = await api(buyerA.cookie, 'POST', `/api/v2/building-auctions/bids/${farm1AuctionId}/`, { amount: 60000 });
    assert.equal(res.status, 404, `Expected 404 after settlement, got ${res.status}: ${errorText(res.json)}`);
    assert.match(errorText(res.json), /closed/);
  });

  await test('settlement is idempotent', async () => {
    const sellerMoneyBefore = getDbMoney(seller.companyId);
    const results = await settleDueAuctions();
    assert.ok(results.every(r => r.sold === false), 're-settlement must be a no-op');
    assert.equal(getDbMoney(seller.companyId), sellerMoneyBefore, 'no double seller proceeds');
  });

  await test('Vickrey settlement: winner pays second-highest bid, seller pays 20% fee', async () => {
    // farm1: bids A=40000, B=30000, C=35000 -> A wins, pays 35000 (second
    // highest), seller proceeds 28000 (20% commission = 7000). farm3: single
    // bid 18250 pays the 17250 reserve, proceeds 13800.
    //
    // Escrow accounting from the pre-close snapshots:
    //   buyerA escrowed 40000 -> refunded 5000  => snapshot + 5000
    //   buyerB escrowed 30000 -> lost, refunded => snapshot + 30000
    //   buyerC escrowed 18250 (farm3, pays 17250: +1000) and 35000 (farm1,
    //     lost: +35000)                          => snapshot + 36000
    //   seller: +28000 (farm1) + 13800 (farm3)  => snapshot + 41800
    const sellerProfile = await api('', 'GET', `/api/v2/companies/${seller.companyId}/building-auctions/`);
    const auctions = (sellerProfile.json as { buildingAuctions: AuctionView[] }).buildingAuctions;
    const farm1Result = auctions.find(a => a.buildingId === farm1);
    assert.equal(farm1Result?.winningBid, 35000, `second-highest bid expected: ${JSON.stringify(farm1Result)}`);

    assert.equal(getDbMoney(buyerA.companyId), snap.buyerA + 5000, 'winner pays second-highest bid (escrow surplus refunded)');
    assert.equal(getDbMoney(buyerB.companyId), snap.buyerB + 30000, 'losing bidder fully refunded');
    assert.equal(getDbMoney(buyerC.companyId), snap.buyerC + 36000, 'reserve charged on farm3, farm1 loss refunded');
    assert.equal(getDbMoney(seller.companyId), snap.seller + 41800, 'seller receives prices minus 20% fee');

    // Settled bids are no longer active.
    const winnerBids = (await api(buyerA.cookie, 'GET', '/api/v2/building-auctions/bids/me/')).json as { bids: BidView[] };
    assert.equal(winnerBids.bids.length, 0, 'settled bids no longer active');
  });

  await test('winning building arrives in the 35-slot reposition queue', async () => {
    const buildings = await companyBuildings(buyerA.cookie);
    const won = buildings.find(b => b.kind === 'P' && b.size === 5);
    assert.ok(won, 'winner received the farm');
    assert.equal(won.position, 'l', `reposition queue position 'l' expected, got ${won.position}`);
    assert.equal(won.cost, 6900, 'building value carried over');
  });

  await test('single-bid auction pays the reserve floor (minBid)', async () => {
    // farm3: one bid at 18250 -> winner pays minBid 17250, proceeds 13800.
    const detail = await api('', 'GET', `/api/v2/building-auctions/${farm3AuctionId}/`);
    assert.equal((detail.json as unknown as AuctionView).winningBid, 17250, 'reserve floor for a single bid');

    const buildings = await companyBuildings(buyerC.cookie);
    const won = buildings.find(b => b.kind === 'P' && b.size === 5);
    assert.ok(won, 'farm3 winner received the building');
    assert.equal(won.position, 'l');
  });

  await test('no-bid auction returns the building to the seller via the queue', async () => {
    const detail = await api('', 'GET', `/api/v2/building-auctions/${mine1AuctionId}/`);
    const auction = detail.json as unknown as AuctionView;
    assert.equal(auction.winningBid, null, 'no winner for an unbid auction');

    const buildings = await companyBuildings(seller.cookie);
    // mine2 (never listed) still sits at its lot; the returned mine1 is the
    // one that arrived in the reposition queue.
    const returned = buildings.find(b => b.kind === 'M' && b.position.startsWith('l'));
    assert.ok(returned, 'mine returned to the seller');
    assert.equal(returned.position, 'l', 'returned through the reposition queue');

    // No money moved for the no-bid auction (seller total asserted additively
    // in the settlement tests: +28000 + 13800).
  });

  await test('settled auctions leave the active collection and appear on the seller profile', async () => {
    const active = (await api('', 'GET', '/api/v2/building-auctions/0/')).json as { buildingAuctions: AuctionView[] };
    assert.equal(active.buildingAuctions.length, 0, 'all auctions settled');

    const mine = (await api(buyerA.cookie, 'GET', '/api/v2/building-auctions/bids/me/')).json as { bids: BidView[] };
    assert.equal(mine.bids.length, 0, 'no active bids remain');

    const companyAuctions = await api('', 'GET', `/api/v2/companies/${seller.companyId}/building-auctions/`);
    assert.equal(companyAuctions.status, 200);
    const list = (companyAuctions.json as { buildingAuctions: AuctionView[] }).buildingAuctions;
    assert.equal(list.length, 3);
    const byBuildingId = new Map(list.map(a => [a.buildingId, a]));
    assert.equal(byBuildingId.get(farm1)?.winningBid, 35000);
    assert.equal(byBuildingId.get(farm3)?.winningBid, 17250);
    assert.equal(byBuildingId.get(mine1)?.winningBid, null, 'no-bid auction has no winning bid');
  });

  await test('reposition queue slot allocation continues past the first building', async () => {
    // The seller now holds mine1 at 'l'; list and win another building to
    // verify the queue allocates 'l1' instead of colliding.
    const farm5 = insertBuilding(seller.companyId, 'P', 5, '9', 6900);
    const listRes = await api(seller.cookie, 'POST', '/api/v2/building-auctions/', { buildingId: farm5 });
    assert.equal(listRes.status, 200, `Expected 200, got ${listRes.status}: ${errorText(listRes.json)}`);
    const farm5AuctionId = (listRes.json as unknown as AuctionView).id;

    const bid = await api(buyerA.cookie, 'POST', `/api/v2/building-auctions/bids/${farm5AuctionId}/`, { amount: 20000 });
    assert.equal(bid.status, 200, `buyerA (queue holds 1) can still bid: ${errorText(bid.json)}`);

    db.prepare('UPDATE building_auctions SET closes_at = ? WHERE id = ?').run(past, farm5AuctionId);
    const settled = await settleDueAuctions();
    assert.equal(settled.filter(r => r.sold).length, 1, 'farm5 settled as sold');

    const buildings = await companyBuildings(buyerA.cookie);
    const positions = buildings.filter(b => b.position.startsWith('l')).map(b => b.position).sort();
    assert.deepEqual(positions, ['l', 'l1'], `queue allocates distinct lift slots: ${JSON.stringify(positions)}`);
  });

  return results;
}


async function main(): Promise<void> {
  console.log('================================================================');
  console.log(` Starting Issue #95 Building Auctions Verification on Port ${PORT}`);
  console.log(` DATA_DIR: ${DATA_DIR}`);
  console.log('================================================================');

  const server = await startTestServer(Number(PORT));
  let results: TestOutcome[] = [];

  try {
    results = await runIssue95Tests();
  } finally {
    server.child.kill('SIGTERM');
    // Give the child a moment to release the SQLite file, then clean up.
    await new Promise(res => setTimeout(res, 500));
    try {
      rmSync(server.dataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  const failures = results.filter(r => !r.ok);
  console.log('\n================================================================');
  console.log(` Summary: ${results.length - failures.length} passed, ${failures.length} failed`);
  console.log('================================================================');

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in test execution:', err);
  process.exit(1);
});
