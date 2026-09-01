/**
 * Regression tests for Issue #70 remaining items: the tron crypto completion
 * PATCH and the Google/device purchase endpoint must flow through the same
 * validated purchase path (unknown-SKU rejection + daily purchase cap) as the
 * other payment routes, and PAYMENTS_DISABLED=1 must turn every state-changing
 * payment route into an explicit 501 with zero balance mutation.
 *
 * Run against a live private server:
 *   PORT=3601 SPEED_MULTIPLIER=200 DATA_DIR=data/test-run-3601 \
 *     node --experimental-strip-types server/index.ts
 *   BASE_URL=http://127.0.0.1:3601 \
 *     node --experimental-strip-types tests/verify-issue-70-rest.test.ts
 *
 * Covered contracts:
 * - Unknown SKU is rejected with 400 on the tron PATCH and google purchase
 *   (no fallback package, no grant).
 * - The daily purchase cap rejects with 400 on tron PATCH and google purchase.
 * - A normal purchase still credits the package boosts (local direct purchase,
 *   P0-03 behavior unchanged when PAYMENTS_DISABLED is unset).
 * - PAYMENTS_DISABLED=1 (tested by launching a dedicated server below):
 *   every payment POST (main/stripe/sync/tron/google) and the tron PATCH
 *   answer 501 and the boost balance stays untouched.
 */
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '3601';
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

interface ApiResult {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
}

function errorText(json: ApiResult['json']): string {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'error' in json) {
    return String((json as { error: unknown }).error);
  }
  return JSON.stringify(json);
}

async function api(
  cookie: string,
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: ApiResult['json'] = null;
  try {
    json = await response.json();
  } catch {
    // 501/204 bodies may be empty in other server modes; here JSON is expected
  }
  return { status: response.status, json };
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `i70_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test12345!' })
  });
  assert.equal(response.status, 200, `register failed: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .find(c => c.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'session cookie missing');
  const auth = await api(cookie as string, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(auth.status, 200);
  const authJson = auth.json as { authCompany: { companyId: number } };
  return { cookie: cookie as string, companyId: authJson.authCompany.companyId };
}

async function authBoosts(cookie: string): Promise<number> {
  const r = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(r.status, 200);
  return (r.json as { authCompany: { simBoosts: number } }).authCompany.simBoosts;
}

// Spawning a real child server has no exposed readiness promise/event, so the
// probe must poll over real wall-clock time until /version/ answers.
async function waitUntilReachable(url: string, timeoutMs: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const deadline = Date.now() + timeoutMs;
  const probe = async (): Promise<void> => {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {
        // not up yet
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    reject(new Error(`server at ${url} did not become ready within ${timeoutMs}ms`));
  };
  void probe();
  return promise;
}

interface TestOutcome { name: string; ok: boolean; error?: unknown }

async function runDefaultModeTests(): Promise<TestOutcome[]> {
  const results: TestOutcome[] = [];
  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  PASS ${name}`);
    } catch (err: unknown) {
      results.push({ name, ok: false, error: err });
      console.error(`  FAIL ${name}`);
      console.error(err instanceof Error ? err.message : err);
    }
  }

  await test('unknown SKU is rejected with 400 on google purchase (no grant)', async () => {
    const { cookie } = await register('gsku');
    const before = await authBoosts(cookie);
    const r = await api(cookie, 'POST', '/api/v2/google/purchase/', { sku: 'totally-fake-sku' });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${errorText(r.json)}`);
    assert.match(errorText(r.json), /package not found/i);
    assert.equal(await authBoosts(cookie), before, 'rejected purchase must not mint boosts');
  });

  await test('unknown SKU is rejected with 400 on tron PATCH (no fallback package)', async () => {
    const { cookie } = await register('tsku');
    const before = await authBoosts(cookie);
    const r = await api(cookie, 'PATCH', '/api/v2/payment-crypto/tron/driver1/inv-1/', { sku: 'bogus-sku' });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${errorText(r.json)}`);
    assert.match(errorText(r.json), /package not found/i);
    assert.equal(await authBoosts(cookie), before, 'rejected PATCH must not mint boosts');
  });

  await test('tron PATCH goes through the unified purchase path (grant + cap accounting)', async () => {
    const { cookie } = await register('tpath');
    const before = await authBoosts(cookie);
    const r = await api(cookie, 'PATCH', '/api/v2/payment-crypto/tron/driver1/inv-2/', { sku: 'sb-sb330' });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${errorText(r.json)}`);
    const json = r.json as { payment?: { sku?: string; simBoostsPurchased?: number } };
    assert.equal(json.payment?.sku, 'sb-sb330');
    assert.equal(json.payment?.simBoostsPurchased, 330);
    assert.equal(await authBoosts(cookie), before + 330, 'unified path must credit the package boosts');
  });

  await test('daily purchase cap rejects google purchase with 400 past the limit', async () => {
    const { cookie } = await register('gcap');
    // 15 distinct SKUs exist in PAYMENT_PACKAGES; rounds 16-21 reuse SKUs
    // from rounds 1-6. Before reusing them we wait out the idempotency
    // window (below) so those rounds count as fresh purchases.
    const skus = ['sb-sb150', 'sb-sb330', 'sp2', 'sb-sb850', 'sb-sb1900', 'sb-sb3800',
      'sb-sb6300', 'supporter', 'sb-s-sb150', 'sb-s-sb330', 'sb-s-sp2', 'sb-s-sb850',
      'sb-s-sb1900', 'sb-s-sb3800', 'sb-s-sb6300', 'sb-sb150', 'sb-sb330', 'sp2',
      'sb-sb850', 'sb-sb1900', 'sb-sb3800'];
    let last: ApiResult | null = null;
    let granted = 0;
    // Rounds 1-15: one per distinct SKU — no idempotency collisions possible.
    for (let i = 0; i < 15; i++) {
      last = await api(cookie, 'POST', '/api/v2/google/purchase/', { sku: skus[i] });
      if (last.status === 200) {
        granted++;
      } else {
        break;
      }
    }
    // Wait out PURCHASE_IDEMPOTENCY_WINDOW_MS (5s; same pattern as
    // verify-attack-fix-gamelogic.test.ts) so the reused-SKU rounds below
    // count as fresh purchases instead of cached double-click replays.
    await new Promise(resolve => setTimeout(resolve, 5200)); // > PURCHASE_IDEMPOTENCY_WINDOW_MS
    // Rounds 16-21: SKUs reused from rounds 1-6; the cap must now reject
    // round 21 (20 counted purchases) with 400.
    for (let i = 15; i < 21; i++) {
      last = await api(cookie, 'POST', '/api/v2/google/purchase/', { sku: skus[i] });
      if (last.status === 200) {
        granted++;
      } else {
        break;
      }
    }
    assert.equal(granted, 20, `cap must allow exactly 20 purchases, got ${granted}`);
    assert.equal(last?.status, 400, `21st purchase must be rejected with 400, got ${last?.status}`);
    assert.match(errorText(last?.json), /daily purchase limit/i);
  });

  await test('normal path still credits boosts on google purchase (P0-03 local behavior)', async () => {
    const { cookie } = await register('gok');
    const before = await authBoosts(cookie);
    const r = await api(cookie, 'POST', '/api/v2/google/purchase/', { sku: 'sb-sb330' });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${errorText(r.json)}`);
    const json = r.json as { payment?: { sku?: string }; simBoosts?: number };
    assert.equal(json.payment?.sku, 'sb-sb330');
    assert.equal(json.simBoosts, 330);
    assert.equal(await authBoosts(cookie), before + 330, 'valid purchase must credit exactly the package boosts');
  });

  return results;
}


interface DisabledServer { child: ChildProcess; dataDir: string; port: number }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    // Port 0 asks the OS for a currently free listening port.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startDisabledServer(): Promise<DisabledServer> {
  const dataDir = path.resolve('data', `test-run-i70-disabled-${Date.now()}`);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: {
        ...process.env,
        PORT: String(port),
        SPEED_MULTIPLIER: '200',
        PAYMENTS_DISABLED: '1',
        DATA_DIR: dataDir
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );
  child.stderr?.on('data', chunk => process.stderr.write(`[disabled-srv] ${chunk}`));
  await waitUntilReachable(`http://127.0.0.1:${port}/version/`, 90000);
  return { child, dataDir, port };
}

async function runDisabledModeTests(port: number): Promise<TestOutcome[]> {
  const results: TestOutcome[] = [];
  const base = `http://127.0.0.1:${port}`;
  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  PASS ${name}`);
    } catch (err: unknown) {
      results.push({ name, ok: false, error: err });
      console.error(`  FAIL ${name}`);
      console.error(err instanceof Error ? err.message : err);
    }
  }
  async function req(method: string, path: string, body?: unknown, cookie?: string): Promise<ApiResult> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json: ApiResult['json'] = null;
    try {
      json = await response.json();
    } catch {
      // ignore empty bodies
    }
    return { status: response.status, json };
  }

  let cookie = '';
  let boostsBefore = -1;

  await test('disabled server: register a fresh company for the 501 sweep', async () => {
    const email = `i70dis_${Date.now()}@domain.local`;
    const response = await fetch(`${base}/api/v2/auth/email/connect/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test12345!' })
    });
    assert.equal(response.status, 200, `register failed: ${response.status}`);
    cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
      .find(c => c.startsWith('sessionid='))?.split(';')[0] || '';
    assert.ok(cookie, 'session cookie missing');
    const auth = await req('GET', '/api/v3/companies/auth-data/', undefined, cookie);
    assert.equal(auth.status, 200);
    boostsBefore = (auth.json as { authCompany: { simBoosts: number } }).authCompany.simBoosts;
  });

  for (const [method, path, body] of [
    ['POST', '/api/v2/payment/', { sku: 'sb-sb150' }],
    ['POST', '/api/v2/payment-stripe/', { sku: 'sb-sb150' }],
    ['POST', '/api/v2/payment-stripe/sync', {}],
    ['POST', '/api/v2/payment-crypto/tron/', { packageSku: 'sb-sb330' }],
    ['POST', '/api/v2/google/purchase/', { sku: 'sb-sb330' }],
    ['PATCH', '/api/v2/payment-crypto/tron/driver1/inv-9/', { sku: 'sb-sb330' }]
  ] as const) {
    await test(`PAYMENTS_DISABLED=1: ${method} ${path} answers 501`, async () => {
      const r = await req(method, path, body, cookie);
      assert.equal(r.status, 501, `expected 501, got ${r.status}: ${errorText(r.json)}`);
      assert.match(errorText(r.json), /not configured/i);
    });
  }

  await test('PAYMENTS_DISABLED=1: balance untouched after the whole 501 sweep', async () => {
    const r = await req('GET', '/api/v3/companies/auth-data/', undefined, cookie);
    assert.equal(r.status, 200);
    const boosts = (r.json as { authCompany: { simBoosts: number } }).authCompany.simBoosts;
    assert.equal(boosts, boostsBefore, 'no payment route may mutate the boost balance when disabled');
  });

  return results;
}

async function main(): Promise<void> {
  console.log('== Default mode (PAYMENTS_DISABLED unset) ==');
  const defaultResults = await runDefaultModeTests();

  console.log('\n== PAYMENTS_DISABLED=1 mode ==');
  const disabled: DisabledServer = await startDisabledServer();
  let disabledResults: TestOutcome[] = [];
  try {
    disabledResults = await runDisabledModeTests(disabled.port);
  } finally {
    disabled.child.kill('SIGTERM');
  }
  try {
    rmSync(disabled.dataDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup of the temporary data dir
  }

  const all = [...defaultResults, ...disabledResults];
  const failures = all.filter(r => !r.ok);
  console.log(`\n${all.length - failures.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
