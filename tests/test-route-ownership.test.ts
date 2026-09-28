import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import assert from 'node:assert';
import {
  getCanonicalLegacyOrder,
  setLegacyHandlerOrderForTests,
  resolveLegacyOwnerForTests
} from '../server/router.ts';
import { RouteRegistry, globalRouteRegistry } from '../server/http/route-registry.ts';

/**
 * Issue #178: endpoint ownership must not depend on handler registration
 * order. Locks the three historical shadowing fixes (#83 newspaper-before-
 * social, #42 bond-before-finance, #95 auction-before-achievement).
 */

const HISTORICAL_OWNERSHIP: Array<{ method: string; path: string; owner: string }> = [
  // #83: the legacy social handler's hardcoded stubs must not shadow newspaper
  { method: 'GET', path: '/api/v2/newspaper/sponsor-params/', owner: 'newspaper' },
  { method: 'GET', path: '/api/v2/en/1/articles/top-by-reaction/5/', owner: 'newspaper' },
  { method: 'GET', path: '/api/v2/newspaper/articles-by-author/1/', owner: 'social' },
  // #42: finance's '/bonds/' stub must not shadow real bond endpoints
  { method: 'GET', path: '/api/v2/market/bonds/', owner: 'bonds' },
  { method: 'POST', path: '/api/v2/bonds/1/buy/', owner: 'bonds' },
  // #95: the legacy achievement handler must not shadow building auctions
  { method: 'GET', path: '/api/v2/building-auctions/active-unlocks/', owner: 'building-auctions' },
  { method: 'GET', path: '/api/v3/market/1/65/', owner: 'market' },
  { method: 'GET', path: '/api/v4/executives/', owner: 'executives' },
  { method: 'GET', path: '/api/v2/resources/1/', owner: 'warehouse' }
];

function adjacentSwaps(names: string[]): string[][] {
  const perms: string[][] = [];
  for (let i = 0; i < names.length - 1; i++) {
    const copy = [...names];
    [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
    perms.push(copy);
  }
  return perms;
}

async function testHistoricalOwnershipIsStable(): Promise<void> {
  const canonical = getCanonicalLegacyOrder();
  const baseline = new Map<string, string | null>();
  for (const probe of HISTORICAL_OWNERSHIP) {
    const { owner } = await resolveLegacyOwnerForTests(probe.path, probe.method, canonical);
    assert.strictEqual(owner, probe.owner, `canonical order: ${probe.method} ${probe.path} must be owned by ${probe.owner}, got ${owner}`);
    baseline.set(`${probe.method} ${probe.path}`, owner);
  }

  // Adjacent transpositions are exactly how accidental shadowing creeps in
  // ("move the handler up"). Ownership must be invariant under every swap.
  for (const permuted of adjacentSwaps(canonical)) {
    try {
      for (const probe of HISTORICAL_OWNERSHIP) {
        const { owner } = await resolveLegacyOwnerForTests(probe.path, probe.method, permuted);
        assert.strictEqual(
          owner,
          baseline.get(`${probe.method} ${probe.path}`),
          `permuted order changed ownership of ${probe.method} ${probe.path}: [${permuted.join(',')}]`
        );
      }
    } finally {
      setLegacyHandlerOrderForTests(null);
    }
  }
}

function samplePathOf(pattern: string): string {
  const segments = pattern.split('/').filter(Boolean);
  return '/' + segments.map(segment => {
    if (!segment.startsWith(':')) return segment;
    const match = segment.match(/^:[A-Za-z_][A-Za-z0-9_]*(?:\((.+)\))?$/);
    const constraint = match?.[1];
    if (!constraint) return '1';
    const firstAlternative = constraint.split('|')[0];
    if (firstAlternative === '\\d+' || firstAlternative === '[0-9]+') return '1';
    return firstAlternative.replace(/^\^|\$$/g, '').replace(/\\./g, 'x') || '1';
  }).join('/') + '/';
}

async function testHistoricalRegistryOwnership(): Promise<void> {
  const probes = [
    { method: 'GET', path: '/api/v2/newspaper/sponsor-params/', owner: 'newspaper' },
    { method: 'GET', path: '/api/v2/en/1/articles/top-by-reaction/5/', owner: 'newspaper' },
    { method: 'GET', path: '/api/v2/newspaper/articles-by-author/1/', owner: 'social' },
    { method: 'GET', path: '/api/v2/market/bonds/', owner: 'bonds' },
    { method: 'GET', path: '/api/v2/building-auctions/active-unlocks/', owner: 'building-auctions' },
    { method: 'GET', path: '/api/v2/resources/1/', owner: 'warehouse' },
    { method: 'GET', path: '/api/v2/market-ticker/', owner: 'market' },
    { method: 'GET', path: '/api/v2/constants/core/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v2/time-millis/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v2/weather/0/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/csrf/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v4/0/0/encyclopedia/ranking/0/0/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v4/0/0/encyclopedia/eva-ranking/0/0/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v3/companies/auth-data/', owner: 'auth' },
    { method: 'GET', path: '/api/v1/sales-orders/', owner: 'retail' },
    { method: 'GET', path: '/api/v2/restaurants/', owner: 'restaurant' },
    { method: 'GET', path: '/api/v2/payment-pricing/', owner: 'simboost' },
    { method: 'GET', path: '/api/v2/debug/state/', owner: 'debug' },
    { method: 'GET', path: '/api/v3/pages/zh-cn/economy-model/', owner: 'pages' },
    { method: 'GET', path: '/api/v4/zh-cn/0/stats/top/largest-value/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v4/zh-cn/0/stats/top/contest-winners/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v4/zh-cn/0/stats/top/top-egg-collectors/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v4/0/encyclopedia/resources/3/', owner: 'encyclopedia' },
    { method: 'GET', path: '/api/v2/error-announcement/', owner: 'social' },
    { method: 'POST', path: '/api/v2/error-announcement/', owner: 'social' },
    { method: 'GET', path: '/api/v2/contacts/', owner: 'social' },
    { method: 'PATCH', path: '/api/v2/contacts/1/', owner: 'social' },
    { method: 'DELETE', path: '/api/v2/contacts/1/', owner: 'social' },
    { method: 'GET', path: '/api/v2/help-chatroom/', owner: 'social' },
    { method: 'POST', path: '/api/v2/message/', owner: 'social' },
    { method: 'POST', path: '/api/v2/messages/', owner: 'social' },
    { method: 'GET', path: '/api/messages/', owner: 'social' },
    { method: 'PATCH', path: '/api/messages/', owner: 'social' },
    { method: 'GET', path: '/api/messages_by_company/', owner: 'social' },
    { method: 'GET', path: '/api/courses/', owner: 'social' },
    { method: 'POST', path: '/api/courses/', owner: 'social' },
    { method: 'GET', path: '/api/courses/1/', owner: 'social' },
    { method: 'PATCH', path: '/api/courses/1/', owner: 'social' },
    { method: 'DELETE', path: '/api/courses/1/', owner: 'social' },
    { method: 'POST', path: '/api/courses/1/join/', owner: 'social' },
    { method: 'GET', path: '/api/v1/challenges/current/', owner: 'social' },
    { method: 'POST', path: '/api/v1/challenges/attempt/', owner: 'social' },
    { method: 'POST', path: '/api/v1/challenges/restart/', owner: 'social' },
    { method: 'GET', path: '/api/v1/challenges/1/leaderboard/', owner: 'social' },
    { method: 'GET', path: '/api/v2/players/unlocked-hqs/', owner: 'social' },
    { method: 'POST', path: '/api/v2/players/unlocked-hqs/', owner: 'social' },
    { method: 'GET', path: '/api/v2/players/unlocked-pas/', owner: 'social' },
    { method: 'POST', path: '/api/v2/players/unlocked-pas/', owner: 'social' },
    { method: 'GET', path: '/api/v2/audit/recently-deleted/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit/suspended-companies/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audits/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/moderator-notes/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/players/1/moderator-notes/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/players/1/moderator-notes/2/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/messages-cases/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/messages-cases/1/', owner: 'audit' },
    { method: 'PATCH', path: '/api/v2/messages-cases/1/', owner: 'audit' },
    { method: 'GET', path: '/api/v1/audit-requests/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/admin/purchase-detective/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit/1/personal/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit/1/audits/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit/1/auth/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit/1/payments/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit/1/contracts/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit/1/market-trades/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/companies/1/ban/', owner: 'audit' },
    { method: 'POST', path: '/api/v2/companies/1/ban/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/audit-ip/1/127.0.0.1/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/players/1/personal-data/', owner: 'audit' },
    { method: 'GET', path: '/api/v2/newcomers/', owner: 'audit' },
    { method: 'POST', path: '/api/v2/redeem-code/1/', owner: 'audit' },
    { method: 'GET', path: '/api/time/', owner: 'health' }
  ];
  for (const probe of probes) {
    assert.strictEqual(
      globalRouteRegistry.getOwner(probe.path, probe.method),
      probe.owner,
      `registry owner for ${probe.method} ${probe.path}`
    );
    const req = new EventEmitter() as IncomingMessage;
    Object.assign(req, {
      url: probe.path,
      method: probe.method,
      headers: { 'content-length': '0' },
      resume: () => req
    });
    const response = { code: null as number | null, body: '' };
    const res = {
      setHeader() {},
      writeHead(code: number) { response.code = code; },
      end(body?: unknown) { response.body = body === undefined ? '' : String(body); },
      getHeader() { return undefined; }
    } as unknown as ServerResponse;
    const dispatch = globalRouteRegistry.dispatch(req, res, probe.path, probe.method, null);
    if (['POST', 'PUT', 'PATCH'].includes(probe.method)) {
      req.emit('data', Buffer.from('{}'));
      req.emit('end');
    }
    const handled = await dispatch;
    assert.strictEqual(handled, true, `registry must handle ${probe.method} ${probe.path}`);
    assert.ok(response.code !== null, `registry must send a response for ${probe.path}`);
    if (probe.owner === 'encyclopedia') {
      assert.strictEqual(response.code, 200, `documented encyclopedia URL must not regress to 404: ${probe.path}`);
    }
  }
}

async function testRegistryRegistrationOrderDoesNotChangeOwnership(): Promise<void> {
  const definitions = globalRouteRegistry.getRegisteredRoutes();
  const makeRegistry = (ordered: typeof definitions): RouteRegistry => {
    const registry = new RouteRegistry();
    for (const route of ordered) {
      registry.register({
        method: route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS',
        pattern: route.pattern,
        auth: route.auth as 'none' | 'player' | 'company',
        owner: route.owner,
        handler: async () => {}
      });
    }
    return registry;
  };
  const forward = makeRegistry(definitions);
  const reverse = makeRegistry([...definitions].reverse());
  const probes = new Map<string, { method: string; path: string }>();
  for (const route of definitions) {
    const path = samplePathOf(route.pattern);
    probes.set(`${route.method} ${path}`, { method: route.method, path });
  }

  for (const probe of probes.values()) {
    assert.strictEqual(
      forward.getOwner(probe.path, probe.method),
      reverse.getOwner(probe.path, probe.method),
      `reversing declarative registrations changed ${probe.method} ${probe.path} ownership`
    );
  }
}

async function main(): Promise<void> {
  await testHistoricalOwnershipIsStable();
  console.log('PASS historical shadowing ownership stable under order permutation');
  await testHistoricalRegistryOwnership();
  console.log('PASS declarative registry claims historical shadowing endpoints');
  await testRegistryRegistrationOrderDoesNotChangeOwnership();
  console.log('PASS declarative route ownership is stable when registrations reverse');
  console.log('Issue #178 route ownership: ALL PASS');
  process.exit(0);
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
