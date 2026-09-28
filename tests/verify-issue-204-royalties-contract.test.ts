import assert from 'node:assert/strict';
import { withTestServer } from './support/test-server.ts';

await withTestServer(async server => {
  const guest = await server.request('GET', '/api/v2/companies/1/royalties/');
  assert.equal(guest.status, 401, 'royalties are private to the owning company');

  const owner = await server.registerCompany('royalties-owner');
  const other = await server.registerCompany('royalties-other');

  const ownRoyalties = await server.request<{ error: string; code: string }>(
    'GET', `/api/v2/companies/${owner.companyId}/royalties/`, { cookie: owner.cookie }
  );
  assert.equal(ownRoyalties.status, 501);
  assert.equal(ownRoyalties.json.code, 'SOURCE_CONTRACT_BLOCKED');
  assert.match(ownRoyalties.json.error, /authoritative rate and tenure contract is unavailable/i);

  const foreignRoyalties = await server.request(
    'GET', `/api/v2/companies/${owner.companyId}/royalties/`, { cookie: other.cookie }
  );
  assert.equal(foreignRoyalties.status, 401, 'company cannot inspect another company’s royalties');

  const otherOwnRoyalties = await server.request(
    'GET', `/api/v2/companies/${other.companyId}/royalties/`, { cookie: other.cookie }
  );
  assert.equal(otherOwnRoyalties.status, 501);

  const malformedId = await server.request('GET', '/api/v2/companies/me/royalties/', { cookie: owner.cookie });
  assert.equal(malformedId.status, 404, 'the company-ID contract accepts numeric IDs only');
});

console.log('PASS royalty endpoint refuses guessed amounts and enforces company ownership (#204)');
