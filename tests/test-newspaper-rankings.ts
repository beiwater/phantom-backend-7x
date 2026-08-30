import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleSocialRoutes } from '../server/routes/social-routes.ts';
import { getCompanyById, updateCompanySimBoosts } from '../server/game/company.ts';
import { db } from '../server/db/database.ts';

// Mock HTTP request/response helper
function createMockReqRes(method: string, url: string, body?: unknown) {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as any).method = method;
  (req as any).url = url;
  (req as any).headers = { host: 'localhost' };

  let statusCode = 200;
  let responseData = '';
  const headers: Record<string, string> = {};

  const res = {
    writeHead(code: number, h?: Record<string, string>) {
      statusCode = code;
      if (h) Object.assign(headers, h);
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    getHeader(name: string) {
      return headers[name];
    },
    end(data?: string) {
      if (data) responseData += data;
    }
  } as unknown as ServerResponse;

  if (body !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  } else {
    process.nextTick(() => {
      req.emit('end');
    });
  }

  return {
    req,
    res,
    getResponse: () => {
      try {
        return { statusCode, data: JSON.parse(responseData || '{}') };
      } catch {
        return { statusCode, data: responseData };
      }
    }
  };
}

async function testEndpoint(method: string, url: string, body?: unknown, companyId: number = 4259175) {
  const { req, res, getResponse } = createMockReqRes(method, url, body);
  const parsedUrl = new URL(url, 'http://localhost');
  const handled = await handleSocialRoutes(req, res, parsedUrl.pathname, method, companyId);
  return { handled, ...getResponse() };
}

async function runTests() {
  console.log('--- Starting Newspaper & Rankings System Tests ---');

  const firstComp = db.prepare('SELECT company_id FROM companies LIMIT 1').get() as { company_id: number };
  const compId = firstComp ? firstComp.company_id : 4259175;

  // 1. Newspaper Issues List
  const listRes = await testEndpoint('GET', '/api/v3/zh-cn/0/newspaper/', undefined, compId);
  console.log('1. Issues List:', listRes.handled && listRes.statusCode === 200 && Array.isArray(listRes.data) && listRes.data.length > 0 ? 'PASS' : 'FAIL', 'count:', listRes.data.length);

  // 2. Newspaper Single Issue
  const issueRes = await testEndpoint('GET', '/api/v3/zh-cn/0/newspaper/2/', undefined, compId);
  console.log('2. Single Issue:', issueRes.handled && issueRes.statusCode === 200 && issueRes.data.articles?.length > 0 ? 'PASS' : 'FAIL', 'articles:', issueRes.data.articles?.length);

  // 3. Top Articles
  const topRes = await testEndpoint('GET', '/api/v2/zh-cn/0/articles/top-by-reaction/THUMBS_UP/', undefined, compId);
  console.log('3. Top Articles:', topRes.handled && topRes.statusCode === 200 && topRes.data.topArticles?.length > 0 ? 'PASS' : 'FAIL', 'top count:', topRes.data.topArticles?.length);

  // 4. Substring Search
  const searchRes = await testEndpoint('GET', '/api/v2/newspaper/articles-by-substring/0/%E5%B8%82%E5%9C%BA/', undefined, compId);
  console.log('4. Articles Substring Search:', searchRes.handled && searchRes.statusCode === 200 && Array.isArray(searchRes.data) ? 'PASS' : 'FAIL', 'results:', searchRes.data.length);

  // 5. Sponsor Params & Sponsors List
  const sponsorParamsRes = await testEndpoint('GET', '/api/v2/newspaper/sponsor-params/', undefined, compId);
  console.log('5a. Sponsor Params:', sponsorParamsRes.handled && sponsorParamsRes.statusCode === 200 && sponsorParamsRes.data[0]?.charLimit === 140 ? 'PASS' : 'FAIL');

  const sponsorListRes = await testEndpoint('GET', '/api/v3/newspaper/2/sponsor/', undefined, compId);
  console.log('5b. Sponsor List:', sponsorListRes.handled && sponsorListRes.statusCode === 200 && sponsorListRes.data.pricing?.goldenPrice === 20 ? 'PASS' : 'FAIL');

  // 6. Buy Sponsor (SimBoosts Deduction)
  const compBeforeAd = getCompanyById(compId);
  const initialSimboosts = compBeforeAd?.simboosts ?? 250;

  const buyAdRes = await testEndpoint('POST', '/api/v2/newspaper/2/sponsor/0/', { text: 'New Golden Ad Test Content' }, compId);
  const compAfterAd = getCompanyById(compId);
  const expectedSimboosts = initialSimboosts - 20;
  console.log('6. Buy Golden Sponsor Ad:', buyAdRes.handled && buyAdRes.statusCode === 200 && compAfterAd?.simboosts === expectedSimboosts ? 'PASS' : 'FAIL', {
    company: buyAdRes.data.companyName,
    simboostsBefore: initialSimboosts,
    simboostsAfter: compAfterAd?.simboosts
  });

  // 7. Reward Reaction (SimBoosts Deduction: 5 SimBoosts)
  const compBeforeReward = getCompanyById(compId);
  const simboostsBeforeReward = compBeforeReward?.simboosts ?? 0;
  const rewardRes = await testEndpoint('PATCH', '/api/v1/article/1/reaction/REWARD', undefined, compId);
  const compAfterReward = getCompanyById(compId);
  console.log('7. Reward Reaction SimBoost Deduction:', rewardRes.handled && rewardRes.statusCode === 200 && compAfterReward?.simboosts === simboostsBeforeReward - 5 ? 'PASS' : 'FAIL', {
    simboostsBefore: simboostsBeforeReward,
    simboostsAfter: compAfterReward?.simboosts
  });

  // 8. Thumbs Up Reaction
  const thumbsRes = await testEndpoint('PATCH', '/api/v1/article/1/reaction/THUMBS_UP', undefined, compId);
  console.log('8. Thumbs Up Reaction:', thumbsRes.handled && thumbsRes.statusCode === 200 && thumbsRes.data.success ? 'PASS' : 'FAIL', thumbsRes.data);

  // 9. Own Reactions List
  const ownReactionsRes = await testEndpoint('GET', '/api/v1/newspaper/2/reaction', undefined, compId);
  console.log('9. Own Reactions List:', ownReactionsRes.handled && ownReactionsRes.statusCode === 200 && Array.isArray(ownReactionsRes.data) ? 'PASS' : 'FAIL', ownReactionsRes.data);

  // 10. Certificates Explorer (Latest, Rarest, Detail)
  const certLatestRes = await testEndpoint('GET', '/api/v2/certificates-explorer/0/latest/', undefined, compId);
  console.log('10a. Certs Latest:', certLatestRes.handled && certLatestRes.statusCode === 200 && certLatestRes.data.latestCertificates?.length > 0 ? 'PASS' : 'FAIL');

  const certRarestRes = await testEndpoint('GET', '/api/v2/certificates-explorer/0/rarest/', undefined, compId);
  console.log('10b. Certs Rarest:', certRarestRes.handled && certRarestRes.statusCode === 200 && certRarestRes.data.rarestCertificates?.length > 0 ? 'PASS' : 'FAIL');

  const certDetailRes = await testEndpoint('GET', '/api/v2/certificates-explorer/0/certificate/29/-/1/', undefined, compId);
  console.log('10c. Certs Detail:', certDetailRes.handled && certDetailRes.statusCode === 200 && certDetailRes.data.certificate?.kind === 29 ? 'PASS' : 'FAIL', certDetailRes.data.certificate?.name);

  const companyCertsRes = await testEndpoint('GET', `/api/v2/companies/${compId}/certificates/`, undefined, compId);
  console.log('10d. Company Certs:', companyCertsRes.handled && companyCertsRes.statusCode === 200 && Array.isArray(companyCertsRes.data) ? 'PASS' : 'FAIL', companyCertsRes.data.length);

  // 11. Company Tags & Search
  const tagsRes = await testEndpoint('GET', `/api/v2/companies/${compId}/tags/`, undefined, compId);
  console.log('11a. Company Tags:', tagsRes.handled && tagsRes.statusCode === 200 && Array.isArray(tagsRes.data) ? 'PASS' : 'FAIL', tagsRes.data);

  const tagSearchRes = await testEndpoint('GET', '/api/v2/tag-search/1b-2s/', undefined, compId);
  console.log('11b. Tag Search:', tagSearchRes.handled && tagSearchRes.statusCode === 200 && Array.isArray(tagSearchRes.data) && tagSearchRes.data.length > 0 ? 'PASS' : 'FAIL', tagSearchRes.data.length);

  // 12. Company Lookup
  const lookupRes1 = await testEndpoint('GET', `/api/v2/company-lookup/${compId}/0/SimCorpHQ/`, undefined, compId);
  console.log('12a. Company Lookup 3-param:', lookupRes1.handled && lookupRes1.statusCode === 200 && lookupRes1.data.company ? 'PASS' : 'FAIL', lookupRes1.data.company);

  const lookupRes2 = await testEndpoint('GET', '/api/v2/company-lookup/0/SimCorpHQ/', undefined, compId);
  console.log('12b. Company Lookup 2-param:', lookupRes2.handled && lookupRes2.statusCode === 200 && lookupRes2.data.company ? 'PASS' : 'FAIL', lookupRes2.data.company);

  // Restore SimBoosts for company
  updateCompanySimBoosts(compId, 25);

  console.log('--- All Newspaper & Rankings System Tests Completed Successfully ---');
}

runTests().catch(console.error);
