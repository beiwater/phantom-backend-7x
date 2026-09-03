import assert from 'node:assert';
import {
  methodManifest,
  getCanonicalLegacyOrder,
  setLegacyHandlerOrderForTests,
  resolveLegacyOwnerForTests
} from '../server/router.ts';
import { globalRouteRegistry } from '../server/http/route-registry.ts';

/**
 * Issue #178: endpoint ownership must not depend on handler registration
 * order. Locks the three historical shadowing fixes (#83 newspaper-before-
 * social, #42 bond-before-finance, #95 auction-before-achievement) and
 * enforces the registry/manifest boundary.
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
  return '/' + segments.map(s => (s.startsWith(':') ? '1' : s)).join('/') + '/';
}

async function testRegistryVsLegacyPrecedence(): Promise<void> {
  // Registry dispatch runs BEFORE the legacy chain. A registry-owned path
  // must never be 405-blocked by a manifest entry that excludes its method
  // (the manifest would otherwise become a second method authority).
  const routes = globalRouteRegistry.getRegisteredRoutes();
  assert.ok(routes.length > 0, 'registry must contain registered routes');
  for (const route of routes) {
    const path = samplePathOf(route.pattern);
    for (const entry of methodManifest) {
      if (entry.pattern.test(path)) {
        assert.ok(
          entry.methods.includes(route.method),
          `manifest entry (${entry.owner}) blocks registry route ${route.method} ${route.pattern}`
        );
      }
    }
  }
}

async function testManifestBoundaries(): Promise<void> {
  // Every manifest entry declares an explicit owner (bounded exception list).
  for (const entry of methodManifest) {
    assert.ok(entry.owner.startsWith('legacy:'), `manifest entry must declare a legacy owner: ${JSON.stringify(entry)}`);
    assert.ok(entry.methods.length > 0, 'manifest entry must allow at least one method');
  }
  // Two manifest entries whose patterns can match the same concrete path
  // must agree on at least one shared method (otherwise one 405s a path the
  // other allows).
  for (let i = 0; i < methodManifest.length; i++) {
    for (let j = i + 1; j < methodManifest.length; j++) {
      const a = methodManifest[i];
      const b = methodManifest[j];
      const pathA = samplePathOfRegex(a.pattern);
      const pathB = samplePathOfRegex(b.pattern);
      const crosses = a.pattern.test(pathB) || b.pattern.test(pathA);
      if (crosses) {
        const shared = a.methods.filter(m => b.methods.includes(m));
        assert.ok(shared.length > 0, `manifest entries ${a.owner} and ${b.owner} overlap with disjoint methods`);
      }
    }
  }
}

function samplePathOfRegex(pattern: RegExp): string {
  const source = pattern.source.replace(/^\^/, '').replace(/\$$/, '');
  const segments = source.split('/').filter(Boolean);
  const concrete = segments.map(seg =>
    seg === '[^/]+' || seg.includes('\\d') || seg.startsWith('(?:') || seg === '[^/]+'
      ? '1'
      : seg.replace(/[^a-z0-9_.-]/gi, '')
  ).filter(Boolean);
  return '/' + concrete.join('/') + '/';
}

async function main(): Promise<void> {
  await testHistoricalOwnershipIsStable();
  console.log('PASS historical shadowing ownership stable under order permutation');
  await testRegistryVsLegacyPrecedence();
  console.log('PASS registry routes are not preempted by the manifest');
  await testManifestBoundaries();
  console.log('PASS manifest entries carry explicit legacy owners');
  console.log('Issue #178 route ownership: ALL PASS');
  process.exit(0);
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
