/**
 * Regression tests for adversarial-audit findings C-5, C-8, C-13, C-14,
 * C-19, C-20 (GameLogicFix area).
 *
 * Run against a live private server:
 *   PORT=3403 SPEED_MULTIPLIER=200 DATA_DIR=data/test-run-3403 \
 *     node --experimental-strip-types server/index.ts
 *   BASE_URL=http://127.0.0.1:3403 \
 *     node --experimental-strip-types tests/verify-attack-fix-gamelogic.test.ts
 *
 * Covered contracts:
 * - C-5:  purchase paths grant boosts freely (local-server semantics, P0-03)
 *         but are capped at DAILY_PURCHASE_LIMIT per company per UTC day;
 *         the 21st purchase is rejected and mutates nothing.
 * - C-8:  DELETE building with an active (unresolved) production queue item
 *         is rejected with 409 and leaves the queue + building intact.
 * - C-13: POST /api/v1/buildings/:id/busy/ while busyUntil is in the future
 *         is rejected with 409 (official busy contract) instead of chaining.
 * - C-14: limitQuality outside integer 0..12 is rejected with 400.
 * - C-19: fractional / negative / non-integer amounts are rejected with 400.
 * - C-20: building rename rejects empty and >64-char names (400), accepts
 *         exactly 64 chars and persists them.
 */
import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3403'}`;

interface AuthCompany {
  companyId: number;
  money: number;
  simBoosts: number;
}

let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err: unknown) {
    failures.push(name);
    console.error(`  FAIL ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

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
    // empty body is fine for some statuses
  }
  return { status: response.status, json };
}

async function fetchWithRateRetry(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  let retries = 0;
  while (response.status === 429 && retries < 70) {
    const retryAfter = Number(response.headers.get('Retry-After') || '2');
    await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 5) * 1000));
    response = await fetch(url, init);
    retries++;
  }
  return response;
}

async function register(label: string): Promise<{ cookie: string; companyId: number }> {
  const email = `glfix_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@domain.local`;
  const response = await fetchWithRateRetry(`${baseUrl}/api/v2/auth/email/connect/`, {
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

async function authCompany(cookie: string): Promise<AuthCompany> {
  const r = await api(cookie, 'GET', '/api/v3/companies/auth-data/');
  assert.equal(r.status, 200);
  return (r.json as { authCompany: AuthCompany }).authCompany;
}

async function firstProductionBuilding(cookie: string): Promise<{ id: number; name: string }> {
  const r = await api(cookie, 'GET', '/api/v2/companies/me/buildings/');
  assert.equal(r.status, 200);
  const buildings = r.json as Array<{ id: number; name: string; category: string }>;
  const building = buildings.find(b => b.category === 'production');
  assert.ok(building, 'seeded production building missing');
  return { id: building.id, name: building.name };
}

async function main(): Promise<void> {
  await test('C-13: start-production rejected with 409 while busy', async () => {
    const { cookie } = await register('c13');
    const building = await firstProductionBuilding(cookie);

    const first = await api(cookie, 'POST', `/api/v1/buildings/${building.id}/busy/`, {
      kind: 66,
      amount: 100
    });
    assert.equal(first.status, 200, 'first production start must succeed');

    const second = await api(cookie, 'POST', `/api/v1/buildings/${building.id}/busy/`, {
      kind: 66,
      amount: 100
    });
    assert.equal(second.status, 409, `expected 409 while busy, got ${second.status}: ${JSON.stringify(second.json)}`);

    // The 409 must not have chained a second queue item.
    const queue = await api(cookie, 'GET', `/api/v2/companies/buildings/${building.id}/queue/`);
    assert.equal(queue.status, 200);
    const queueItems = Array.isArray(queue.json) ? queue.json : [];
    assert.equal(queueItems.length, 1, 'no second queue item may be chained');
  });

  await test('C-14: limitQuality must be an integer 0..12', async () => {
    const { cookie } = await register('c14');
    const building = await firstProductionBuilding(cookie);

    for (const limitQuality of [-1, 13, 6.5]) {
      const r = await api(cookie, 'POST', `/api/v1/buildings/${building.id}/busy/`, {
        kind: 66,
        amount: 100,
        limitQuality
      });
      assert.equal(r.status, 400, `limitQuality=${limitQuality} must be rejected with 400, got ${r.status}`);
      assert.match(errorText(r.json), /quality/i);
    }

    // Boundary value 12 passes validation (the request may still 409 if the
    // first accepted start made the building busy — only 400 is ruled out).
    const ok = await api(cookie, 'POST', `/api/v1/buildings/${building.id}/busy/`, {
      kind: 66,
      amount: 50,
      limitQuality: 12
    });
    assert.notEqual(ok.status, 400, 'limitQuality=12 must pass validation');
  });

  await test('C-19: amount must be a positive integer', async () => {
    const { cookie } = await register('c19');
    const building = await firstProductionBuilding(cookie);

    for (const amount of [0.5, -5, 0, 1.25]) {
      const r = await api(cookie, 'POST', `/api/v1/buildings/${building.id}/busy/`, {
        kind: 66,
        amount
      });
      assert.equal(r.status, 400, `amount=${amount} must be rejected with 400, got ${r.status}`);
      assert.match(errorText(r.json), /amount/i);
    }
  });

  await test('C-8: demolish rejected with 409 while production active', async () => {
    const { cookie } = await register('c8');
    const building = await firstProductionBuilding(cookie);

    const start = await api(cookie, 'POST', `/api/v1/buildings/${building.id}/busy/`, {
      kind: 66,
      amount: 100
    });
    assert.equal(start.status, 200);

    const demolish = await api(cookie, 'DELETE', `/api/v2/companies/me/buildings/${building.id}/`);
    assert.equal(demolish.status, 409, `expected 409 demolish while producing, got ${demolish.status}`);

    // Building and queue must both survive the rejected demolish.
    const details = await api(cookie, 'GET', `/api/v2/companies/me/buildings/${building.id}/`);
    assert.equal(details.status, 200, 'building must survive rejected demolish');
    const queue = await api(cookie, 'GET', `/api/v2/companies/buildings/${building.id}/queue/`);
    const queueItems = Array.isArray(queue.json) ? queue.json : [];
    assert.equal(queueItems.length, 1, 'queue item must not be orphaned or deleted');

    // After cancelling production the demolish succeeds.
    const cancel = await api(cookie, 'DELETE', `/api/v1/buildings/${building.id}/busy/`);
    assert.equal(cancel.status, 200);
    const demolish2 = await api(cookie, 'DELETE', `/api/v2/companies/me/buildings/${building.id}/`);
    assert.equal(demolish2.status, 200, 'demolish after cancelling production must succeed');
  });

  await test('C-20: building name must be 1..64 chars', async () => {
    const { cookie } = await register('c20');
    const building = await firstProductionBuilding(cookie);

    // Empty / whitespace-only
    for (const name of ['', '   ']) {
      const r = await api(cookie, 'PATCH', `/api/v2/companies/me/buildings/${building.id}/`, { name });
      assert.equal(r.status, 400, `empty name must be rejected with 400, got ${r.status}`);
    }

    // 10000 chars (the original C-20 exploit)
    const r10000 = await api(cookie, 'PATCH', `/api/v2/companies/me/buildings/${building.id}/`, {
      name: 'x'.repeat(10000)
    });
    assert.equal(r10000.status, 400, '10000-char name must be rejected with 400');

    // 65 chars rejected, 64 accepted and persisted
    const r65 = await api(cookie, 'PATCH', `/api/v2/companies/me/buildings/${building.id}/`, {
      name: 'n'.repeat(65)
    });
    assert.equal(r65.status, 400, '65-char name must be rejected with 400');

    const name64 = 'n'.repeat(64);
    const r64 = await api(cookie, 'PATCH', `/api/v2/companies/me/buildings/${building.id}/`, {
      name: name64
    });
    assert.equal(r64.status, 200, '64-char name must be accepted');
    const r64Json = r64.json as { name?: string } | null;
    assert.equal(r64Json?.name, name64, '64-char name must be persisted verbatim');
  });

  await test('C-5: purchase paths capped per company per UTC day', async () => {
    const { cookie } = await register('c5');

    // Every distinct purchasable SKU in the catalog (the supporter package
    // grants 0 boosts but still counts as a purchase against the cap).
    const catalog: Array<{ sku: string; simBoosts: number }> = [
      { sku: 'sb-sb150', simBoosts: 150 },
      { sku: 'sb-sb330', simBoosts: 330 },
      { sku: 'sp2', simBoosts: 250 },
      { sku: 'sb-sb850', simBoosts: 850 },
      { sku: 'sb-sb1900', simBoosts: 1900 },
      { sku: 'sb-s-sp2', simBoosts: 250 },
      { sku: 'sb-s-sb150', simBoosts: 150 },
      { sku: 'sb-s-sb330', simBoosts: 330 },
      { sku: 'sb-s-sb850', simBoosts: 850 },
      { sku: 'sb-s-sb1900', simBoosts: 1900 },
      { sku: 'sb-sb3800', simBoosts: 3800 },
      { sku: 'sb-s-sb3800', simBoosts: 3800 },
      { sku: 'sb-sb6300', simBoosts: 6300 },
      { sku: 'sb-s-sb6300', simBoosts: 6300 },
      { sku: 'supporter', simBoosts: 0 }
    ];

    // The server's per-(company,sku) double-click idempotency window is 5s of
    // wall clock inside the server process, unreachable from this test
    // process, so no deterministic fake timer can bypass it. Round 1 mints
    // 15 fresh grants (one per SKU, each outside the others' windows); one
    // pause outlives the window; round 2 mints fresh grants again until the
    // daily cap rejects at the 21st mint (6th call of round 2).
    const purchase = (sku: string) => api(cookie, 'POST', '/api/v2/payment-stripe/', { sku });

    let grants = 0;
    let mintedBoosts = 0;
    let rejectedStatus = 0;
    let rejectedJson: ApiResult['json'] = null;
    for (const { sku, simBoosts } of catalog) {
      const r = await purchase(sku);
      assert.equal(r.status, 200, `first purchase of ${sku} must succeed: ${JSON.stringify(r.json)}`);
      grants++;
      mintedBoosts += simBoosts;
    }
    assert.equal(grants, 15);

    await new Promise<void>(resolve => setTimeout(resolve, 5200)); // > PURCHASE_IDEMPOTENCY_WINDOW_MS

    for (const { sku, simBoosts } of catalog) {
      const r = await purchase(sku);
      if (r.status !== 200) {
        rejectedStatus = r.status;
        rejectedJson = r.json;
        break;
      }
      grants++;
      mintedBoosts += simBoosts;
    }
    assert.ok(grants >= 20, `expected at least 20 granted purchases before rejection, got ${grants}`);
    assert.equal(grants, 20, 'the cap must allow exactly 20 purchases');
    assert.equal(rejectedStatus, 400, `purchase beyond the cap must be rejected with 400, got ${rejectedStatus}`);
    assert.match(errorText(rejectedJson), /daily purchase limit/i);

    // The rejection must not mint boosts: balance reflects exactly the
    // capped grants (250 seed + minted boosts; idempotency replays mint
    // nothing).
    const auth = await authCompany(cookie);
    assert.equal(
      auth.simBoosts,
      250 + mintedBoosts,
      `boost balance must reflect exactly the ${grants} capped grants`
    );

    // Outlive the idempotency window so the cross-route cap checks below are
    // fresh purchase attempts rather than cached replays.
    await new Promise<void>(resolve => setTimeout(resolve, 5200));

    // Every purchase route shares the same cap: further purchases on all
    // payment endpoints stay rejected while the counter is at the limit.
    for (const [method, path, body] of [
      ['POST', '/api/v2/payment/', { sku: 'sb-sb150' }],
      ['POST', '/api/v2/payment-stripe/', { sku: 'sb-sb150' }],
      ['POST', '/api/v2/google/purchase/', { sku: 'sb-sb150' }]
    ] as const) {
      const r = await api(cookie, method, path, body);
      assert.equal(r.status, 400, `${method} ${path} must honor the daily cap, got ${r.status}: ${errorText(r.json)}`);
    }
  });

  await test('C-5: purchase counter is per company across all purchase routes', async () => {
    const { cookie } = await register('c5b');
    const r1 = await api(cookie, 'POST', '/api/v2/payment/', { sku: 'sb-sb150' });
    assert.equal(r1.status, 200);
    const r1Json = r1.json as { purchasesToday?: number };
    assert.equal(r1Json.purchasesToday, 1);
    const r2 = await api(cookie, 'POST', '/api/v2/google/purchase/', { sku: 'sb-sb330' });
    assert.equal(r2.status, 200);
    const r2Json = r2.json as { purchasesToday?: number };
    assert.equal(r2Json.purchasesToday, 2, 'counter is per company across all purchase routes');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('Failed:', failures.join(', '));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
