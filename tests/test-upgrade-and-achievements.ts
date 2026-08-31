async function test() {
  const base = 'http://127.0.0.1:3000';

  // Register clean user
  const regRes = await fetch(`${base}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_upg_${Date.now()}@domain.local`,
      password: 'Password123!',
      companyName: 'Upgrade Corporation'
    })
  });
  const cookies = regRes.headers.getSetCookie?.() || [regRes.headers.get('set-cookie') || ''];
  const sessionCookieVal = cookies.find(c => c.startsWith('sessionid='))?.split(';')[0]?.split('=')[1] || '';
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `sessionid=${sessionCookieVal}`
  };

  // 1. Test building upgrade PATCH
  console.log('--- 1. Testing Building Upgrade PATCH ---');
  // Use the seeded level-1 Farm; ordinary construction must not replace an occupied slot.
  const buildRes = await fetch(`${base}/api/v2/companies/me/buildings/`, { headers });
  const existingBuildings = await buildRes.json();
  const existingFarm = existingBuildings.find(building => building.kind === 'P');
  const bId = existingFarm?.id;
  if (!bId) throw new Error('Seeded Farm was not returned');
  console.log('Seeded Farm status:', buildRes.status, 'Building ID:', bId);

  const patchRes = await fetch(`${base}/api/v2/companies/me/buildings/${bId}/`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ size: 2 })
  });
  const patchData = await patchRes.json();
  console.log('Upgrade Building PATCH status:', patchRes.status);
  console.log('Upgrade Building PATCH body:', JSON.stringify(patchData));
  if (patchRes.status !== 200 || !patchData.building || patchData.building.size !== 2) {
    console.error('Upgrade building failed!');
    process.exit(1);
  }
  console.log('Building busy structure:', patchData.building.busy);

  // 2. Test Achievements List
  console.log('\n--- 2. Testing Achievements List ---');
  const achRes = await fetch(`${base}/api/v2/no-cache/companies/me/achievements/`, { headers });
  const achData = await achRes.json();
  console.log('Achievements list status:', achRes.status);
  console.log('Achievements count:', achData.length);
  console.log('First achievement (Market Tycoon):', JSON.stringify(achData[0]));
  if (achRes.status !== 200 || !achData[0] || achData[0].sim_boosts !== 5) {
    console.error('Achievements list invalid!');
    process.exit(1);
  }

  // 3. Test Achievement Claim DELETE
  console.log('\n--- 3. Testing Achievement Claim DELETE ---');
  const claimRes = await fetch(`${base}/api/v2/no-cache/companies/achievements/market-tycoon/`, {
    method: 'DELETE',
    headers
  });
  const claimData = await claimRes.json();
  console.log('Claim achievement DELETE status:', claimRes.status);
  console.log('Claim achievement body:', JSON.stringify(claimData));
  if (claimRes.status !== 200 || !claimData.success || claimData.sim_boosts !== 5) {
    console.error('Claim achievement failed!');
    process.exit(1);
  }

  // 4. Test Achievements Overview
  console.log('\n--- 4. Testing Achievements Overview ---');
  const overRes = await fetch(`${base}/api/v2/companies/me/achievements/`, { headers });
  const overData = await overRes.json();
  console.log('Achievements overview status:', overRes.status);
  console.log('Achievements overview count:', overData.length);
  console.log('First overview item:', JSON.stringify(overData[0]));

  console.log('\n✅ ALL BUILDING UPGRADE AND ACHIEVEMENT TESTS PASSED!');
}

test();
