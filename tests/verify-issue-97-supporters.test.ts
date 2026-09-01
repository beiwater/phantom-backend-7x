/**
 * Issue #97 regression: [P1/Supporters] Supporter package does not persist
 * status or +1 extra building slot; admin status conflated with supporter.
 *
 * Verifies, against a real server on port 3860 with a dedicated DATA_DIR:
 *  1. Buying the supporter package persists `supporter_until` (+30 days) and
 *     `supporter_certificates` on the company row, for a NORMAL (non-admin)
 *     player.
 *  2. The auth payload reflects the real supporter state
 *     (authUser.supporterPurchased / authUser.supporter) and no longer
 *     conflates it with is_admin.
 *  3. Supporter perk: +1 extra building slot while the term is active —
 *     visible in authCompany.extraBuildingSlots and in the maxBuildings
 *     computation (levelInfo.maxBuildings), stacking with purchased slots.
 *  4. Supporter perk: 10% permanent discount on SimBoost package purchases —
 *     listed prices and the purchase echo both reflect it; supporterOnly
 *     variants are not double-discounted; non-supporters pay full price.
 *  5. Package filtering: supporterOnly packages only for active supporters;
 *     the supporter package hides while active and returns after expiry.
 *  6. Double-click idempotency: a replayed supporter purchase does not extend
 *     the term or mint a second certificate.
 *  7. Expiry handling: an expired term drops supporter/active perks (slot,
 *     discount, filtering) but keeps supporterPurchased; renewing after
 *     expiry restarts the term and awards a second certificate.
 *
 * Run: /opt/magnate/.node22/bin/node --experimental-strip-types tests/verify-issue-97-supporters.test.ts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const TEST_PORT = Number(process.env.PORT || '3860');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORTER_TERM_DAYS = 30;

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

  const dataDir = path.resolve('data', `test-run-issue-97-${Date.now()}`);
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
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  child.stderr?.on('data', (chunk) => {
    const str = chunk.toString();
    if (!str.includes('ExperimentalWarning')) {
      process.stderr.write(`[server-3860] ${str}`);
    }
  });
  await waitUntilReachable(`${BASE_URL}/version/`, 30000);
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  return { child, dataDir, dbPath };
}

interface AuthPayload {
  authUser: {
    isAdmin: boolean;
    supporterPurchased: boolean;
    supporter: boolean;
  } | null;
  authCompany: {
    companyId: number;
    extraBuildingSlots: number;
    simBoosts: number;
  };
  levelInfo: {
    maxBuildings: number;
  } | null;
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `supporters_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      company: `Supporters ${label} ${Date.now()}`
    })
  });
  assert.equal(res.status, 200, 'Registration should return 200');

  const cookies = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  const cookie = cookies.find((v) => v.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Session cookie must be returned');

  const authData = await getAuthData(cookie);
  const companyId = authData.authCompany?.companyId ?? 0;
  assert.ok(companyId > 0, 'Valid companyId must be extracted');
  return { cookie, companyId };
}

async function getAuthData(cookie: string): Promise<AuthPayload> {
  const res = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200, 'auth-data must return 200');
  return (await res.json()) as AuthPayload;
}

interface PackageDto {
  sku: string;
  simBoosts: number;
  price: string;
  currency: string;
  supporterOnly: boolean;
  isSupporter: boolean;
  approximateCurrency?: { code: string; value: string };
}

async function getPackages(cookie?: string): Promise<Map<string, PackageDto>> {
  const res = await fetch(`${BASE_URL}/api/v4/payment-packages/web/`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
  assert.equal(res.status, 200, 'payment-packages must return 200');
  const body = (await res.json()) as { packages: PackageDto[] };
  return new Map(body.packages.map(p => [p.sku, p]));
}

interface PurchaseResponse {
  payment: { sku: string; simBoosts: number; price: string; currency: string };
  simBoosts: number;
  companySimboosts: number;
  supporter: boolean;
  supporterUntil?: string;
  supporterCertificates?: number;
  supporterDiscountPercent?: number;
}

async function purchase(cookie: string, sku: string): Promise<{ status: number; body: PurchaseResponse }> {
  const res = await fetch(`${BASE_URL}/api/v2/payment/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ sku })
  });
  const body = (await res.json()) as PurchaseResponse;
  return { status: res.status, body };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSupportersVerification(): Promise<void> {
  console.log('================================================================');
  console.log(' Starting Issue #97: Supporters Verification');
  console.log(` Target Server: ${BASE_URL} (Port ${TEST_PORT})`);
  console.log('================================================================');
  let server: ServerInstance | null = null;
  try {
    server = await startTestServer();
    console.log('✔ Test server started successfully on port', TEST_PORT);

    const db = new DatabaseSync(server.dbPath);

    function supporterRow(companyId: number): { supporter_until: string | null; supporter_certificates: number } {
      const row = db.prepare('SELECT supporter_until, supporter_certificates FROM companies WHERE company_id = ?')
        .get(companyId) as { supporter_until: string | null; supporter_certificates: number } | undefined;
      assert.ok(row, 'company row must exist');
      return row;
    }

    // ----------------------------------------------------------------
    // [1] Fresh NORMAL (non-admin) player: no supporter state, no admin
    //     conflation, no slot perk.
    // ----------------------------------------------------------------
    console.log('[1/7] Fresh non-admin player starts with clean supporter state...');
    const { cookie, companyId } = await registerCompany('main');
    const before = await getAuthData(cookie);
    assert.equal(before.authUser?.isAdmin, false, 'test player must not be an admin');
    assert.equal(before.authUser?.supporterPurchased, false, 'fresh player must not be supporterPurchased');
    assert.equal(before.authUser?.supporter, false, 'fresh player must not be a supporter');
    assert.equal(before.authCompany.extraBuildingSlots, 0, 'fresh player has no extra building slots');
    assert.equal(before.levelInfo?.maxBuildings, 4, 'level-1 tier maxBuildings is 4 without perks');
    const rowBefore = supporterRow(companyId);
    assert.equal(rowBefore.supporter_until, null, 'supporter_until must start NULL');
    assert.equal(Number(rowBefore.supporter_certificates), 0, 'supporter_certificates must start 0');
    console.log('  ✔ clean baseline: no admin conflation, no supporter state, 0 extra slots');

    // ----------------------------------------------------------------
    // [2] Buying the supporter package persists term + certificate for a
    //     normal player and grants the +1 slot perk in auth data.
    // ----------------------------------------------------------------
    console.log('[2/7] Supporter package purchase persists supporter_until + certificates...');
    const purchaseStart = Date.now();
    const bought = await purchase(cookie, 'supporter');
    assert.equal(bought.status, 200, `supporter purchase must succeed: ${JSON.stringify(bought.body)}`);
    assert.equal(bought.body.supporter, true, 'purchase response must flag supporter');
    assert.equal(bought.body.supporterCertificates, 1, 'first purchase awards exactly one certificate');
    assert.ok(bought.body.supporterUntil, 'purchase response must carry supporterUntil');

    const expectedEnd = purchaseStart + SUPPORTER_TERM_DAYS * DAY_MS;
    const untilMs = Date.parse(String(bought.body.supporterUntil));
    assert.ok(
      Math.abs(untilMs - expectedEnd) < 120_000,
      `supporterUntil must be ~now+30d, got ${bought.body.supporterUntil}`
    );

    const rowAfter = supporterRow(companyId);
    assert.equal(rowAfter.supporter_until, bought.body.supporterUntil, 'supporter_until must be persisted verbatim');
    assert.equal(Number(rowAfter.supporter_certificates), 1, 'supporter_certificates must be persisted');

    const after = await getAuthData(cookie);
    assert.equal(after.authUser?.supporterPurchased, true, 'normal player must become supporterPurchased');
    assert.equal(after.authUser?.supporter, true, 'active term must set authUser.supporter');
    assert.equal(after.authUser?.isAdmin, false, 'supporter status must NOT flip isAdmin (deconflation)');
    assert.equal(after.authCompany.extraBuildingSlots, 1, 'supporter perk grants +1 extra building slot');
    assert.equal(after.levelInfo?.maxBuildings, 5, 'maxBuildings computation must include the supporter slot');
    console.log('  ✔ persisted: term ~+30d, certificate 1, supporter=true, isAdmin=false, +1 slot (maxBuildings 4->5)');

    // ----------------------------------------------------------------
    // [3] The supporter slot stacks with a purchased building slot.
    // ----------------------------------------------------------------
    console.log('[3/7] Supporter +1 slot stacks with a purchased building slot...');
    const unlockRes = await fetch(`${BASE_URL}/api/v2/unlock/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({})
    });
    assert.equal(unlockRes.status, 200, `unlockBuildingSlot must succeed: ${await unlockRes.text()}`);
    const rowSlot = supporterRow(companyId);
    const storedSlots = db.prepare('SELECT extra_building_slots FROM companies WHERE company_id = ?')
      .get(companyId) as { extra_building_slots: number };
    assert.equal(Number(storedSlots.extra_building_slots), 1, 'purchased slot must be stored without the perk');
    assert.equal(rowSlot.supporter_until, bought.body.supporterUntil, 'unlock must not touch supporter state');
    const stacked = await getAuthData(cookie);
    assert.equal(stacked.authCompany.extraBuildingSlots, 2, 'auth shows purchased slot + supporter slot');
    assert.equal(stacked.levelInfo?.maxBuildings, 6, 'maxBuildings = tier(4) + purchased(1) + supporter(1)');
    console.log('  ✔ stacking: extraBuildingSlots 2, maxBuildings 6 after one purchased slot');

    // ----------------------------------------------------------------
    // [4] 10% supporter discount: package list + purchase echo.
    // ----------------------------------------------------------------
    console.log('[4/7] 10% supporter discount on SimBoost packages...');
    const supporterPkgs = await getPackages(cookie);
    const discountedSmall = supporterPkgs.get('sb-sb150');
    assert.ok(discountedSmall, 'sb-sb150 must be listed to a supporter');
    assert.equal(discountedSmall.price, '5.30', `5.89 - 10% must be 5.30, got ${discountedSmall.price}`);
    assert.equal(discountedSmall.approximateCurrency?.value, '7.40', 'approximateCurrency must be discounted too');
    const discountedLarge = supporterPkgs.get('sb-sb1900');
    assert.equal(discountedLarge?.price, '42.26', `46.95 - 10% must be 42.26, got ${discountedLarge?.price}`);
    const supporterOnlyPkg = supporterPkgs.get('sb-s-sb150');
    assert.ok(supporterOnlyPkg, 'supporterOnly packages must be visible to an active supporter');
    assert.equal(supporterOnlyPkg.price, '5.25', 'supporterOnly variants must NOT be double-discounted');
    assert.ok(!supporterPkgs.has('supporter'), 'the supporter package must be hidden while a term is active');

    const echo = await purchase(cookie, 'sb-sb150');
    assert.equal(echo.status, 200, 'discounted purchase must succeed');
    assert.equal(echo.body.payment.price, '5.30', 'purchase echo must carry the discounted price');
    assert.equal(echo.body.supporterDiscountPercent, 10, 'purchase echo must name the 10% discount');
    assert.equal(echo.body.payment.simBoosts, 150, 'discount does not change the granted boosts');
    const echoSupporterOnly = await purchase(cookie, 'sb-s-sb150');
    assert.equal(echoSupporterOnly.status, 200, 'supporterOnly purchase must succeed');
    assert.equal(echoSupporterOnly.body.payment.price, '5.25', 'supporterOnly purchase echo keeps its own price');

    // Fresh non-supporter player pays full price and cannot see supporter SKUs.
    const plain = await registerCompany('plain');
    const plainPkgs = await getPackages(plain.cookie);
    const plainSmall = plainPkgs.get('sb-sb150');
    assert.equal(plainSmall?.price, '5.89', 'non-supporters see the full price');
    assert.ok(!plainPkgs.has('sb-s-sb150'), 'supporterOnly packages must be hidden from non-supporters');
    assert.ok(plainPkgs.has('supporter'), 'the supporter package must be offered to non-supporters');
    const plainEcho = await purchase(plain.cookie, 'sb-sb150');
    assert.equal(plainEcho.status, 200, 'non-supporter purchase must succeed');
    assert.equal(plainEcho.body.payment.price, '5.89', 'non-supporter purchase echo carries the full price');
    assert.equal(plainEcho.body.supporterDiscountPercent, undefined, 'no discount flag for non-supporters');

    // Unauthenticated catalog: supporterOnly hidden, supporter package present.
    const guestPkgs = await getPackages();
    assert.ok(!guestPkgs.has('sb-s-sb150'), 'guests are not supporters: supporterOnly hidden');
    assert.ok(guestPkgs.has('supporter'), 'guests are offered the supporter package');
    assert.equal(guestPkgs.get('sb-sb150')?.price, '5.89', 'guests see full prices');
    console.log('  ✔ discount: list 5.89->5.30 & 46.95->42.26, echo 5.30 + flag, non-supporter pays 5.89');

    // ----------------------------------------------------------------
    // [5] Double-click idempotency: replay must not re-activate.
    // ----------------------------------------------------------------
    console.log('[5/7] Double-clicked supporter purchase replays idempotently...');
    const replay = await purchase(cookie, 'supporter');
    assert.equal(replay.status, 200, 'replayed purchase must succeed');
    assert.equal(replay.body.supporterCertificates, 1, 'replay must not mint a second certificate');
    assert.equal(
      replay.body.supporterUntil,
      bought.body.supporterUntil,
      'replay must not extend the supporter term'
    );
    const rowReplay = supporterRow(companyId);
    assert.equal(Number(rowReplay.supporter_certificates), 1, 'DB keeps exactly one certificate after replay');
    console.log('  ✔ replay: certificate still 1, term unchanged');

    // ----------------------------------------------------------------
    // [6] Expiry handling: expired term drops perks, keeps the purchase.
    // ----------------------------------------------------------------
    console.log('[6/7] Expired supporter term degrades perks cleanly...');
    const yesterday = new Date(Date.now() - DAY_MS).toISOString();
    db.prepare('UPDATE companies SET supporter_until = ? WHERE company_id = ?').run(yesterday, companyId);

    const expired = await getAuthData(cookie);
    assert.equal(expired.authUser?.supporter, false, 'expired term must drop authUser.supporter');
    assert.equal(expired.authUser?.supporterPurchased, true, 'expired term keeps supporterPurchased');
    assert.equal(expired.authCompany.extraBuildingSlots, 1, 'expired perk slot is withdrawn (purchased slot stays)');
    assert.equal(expired.levelInfo?.maxBuildings, 5, 'maxBuildings back to tier + purchased slots only');

    const expiredPkgs = await getPackages(cookie);
    assert.equal(expiredPkgs.get('sb-sb150')?.price, '5.89', 'expired term loses the 10% discount');
    assert.ok(!expiredPkgs.has('sb-s-sb150'), 'expired supporter loses supporterOnly visibility');
    assert.ok(expiredPkgs.has('supporter'), 'the supporter package is offered again for renewal');

    const expiredEcho = await purchase(cookie, 'sb-sb150');
    assert.equal(expiredEcho.status, 200, 'post-expiry purchase must succeed');
    assert.equal(expiredEcho.body.payment.price, '5.89', 'post-expiry purchase echo is full price');
    assert.equal(expiredEcho.body.supporterDiscountPercent, undefined, 'post-expiry purchase has no discount flag');
    console.log('  ✔ expiry: supporter=false, perks withdrawn, certificate retained, renewal offered');

    // ----------------------------------------------------------------
    // [7] Renewal after expiry restarts the term and awards certificate 2.
    //     (Sleep outlives the 5s purchase idempotency window so this is a
    //     fresh grant, not a replay of section [2]/[5].)
    // ----------------------------------------------------------------
    console.log('[7/7] Renewing after expiry restarts the term...');
    await sleep(5200);
    const renewStart = Date.now();
    const renewed = await purchase(cookie, 'supporter');
    assert.equal(renewed.status, 200, 'renewal purchase must succeed');
    assert.equal(renewed.body.supporterCertificates, 2, 'renewal awards a second certificate');
    const renewedEnd = renewStart + SUPPORTER_TERM_DAYS * DAY_MS;
    const renewedUntilMs = Date.parse(String(renewed.body.supporterUntil));
    assert.ok(
      Math.abs(renewedUntilMs - renewedEnd) < 120_000,
      `renewed term must restart at ~now+30d, got ${renewed.body.supporterUntil}`
    );
    assert.ok(
      renewedUntilMs > untilMs,
      'renewal after expiry must not inherit the stale expired term'
    );

    const renewedAuth = await getAuthData(cookie);
    assert.equal(renewedAuth.authUser?.supporter, true, 'renewed term restores authUser.supporter');
    assert.equal(renewedAuth.authUser?.supporterPurchased, true, 'renewal keeps supporterPurchased');
    assert.equal(renewedAuth.authCompany.extraBuildingSlots, 2, 'renewed perk slot returns on top of purchased slot');
    assert.equal(renewedAuth.levelInfo?.maxBuildings, 6, 'maxBuildings includes the renewed supporter slot');
    const rowRenewed = supporterRow(companyId);
    assert.equal(Number(rowRenewed.supporter_certificates), 2, 'DB persists two certificates');
    assert.equal(rowRenewed.supporter_until, renewed.body.supporterUntil, 'DB persists the renewed term');
    console.log('  ✔ renewal: certificates 2, term restarted ~+30d, perks restored');

    console.log('\n================================================================');
    console.log(' All Issue #97 Supporters Assertions PASSED with 0 ERRORS!');
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

runSupportersVerification().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
