import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { RouteRegistry } from '../server/http/route-registry.ts';
import { readJsonBody } from '../server/routes/utils.ts';

// Mock response for unit testing
function createMockResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body = '';
  let ended = false;

  return {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    writeHead(code: number, extraHeaders: Record<string, string> = {}) {
      statusCode = code;
      for (const [k, v] of Object.entries(extraHeaders)) {
        headers[k.toLowerCase()] = v;
      }
    },
    end(data?: string) {
      if (data) body = data;
      ended = true;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get json() {
      return JSON.parse(body || '{}');
    },
    get headers() {
      return headers;
    }
  };
}

function createMockRequest(method: string, url: string) {
  return {
    method,
    url,
    headers: { host: 'localhost' }
  } as any;
}

async function testRouteRegistry() {
  console.log('--- Testing Declarative Route Registry ---');

  // 1. Test Specificity: Static route should match before Parameter route regardless of registration order
  const registry1 = new RouteRegistry();
  let matchedHandler = '';

  registry1.register({
    method: 'GET',
    pattern: '/api/v2/companies/:id/buildings/',
    handler: async () => { matchedHandler = 'param'; }
  });

  registry1.register({
    method: 'GET',
    pattern: '/api/v2/companies/me/buildings/',
    handler: async () => { matchedHandler = 'static'; }
  });

  const res1 = createMockResponse();
  const req1 = createMockRequest('GET', '/api/v2/companies/me/buildings/');
  await registry1.dispatch(req1, res1 as any, '/api/v2/companies/me/buildings/', 'GET', null);
  assert.strictEqual(matchedHandler, 'static', 'Static route must have higher specificity than param route');

  // 2. Test Order Independence: Register in opposite order and verify same result
  const registry2 = new RouteRegistry();
  matchedHandler = '';

  registry2.register({
    method: 'GET',
    pattern: '/api/v2/companies/me/buildings/',
    handler: async () => { matchedHandler = 'static'; }
  });

  registry2.register({
    method: 'GET',
    pattern: '/api/v2/companies/:id/buildings/',
    handler: async () => { matchedHandler = 'param'; }
  });

  const res2 = createMockResponse();
  const req2 = createMockRequest('GET', '/api/v2/companies/me/buildings/');
  await registry2.dispatch(req2, res2 as any, '/api/v2/companies/me/buildings/', 'GET', null);
  assert.strictEqual(matchedHandler, 'static', 'Order of registration must not change specificity resolution');

  // 3. Test Parameter Extraction
  let extractedId = '';
  let extractedQueue = '';
  const registry3 = new RouteRegistry();
  registry3.register({
    method: 'DELETE',
    pattern: '/api/v2/companies/buildings/:id/queue/:queueId/',
    handler: async (_req, _res, _ctx, params) => {
      extractedId = params.id;
      extractedQueue = params.queueId;
    }
  });

  const res3 = createMockResponse();
  const req3 = createMockRequest('DELETE', '/api/v2/companies/buildings/42/queue/108/');
  await registry3.dispatch(req3, res3 as any, '/api/v2/companies/buildings/42/queue/108/', 'DELETE', null);
  assert.strictEqual(extractedId, '42', 'Must extract :id param');
  assert.strictEqual(extractedQueue, '108', 'Must extract :queueId param');

  // 4. Test Duplicate Route Conflict Detection
  let duplicateConflictCaught = false;
  try {
    const registryConflict = new RouteRegistry();
    registryConflict.register({
      method: 'POST',
      pattern: '/api/v2/order/take/:id/',
      handler: async () => {}
    });
    registryConflict.register({
      method: 'POST',
      pattern: '/api/v2/order/take/:id/',
      handler: async () => {}
    });
  } catch (err: unknown) {
    duplicateConflictCaught = true;
  }
  assert.strictEqual(duplicateConflictCaught, true, 'Registering duplicate route must throw conflict error at startup');

  // 4b. Patterns with an optional trailing slash have one canonical owner.
  let normalizedDuplicateCaught = false;
  try {
    const normalizedRegistry = new RouteRegistry();
    normalizedRegistry.register({ method: 'GET', pattern: '/api/v2/status', handler: async () => {} });
    normalizedRegistry.register({ method: 'GET', pattern: '/api/v2/status/', handler: async () => {} });
  } catch {
    normalizedDuplicateCaught = true;
  }
  assert.strictEqual(normalizedDuplicateCaught, true, 'Trailing-slash aliases must be duplicate routes');

  // 4c. Equal-specificity patterns that overlap fail the startup gate in
  // either order; the deterministic tie-break still has stable ownership.
  const overlapping = [
    '/api/v2/:scope/:realmId/',
    '/api/v2/:tenant/:world/'
  ];
  for (const patterns of [overlapping, [...overlapping].reverse()]) {
    const ambiguousRegistry = new RouteRegistry();
    for (const pattern of patterns) {
      ambiguousRegistry.register({ method: 'GET', pattern, owner: pattern, handler: async () => {} });
    }
    assert.strictEqual(ambiguousRegistry.findAmbiguousOverlaps().length, 1);
    assert.throws(
      () => ambiguousRegistry.assertNoAmbiguousOverlaps(),
      /equal-specificity overlapping route pair/,
      'Equal-specificity overlapping ownership must fail the startup gate'
    );
    assert.strictEqual(ambiguousRegistry.getOwner('/api/v2/companies/123/', 'GET'), [...patterns].sort()[0]);
  }

  // A numeric identifier constraint disambiguates numeric company paths from
  // static resource names while retaining exact parameter extraction.
  const constrainedRegistry = new RouteRegistry();
  constrainedRegistry.register({
    method: 'GET',
    pattern: '/api/v2/companies/:companyId(\\d+)/buildings/',
    owner: 'company-buildings',
    handler: async () => {}
  });
  constrainedRegistry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/',
    owner: 'building-detail',
    handler: async () => {}
  });
  assert.strictEqual(constrainedRegistry.getOwner('/api/v2/companies/123/buildings/', 'GET'), 'company-buildings');
  assert.strictEqual(constrainedRegistry.getOwner('/api/v2/companies/buildings/123/', 'GET'), 'building-detail');

  // 5. Test 405 Method Not Allowed
  const registry4 = new RouteRegistry();
  registry4.register({
    method: 'POST',
    pattern: '/api/v2/order/take/:id/',
    handler: async () => {}
  });

  const res4 = createMockResponse();
  const req4 = createMockRequest('GET', '/api/v2/order/take/123/');
  const handled4 = await registry4.dispatch(req4, res4 as any, '/api/v2/order/take/123/', 'GET', null);
  assert.strictEqual(handled4, true, '405 handler should consume request');
  assert.strictEqual(res4.statusCode, 405, 'Should return 405 status code');
  assert.strictEqual(res4.headers['allow'], 'POST', 'Allow header must include POST');

  // Delegated legacy handlers may still parse request bodies themselves. The
  // registry must cache its parsed body so that both layers observe one value
  // without consuming the request stream twice.
  const bodyRegistry = new RouteRegistry();
  let bodyFromHandler: unknown;
  bodyRegistry.register({
    method: 'POST',
    pattern: '/api/v2/body-check/',
    handler: async (req, _res, _ctx, _params, body) => {
      bodyFromHandler = await readJsonBody(req);
      assert.deepStrictEqual(body, { answer: 42 });
    }
  });
  const bodyReq = new EventEmitter() as any;
  Object.assign(bodyReq, {
    method: 'POST',
    url: '/api/v2/body-check/',
    headers: { 'content-length': '13', 'content-type': 'application/json' }
  });
  const bodyRes = createMockResponse();
  const bodyDispatch = bodyRegistry.dispatch(bodyReq, bodyRes as any, '/api/v2/body-check/', 'POST', null);
  bodyReq.emit('data', Buffer.from('{"answer":42}'));
  bodyReq.emit('end');
  await bodyDispatch;
  assert.deepStrictEqual(bodyFromHandler, { answer: 42 });

  // 6. Test Auth Enforcement
  const registry5 = new RouteRegistry();
  registry5.register({
    method: 'POST',
    pattern: '/api/v2/companies/me/buildings/',
    auth: 'company',
    handler: async () => {}
  });

  const res5 = createMockResponse();
  const req5 = createMockRequest('POST', '/api/v2/companies/me/buildings/');
  const handled5 = await registry5.dispatch(req5, res5 as any, '/api/v2/companies/me/buildings/', 'POST', null);
  assert.strictEqual(handled5, true);
  assert.strictEqual(res5.statusCode, 401, 'Must reject unauthenticated request with 401');

  console.log('✅ Declarative Route Registry tests passed successfully!');
}

testRouteRegistry().catch(err => {
  console.error('❌ Route registry test failed:', err);
  process.exit(1);
});
