import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function runIssue25ApiCorrectnessTest() {
  console.log('================================================================');
  console.log(' Starting Issue #25 API Correctness & Error Schema Verification');
  console.log('================================================================');

  console.log('[1/3] Testing unknown API routes return 404 JSON, never fake 200 []...');
  const unknownRoutes = [
    '/api/v2/non-existent-feature/',
    '/api/v3/unknown-resource-xyz/',
    '/api/v99/fake-endpoint/'
  ];
  for (const route of unknownRoutes) {
    const res = await fetch(`${baseUrl}${route}`);
    assert.equal(res.status, 404, `Unknown route ${route} must return 404`);
    const data = (await res.json()) as { code: string; error: string };
    assert.equal(data.code, 'API_NOT_FOUND', 'Response must carry API_NOT_FOUND code');
    assert.ok(data.error, 'Error message must be defined');
  }
  console.log('  -> All unknown routes correctly returned 404 JSON');

  console.log('[2/3] Testing unsupported HTTP methods return 405 Method Not Allowed...');
  const methodMismatches = [
    { path: '/api/v2/time-millis/', badMethod: 'DELETE', expectedAllow: 'GET' },
    { path: '/api/v3/companies/auth-data/', badMethod: 'DELETE', expectedAllow: 'GET' },
    { path: '/api/v2/constants/resources/', badMethod: 'POST', expectedAllow: 'GET' }
  ];
  for (const item of methodMismatches) {
    const res = await fetch(`${baseUrl}${item.path}`, { method: item.badMethod });
    assert.equal(res.status, 405, `${item.badMethod} ${item.path} must return 405`);
    const allowHeader = res.headers.get('allow');
    assert.ok(allowHeader?.includes(item.expectedAllow), `Allow header must include ${item.expectedAllow}`);
    const data = (await res.json()) as { code: string };
    assert.equal(data.code, 'METHOD_NOT_ALLOWED');
  }
  console.log('  -> Method mismatches correctly returned 405 with Allow headers');

  console.log('[3/3] Testing valid API endpoints return 200 cleanly...');
  const validRes = await fetch(`${baseUrl}/api/v2/constants/resources/`);
  assert.equal(validRes.status, 200);
  const timeRes = await fetch(`${baseUrl}/api/v2/time-millis/`);
  assert.equal(timeRes.status, 200);
  console.log('  -> Valid APIs return 200 as expected');

  console.log('================================================================');
  console.log(' [OK] ISSUE #25 API CORRECTNESS PASSED ALL CHECKS');
  console.log('================================================================');
}

runIssue25ApiCorrectnessTest().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
