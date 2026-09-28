/**
 * Verification test suite for Issue #82: Collectible Exchange (NFT trading).
 *
 * Verifies (decompiled spec: collectibles.json → nftCollectibleTrading):
 *   1. Explicit test fixture: 8 unique collectibles (all four rarity tiers) listed on
 *      an isolated database with decompile-verbatim images; the exchange list
 *      carries asset info { id, name, image, realm, rarity, description,
 *      currentOwnerId, ipfs { description } } per listing.
 *   2. Listing: owner-only POST /api/v2/market-collectibles/ (decompiled
 *      payload { collectibleId, simboosts }), single-active-listing
 *      enforcement, positive-integer price validation, unknown-asset 404.
 *   3. PATCH /api/v2/market-collectibles/:id/ — owner-only price update,
 *      delist (free) and re-list; non-owner PATCH and delisted purchases
 *      rejected; empty PATCH body = delist (decompiled fcr semantics).
 *   4. Purchase: POST /api/v2/market-collectibles/:id/buy/ debits the buyer,
 *      credits the seller and transfers ownership ATOMICALLY; buying your
 *      own listing, delisted/sold listings and insufficient SimBoosts are
 *      rejected with zero state change (atomicity proof).
 *   5. Provenance: GET /api/v2/nfts/assets/:id/trades/ returns
 *      { trades: [{ id, datetime, priceSimboosts }] } — one row per sale in
 *      chronological order (treasury sale → resale → second-hand resale).
 *   6. Collectors: GET /api/v2/nfts/collectors/ ranks by count first, then
 *      by acquisition value (latest sale price per owned asset).
 *
 * Run with Node 22:
 *   node --experimental-strip-types tests/verify-issue-82-collectibles.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withTestServer, type TestServer } from './support/test-server.ts';

let server: TestServer;

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

function errorCode(json: ApiResult['json']): string | undefined {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'code' in json) {
    return String((json as Record<string, unknown>).code);
  }
  return undefined;
}

async function api(
  cookie: string,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<ApiResult> {
  return server.request(method, urlPath, { cookie, body });
}

async function registerCompany(label: string) { return server.registerCompany(`NFT ${label}`); }

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

function setCompanySimboosts(companyId: number, simboosts: number): void {
  server.db.prepare('UPDATE companies SET simboosts = ? WHERE company_id = ?').run(simboosts, companyId);
}

function prepareCollectibles(): void {
  const definitions = JSON.parse(readFileSync(new URL('../server/data/decompile/collectibles.json', import.meta.url), 'utf8')).eggTypes;
  const catalog = Object.values(definitions).flat();
  const fixtures = [
    ['EGG_COLOR_WHITE', 'White Egg', 20],
    ['EGG_COLOR_BLUE', 'Blue Egg', 30],
    ['EGG_SCALES_RAINBOW', 'Rainbow Scales Egg', 40],
    ['EGG_MATERIAL_WOOD', 'Wooden Egg', 75],
    ['EGG_NIGHT_SKY', 'Night Sky Egg', 90],
    ['EGG_INDUSTRY_AGRICULTURE', 'Agriculture Egg', 120],
    ['EGG_ROYAL_GOLD', 'Royal Gold Egg', 250],
    ['EGG_ROYAL_DIAMOND', 'Royal Diamond Egg', 450]
  ];
  for (const [id, name, price] of fixtures) {
    const egg = catalog.find(egg => egg.id === id);
    assert.ok(egg, 'fixture must use a canonical collectible definition');
    const result = server.db.prepare('INSERT INTO nft_assets (definition_id,name,image,realm,rarity,description,current_owner_id,minted_at) VALUES (?,?,?,0,?,?,NULL,?)')
      .run(id, name, egg.image, egg.rarity, 'Isolated collectible trading fixture', new Date().toISOString());
    server.db.prepare("INSERT INTO nft_listings (nft_id,seller_id,price_simboosts,status,created_at) VALUES (?,NULL,?,'active',?)")
      .run(Number(result.lastInsertRowid), price, new Date().toISOString());
  }
}

interface MarketAsset {
  id: number;
  name: string;
  image: string;
  realm: number;
  rarity: string;
  description: string;
  currentOwnerId: number | null;
  ipfs?: { description: string };
}

interface MarketListing {
  id: number;
  priceSimboosts: number;
  sellerId: number | null;
  createdAt: string;
  asset: MarketAsset;
}

async function marketList(cookie: string): Promise<MarketListing[]> {
  const res = await api(cookie, 'GET', '/api/v2/market-collectibles/');
  assert.equal(res.status, 200);
  return res.json as unknown as MarketListing[];
}

interface TradeView {
  id: number;
  datetime: string;
  priceSimboosts: number;
}

interface CollectorView {
  id: number;
  company: string;
  logo: string;
  count: number;
  value: number;
}

async function runIssue82Tests(): Promise<TestOutcome[]> {
  const results: TestOutcome[] = [];

  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ PASS: ${name}`);
    } catch (err: unknown) {
      results.push({ name, ok: false, error: err });
      console.log(`  ✗ FAIL: ${name}`);
      console.log(String(err instanceof Error ? err.stack : err));
    }
  }

  const { cookie: aliceCookie, companyId: aliceId } = await registerCompany('alice');
  const { cookie: bobCookie, companyId: bobId } = await registerCompany('bob');
  const { cookie: carolCookie, companyId: carolId } = await registerCompany('carol');
  setCompanySimboosts(aliceId, 10000);
  setCompanySimboosts(bobId, 5000);
  setCompanySimboosts(carolId, 10);

  await test('seeded exchange is browsable: 8 unique collectibles across all rarity tiers', async () => {
    const list = await marketList(aliceCookie);
    assert.equal(list.length, 8, `expected 8 seeded listings, got ${list.length}`);

    const rarities = new Set<string>();
    const assetIds = new Set<number>();
    let previousPrice = 0;
    for (const listing of list) {
      assert.ok(Number.isInteger(listing.id) && listing.id > 0, 'listing id missing');
      assert.ok(Number.isInteger(listing.priceSimboosts) && listing.priceSimboosts > 0, 'priceSimboosts must be a positive integer');
      assert.ok(listing.priceSimboosts >= previousPrice, 'market list must be ordered by price ascending');
      previousPrice = listing.priceSimboosts;
      assert.ok(typeof listing.createdAt === 'string' && listing.createdAt.length > 0, 'listing createdAt missing');

      const asset = listing.asset;
      assert.ok(asset && Number.isInteger(asset.id), 'asset payload missing');
      assert.ok(!assetIds.has(asset.id), 'each seeded collectible must be unique');
      assetIds.add(asset.id);
      assert.ok(typeof asset.name === 'string' && asset.name.length > 0, 'asset name missing');
      assert.ok(asset.image.startsWith('images/eggs/'), `decompile-verbatim image expected, got ${asset.image}`);
      assert.equal(asset.realm, 0);
      assert.ok(['COMMON', 'RARE', 'SPECIAL', 'MYTHIC'].includes(asset.rarity), `unknown rarity ${asset.rarity}`);
      assert.ok(asset.description.length > 0, 'asset description missing');
      assert.equal(asset.currentOwnerId, null, 'seeded collectibles belong to the exchange treasury (null owner)');
      assert.ok(listing.sellerId === null, 'treasury listing has no player seller');
      assert.ok(asset.ipfs && asset.ipfs.description === asset.description, 'market list asset carries ipfs { description }');
      rarities.add(asset.rarity);
    }
    assert.deepEqual([...rarities].sort(), ['COMMON', 'MYTHIC', 'RARE', 'SPECIAL'], 'all four rarity tiers must be seeded');
  });

  let diamondListingId = 0;
  let diamondAssetId = 0;

  await test('GET /api/v2/market-collectibles-sbs/ keeps the decompiled availability shape', async () => {
    const res = await api(aliceCookie, 'GET', '/api/v2/market-collectibles-sbs/');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { simboosts: 0, available: 0, simBoostsAvailableForPurchase: 0 }, 'private server cannot advertise paid packs when payments are disabled');
  });

  await test('NFT asset metadata: ?ipfs=true adds the ipfs object, unknown asset 404s', async () => {
    const list = await marketList(aliceCookie);
    const sample = list[0];

    const plain = await api(aliceCookie, 'GET', `/api/v2/nfts/assets/${sample.asset.id}/`);
    assert.equal(plain.status, 200);
    const plainBody = plain.json as Record<string, unknown>;
    assert.equal(plainBody.name, sample.asset.name);
    assert.equal(plainBody.image, sample.asset.image);
    assert.equal(plainBody.currentOwnerId, null);
    assert.equal('ipfs' in plainBody, false, 'ipfs metadata only included on ?ipfs=true');

    const withIpfs = await api(aliceCookie, 'GET', `/api/v2/nfts/assets/${sample.asset.id}/?ipfs=true`);
    assert.equal(withIpfs.status, 200);
    const ipfsBody = withIpfs.json as Record<string, unknown>;
    assert.ok(ipfsBody.ipfs && typeof ipfsBody.ipfs === 'object');
    assert.equal((ipfsBody.ipfs as { description: string }).description, sample.asset.description);

    const missing = await api(aliceCookie, 'GET', '/api/v2/nfts/assets/999999/');
    assert.equal(missing.status, 404);
  });

  await test('unauthenticated browsing is public, unauthenticated trading is 401', async () => {
    const list = await marketList('');
    assert.equal(list.length, 8);

    const collectors = await api('', 'GET', '/api/v2/nfts/collectors/');
    assert.equal(collectors.status, 200);

    const activeListing = (await marketList(aliceCookie)).find(l => l.asset.name === 'White Egg');
    assert.ok(activeListing, 'White Egg treasury listing expected');

    const anonBuy = await api('', 'POST', `/api/v2/market-collectibles/${activeListing.id}/buy/`);
    assert.equal(anonBuy.status, 401);
    const anonList = await api('', 'POST', '/api/v2/market-collectibles/', { collectibleId: activeListing.asset.id, simboosts: 10 });
    assert.equal(anonList.status, 401);
    const anonPatch = await api('', 'PATCH', `/api/v2/market-collectibles/${activeListing.id}/`, {});
    assert.equal(anonPatch.status, 401);

    // Nothing changed: the targeted listing is still active.
    const stillThere = (await marketList(aliceCookie)).some(l => l.id === activeListing.id);
    assert.ok(stillThere, 'rejected anonymous buy must leave the listing untouched');
  });

  await test('treasury purchase debits the buyer, transfers ownership, closes the listing', async () => {
    const list = await marketList(aliceCookie);
    const diamond = list.find(l => l.asset.name === 'Royal Diamond Egg');
    assert.ok(diamond, 'Royal Diamond Egg treasury listing expected');
    diamondListingId = diamond.id;
    diamondAssetId = diamond.asset.id;
    assert.equal(diamond.priceSimboosts, 450, 'seed price for the mythic diamond egg');

    const before = await authCompany(aliceCookie);
    assert.equal(before.simBoosts, 10000, 'alice test fixture balance');

    const res = await api(aliceCookie, 'POST', `/api/v2/market-collectibles/${diamondListingId}/buy/`);
    assert.equal(res.status, 200, `buy failed: ${errorText(res.json)}`);
    const purchase = res.json as { priceSimboosts: number; buyerSimboosts: number; asset: { currentOwnerId: number }; listing: { status: string } };
    assert.equal(purchase.priceSimboosts, 450);
    assert.equal(purchase.buyerSimboosts, 9550, 'buyer debited exactly the listing price');
    assert.equal(purchase.asset.currentOwnerId, aliceId, 'ownership transferred to the buyer');
    assert.equal(purchase.listing.status, 'sold');

    const after = await authCompany(aliceCookie);
    assert.equal(after.simBoosts, 9550, 'SimBoost balance persisted');

    // Listing closed and ownership visible on the public surfaces.
    const remaining = await marketList(aliceCookie);
    assert.ok(!remaining.some(l => l.id === diamondListingId), 'sold listing leaves the market list');
    const asset = await api(aliceCookie, 'GET', `/api/v2/nfts/assets/${diamondAssetId}/`);
    assert.equal((asset.json as Record<string, unknown>).currentOwnerId, aliceId);

    // Buying an already-sold listing is rejected.
    const rebuy = await api(bobCookie, 'POST', `/api/v2/market-collectibles/${diamondListingId}/buy/`);
    assert.equal(rebuy.status, 409, 'sold listing cannot be bought again');
  });

  let aliceListingId = 0;

  await test('listing is owner-only with a positive integer SimBoost price', async () => {
    const res = await api(aliceCookie, 'POST', '/api/v2/market-collectibles/', { collectibleId: diamondAssetId, simboosts: 700 });
    assert.equal(res.status, 200, `list failed: ${errorText(res.json)}`);
    const listing = res.json as { id: number; nftId: number; sellerId: number | null; priceSimboosts: number; status: string };
    assert.equal(listing.nftId, diamondAssetId);
    assert.equal(listing.sellerId, aliceId);
    assert.equal(listing.priceSimboosts, 700);
    assert.equal(listing.status, 'active');
    aliceListingId = listing.id;

    const list = await marketList(aliceCookie);
    const entry = list.find(l => l.id === aliceListingId);
    assert.ok(entry, 'new listing appears on the market');
    assert.equal(entry.asset.currentOwnerId, aliceId, 'listed asset remains owned by the seller');

    // Only one active listing per collectible.
    const doubleList = await api(aliceCookie, 'POST', '/api/v2/market-collectibles/', { collectibleId: diamondAssetId, simboosts: 10 });
    assert.equal(doubleList.status, 409);
    assert.match(errorCode(doubleList.json) || '', /CONFLICT/);

    // Bob cannot list a collectible he does not own.
    const notOwner = await api(bobCookie, 'POST', '/api/v2/market-collectibles/', { collectibleId: diamondAssetId, simboosts: 10 });
    assert.equal(notOwner.status, 403);

    // Price validation.
    for (const badPrice of [0, -5, 1.5, 'x']) {
      const bad = await api(aliceCookie, 'POST', '/api/v2/market-collectibles/', { collectibleId: diamondAssetId, simboosts: badPrice });
      assert.equal(bad.status, 400, `price ${JSON.stringify(badPrice)} must be rejected`);
    }
    const unknownAsset = await api(aliceCookie, 'POST', '/api/v2/market-collectibles/', { collectibleId: 999999, simboosts: 10 });
    assert.equal(unknownAsset.status, 404);
  });

  await test('PATCH is owner-only: price update, delist (free), re-list; empty body delists', async () => {
    // Non-owners cannot manage the listing.
    const bobPrice = await api(bobCookie, 'PATCH', `/api/v2/market-collectibles/${aliceListingId}/`, { priceSimboosts: 1 });
    assert.equal(bobPrice.status, 403);
    const bobDelist = await api(bobCookie, 'PATCH', `/api/v2/market-collectibles/${aliceListingId}/`, {});
    assert.equal(bobDelist.status, 403);

    // Owner updates the price.
    const reprice = await api(aliceCookie, 'PATCH', `/api/v2/market-collectibles/${aliceListingId}/`, { priceSimboosts: 650 });
    assert.equal(reprice.status, 200);
    assert.equal((reprice.json as { priceSimboosts: number }).priceSimboosts, 650);
    const afterReprice = (await marketList(aliceCookie)).find(l => l.id === aliceListingId);
    assert.equal(afterReprice?.priceSimboosts, 650, 'market list reflects the new price');

    // Invalid prices rejected, listing untouched.
    const badPrice = await api(aliceCookie, 'PATCH', `/api/v2/market-collectibles/${aliceListingId}/`, { priceSimboosts: 0 });
    assert.equal(badPrice.status, 400);
    assert.equal((await marketList(aliceCookie)).find(l => l.id === aliceListingId)?.priceSimboosts, 650);

    // Owner delists for free (empty body = the decompiled delist call).
    const delist = await api(aliceCookie, 'PATCH', `/api/v2/market-collectibles/${aliceListingId}/`, {});
    assert.equal(delist.status, 200);
    assert.equal((delist.json as { status: string }).status, 'delisted');
    assert.ok(!(await marketList(aliceCookie)).some(l => l.id === aliceListingId), 'delisted listing leaves the market list');
    const aliceAfterDelist = await authCompany(aliceCookie);
    assert.equal(aliceAfterDelist.simBoosts, 9550, 'delisting is free');

    // A delisted collectible cannot be bought.
    const buyDelisted = await api(bobCookie, 'POST', `/api/v2/market-collectibles/${aliceListingId}/buy/`);
    assert.equal(buyDelisted.status, 409);

    // Owner re-lists.
    const relist = await api(aliceCookie, 'PATCH', `/api/v2/market-collectibles/${aliceListingId}/`, { listed: true });
    assert.equal(relist.status, 200);
    assert.equal((relist.json as { status: string }).status, 'active');
    assert.ok((await marketList(aliceCookie)).some(l => l.id === aliceListingId), 're-listed listing is browsable again');

    // Selling the collectible privately is not possible — there is exactly
    // one exchange path, so a second active listing stays impossible.
    const secondListing = await api(aliceCookie, 'POST', '/api/v2/market-collectibles/', { collectibleId: diamondAssetId, simboosts: 100 });
    assert.equal(secondListing.status, 409);
  });

  await test('buying with insufficient SimBoosts fails atomically: no debit, no transfer', async () => {
    const beforeCarol = await authCompany(carolCookie);
    assert.equal(beforeCarol.simBoosts, 10);

    const res = await api(carolCookie, 'POST', `/api/v2/market-collectibles/${aliceListingId}/buy/`);
    assert.equal(res.status, 400, `expected 400 for insufficient SimBoosts, got ${res.status}`);
    assert.equal(errorCode(res.json), 'INSUFFICIENT_FUNDS');

    // Atomicity: nothing moved.
    assert.equal((await authCompany(carolCookie)).simBoosts, 10, 'failed buyer must not be debited');
    assert.equal((await authCompany(aliceCookie)).simBoosts, 9550, 'failed sale must not credit the seller');
    const asset = await api(aliceCookie, 'GET', `/api/v2/nfts/assets/${diamondAssetId}/`);
    assert.equal((asset.json as Record<string, unknown>).currentOwnerId, aliceId, 'ownership unchanged');
    const entry = (await marketList(aliceCookie)).find(l => l.id === aliceListingId);
    assert.ok(entry && entry.priceSimboosts === 650, 'listing still active at the same price');
  });

  await test('buying your own listing is rejected', async () => {
    const res = await api(aliceCookie, 'POST', `/api/v2/market-collectibles/${aliceListingId}/buy/`);
    assert.equal(res.status, 409);
    assert.equal((await authCompany(aliceCookie)).simBoosts, 9550, 'no self-trade debit');
  });

  await test('player-to-player purchase credits the seller atomically', async () => {
    const res = await api(bobCookie, 'POST', `/api/v2/market-collectibles/${aliceListingId}/buy/`);
    assert.equal(res.status, 200, `buy failed: ${errorText(res.json)}`);
    const purchase = res.json as { priceSimboosts: number; buyerSimboosts: number; asset: { currentOwnerId: number } };
    assert.equal(purchase.priceSimboosts, 650);
    assert.equal(purchase.buyerSimboosts, 4350, 'bob debited 650 from 5000');
    assert.equal(purchase.asset.currentOwnerId, bobId, 'ownership transferred to bob');

    assert.equal((await authCompany(bobCookie)).simBoosts, 4350);
    assert.equal((await authCompany(aliceCookie)).simBoosts, 9550 + 650, 'alice credited exactly the price');
    assert.ok(!(await marketList(bobCookie)).some(l => l.id === aliceListingId), 'sold listing leaves the market');
  });

  await test('second-hand resale chain: bob lists at 900 and carol buys', async () => {
    const relist = await api(bobCookie, 'POST', '/api/v2/market-collectibles/', { collectibleId: diamondAssetId, simboosts: 900 });
    assert.equal(relist.status, 200, `bob relist failed: ${errorText(relist.json)}`);
    const bobListingId = (relist.json as { id: number }).id;
    assert.notEqual(bobListingId, aliceListingId, 'a resale creates a fresh listing id');

    setCompanySimboosts(carolId, 1000);
    const res = await api(carolCookie, 'POST', `/api/v2/market-collectibles/${bobListingId}/buy/`);
    assert.equal(res.status, 200, `carol buy failed: ${errorText(res.json)}`);
    assert.equal((res.json as { buyerSimboosts: number }).buyerSimboosts, 100, 'carol debited 900 from 1000');
    assert.equal((await authCompany(bobCookie)).simBoosts, 4350 + 900, 'bob credited 900');
    const asset = await api(carolCookie, 'GET', `/api/v2/nfts/assets/${diamondAssetId}/`);
    assert.equal((asset.json as Record<string, unknown>).currentOwnerId, carolId, 'diamond now owned by carol');
  });

  await test('trade history chain grows with every sale in chronological order', async () => {
    const res = await api(carolCookie, 'GET', `/api/v2/nfts/assets/${diamondAssetId}/trades/`);
    assert.equal(res.status, 200);
    const body = res.json as { trades: TradeView[] };
    assert.ok(Array.isArray(body.trades), 'response shape { trades: [...] }');
    assert.equal(body.trades.length, 3, 'treasury sale + resale + second-hand sale');

    const prices = body.trades.map(t => t.priceSimboosts);
    assert.deepEqual(prices, [450, 650, 900], 'provenance chain records each sale price in order');
    let lastId = 0;
    for (const trade of body.trades) {
      assert.ok(Number.isInteger(trade.id) && trade.id > lastId, 'trade ids strictly ascending');
      lastId = trade.id;
      assert.ok(!Number.isNaN(Date.parse(trade.datetime)), `trade datetime must be ISO-parseable, got ${trade.datetime}`);
    }

    // A never-sold collectible has an empty chain.
    const whiteEgg = (await marketList(carolCookie)).find(l => l.asset.name === 'White Egg');
    assert.ok(whiteEgg, 'White Egg still listed');
    const empty = await api(carolCookie, 'GET', `/api/v2/nfts/assets/${whiteEgg.asset.id}/trades/`);
    assert.deepEqual(empty.json, { trades: [] });

    const missing = await api(carolCookie, 'GET', '/api/v2/nfts/assets/999999/trades/');
    assert.equal(missing.status, 404);
  });

  await test('collectors ranking orders by count first, then by acquisition value', async () => {
    // alice accumulates two treasury collectibles, bob one.
    const rainbow = (await marketList(aliceCookie)).find(l => l.asset.name === 'Rainbow Scales Egg');
    const wooden = (await marketList(aliceCookie)).find(l => l.asset.name === 'Wooden Egg');
    const nightSky = (await marketList(aliceCookie)).find(l => l.asset.name === 'Night Sky Egg');
    assert.ok(rainbow && wooden && nightSky, 'treasury listings for the ranking fixture');

    assert.equal((await api(aliceCookie, 'POST', `/api/v2/market-collectibles/${rainbow.id}/buy/`)).status, 200);
    assert.equal((await api(aliceCookie, 'POST', `/api/v2/market-collectibles/${wooden.id}/buy/`)).status, 200);
    assert.equal((await api(bobCookie, 'POST', `/api/v2/market-collectibles/${nightSky.id}/buy/`)).status, 200);
    assert.equal((await authCompany(aliceCookie)).simBoosts, 10085, 'alice: 10200 - 40 - 75');
    assert.equal((await authCompany(bobCookie)).simBoosts, 5160, 'bob: 5250 - 90');

    const res = await api(aliceCookie, 'GET', '/api/v2/nfts/collectors/');
    assert.equal(res.status, 200);
    const collectors = res.json as unknown as CollectorView[];
    assert.ok(Array.isArray(collectors) && collectors.length >= 3, 'at least the three test collectors ranked');

    const alice = collectors.find(c => c.id === aliceId);
    const bob = collectors.find(c => c.id === bobId);
    const carol = collectors.find(c => c.id === carolId);
    assert.ok(alice && bob && carol, 'every owning company is ranked');

    assert.equal(alice.count, 2, 'alice owns 2 collectibles');
    assert.equal(alice.value, 115, 'alice value = 40 + 75 (latest sale price per asset)');
    assert.ok(typeof alice.company === 'string' && alice.company.length > 0, 'collector row carries the company name');
    assert.equal(bob.count, 1);
    assert.equal(bob.value, 90);
    assert.equal(carol.count, 1);
    assert.equal(carol.value, 900, 'carol value = latest sale price of the diamond');

    // Ranking: count desc, then value desc.
    assert.equal(collectors[0].id, aliceId, 'the 2-collectible collector ranks first');
    const carolIndex = collectors.findIndex(c => c.id === carolId);
    const bobIndex = collectors.findIndex(c => c.id === bobId);
    assert.ok(carolIndex < bobIndex, 'count tie broken by value: carol (900) above bob (90)');
    for (const entry of collectors) {
      assert.ok(Number.isInteger(entry.id) && entry.count >= 1, 'treasury (null owner) never ranked');
    }
  });
  return results;
}

async function main(): Promise<void> {
  const results = await withTestServer(async instance => {
    server = instance;
    assert.deepEqual(await marketList(''), [], 'fresh exchange is empty before the explicit test fixture');
    prepareCollectibles();
    return runIssue82Tests();
  }, { env: { PAYMENTS_DISABLED: '1' } });

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
