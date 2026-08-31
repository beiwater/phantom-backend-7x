import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

async function runIssue29ServerHardeningTest() {
  console.log('================================================================');
  console.log(' Starting Issue #29 Server Hardening & Rate Limiting Verification');
  console.log('================================================================');

  console.log('[1/4] Testing malformed JSON body returns 400 Bad Request...');
  const malformedRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email": "broken_json@domain.local", "password": '
  });
  assert.equal(malformedRes.status, 400, 'Malformed JSON must return 400');
  const malformedData = (await malformedRes.json()) as { error: string };
  assert.ok(malformedData.error, 'Error message must be present');
  console.log('  -> Malformed JSON correctly rejected with 400');

  console.log('[2/4] Testing oversized payload (>1MB) returns 413 Payload Too Large...');
  const hugeString = 'A'.repeat(1024 * 1024 + 100);
  const oversizedRes = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'huge@domain.local', password: 'password123', payload: hugeString })
  });
  assert.equal(oversizedRes.status, 413, 'Oversized payload must return 413');
  console.log('  -> Oversized body correctly rejected with 413');

  console.log('[3/4] Testing burst auth requests triggers 429 Rate Limiting...');
  let got429 = false;
  for (let i = 0; i < 35; i++) {
    const res = await fetch(`${baseUrl}/api/v2/auth/email/auth/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `burst_${i}@domain.local`, password: 'password123' })
    });
    if (res.status === 429) {
      got429 = true;
      const retryAfter = res.headers.get('retry-after');
      assert.ok(retryAfter, '429 response must include Retry-After header');
      const data = (await res.json()) as { code: string };
      assert.equal(data.code, 'RATE_LIMITED');
      console.log(`  -> Rate limit triggered at request #${i + 1} with 429`);
      break;
    }
  }
  assert.ok(got429, 'Burst requests must trigger 429 rate limit');

  console.log('[4/4] Testing normal API endpoint is unaffected...');
  const normalRes = await fetch(`${baseUrl}/api/v2/constants/resources/`);
  assert.equal(normalRes.status, 200, 'Normal GET requests must succeed');
  console.log('  -> Normal endpoints function normally (200)');

  console.log('================================================================');
  console.log(' [OK] ISSUE #29 SERVER HARDENING PASSED ALL CHECKS');
  console.log('================================================================');
}

runIssue29ServerHardeningTest().catch(err => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
