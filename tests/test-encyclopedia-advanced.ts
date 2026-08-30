import { handleEncyclopediaRoutes } from '../server/routes/encyclopedia-routes.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

async function testRoute(pathname: string, method: string = 'GET', bodyData: unknown = null, companyId: number = 1): Promise<MockResponse> {
  return new Promise((resolve) => {
    const req = {
      url: pathname,
      method,
      headers: { host: 'localhost' },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'data' && bodyData) {
          cb(Buffer.from(JSON.stringify(bodyData)));
        }
        if (event === 'end') {
          cb();
        }
      }
    } as unknown as IncomingMessage;

    let statusCode = 200;
    const headers: Record<string, string> = {};
    let rawBody = '';

    const res = {
      writeHead: (code: number, h: Record<string, string>) => {
        statusCode = code;
        Object.assign(headers, h);
      },
      setHeader: (k: string, v: string) => { headers[k] = v; },
      end: (chunk?: unknown) => {
        if (chunk) rawBody += chunk.toString();
        let parsed: unknown = rawBody;
        try {
          parsed = JSON.parse(rawBody);
        } catch {}
        resolve({ statusCode, headers, body: parsed });
      }
    } as unknown as ServerResponse;

    handleEncyclopediaRoutes(req, res, pathname, method, companyId).then(handled => {
      if (!handled) {
        resolve({ statusCode: 404, headers: {}, body: 'Not Handled' });
      }
    });
  });
}

async function run() {
  const tests = [
    { name: 'Encyclopedia Resource Detail', path: '/api/v4/0/0/encyclopedia/resources/3/0/' },
    { name: 'Resource History Time-Series', path: '/api/v2/resources/history/3/' },
    { name: 'Resource Transactions Summary', path: '/api/v2/resources-transactions-summary/0/3/' },
    { name: 'Resource Transactions', path: '/api/v2/resources-transactions/0/3/' },
    { name: 'EVA Rankings', path: '/api/v4/encyclopedia/eva-ranking/0/0/' },
    { name: 'Standard Rankings', path: '/api/v4/encyclopedia/ranking/0/0/' },
    { name: 'Existing Resource Quality', path: '/api/v4/0/0/encyclopedia/existing-resource-quality/' },
    { name: 'Resources Retail Info', path: '/api/v4/0/resources-retail-info/' },
    { name: 'Retail Demand', path: '/api/v2/retail/demand/' },
    { name: 'Restaurant Menu Guide', path: '/api/v1/restaurant-menu/' },
    { name: 'Restaurant Rating', path: '/api/v1/restaurant-rating/' },
    { name: 'Restaurant Properties GET', path: '/api/v2/companies/buildings/1/restaurant-properties/' },
    { name: 'Restaurant Properties PATCH', path: '/api/v2/companies/buildings/1/restaurant-properties/', method: 'PATCH', body: { isLuxury: true, goodService: true } },
    { name: 'Restaurant Runs GET', path: '/api/v2/companies/buildings/1/restaurant-runs/' },
    { name: 'Restaurant Runs POST (Execute Run)', path: '/api/v2/companies/buildings/1/restaurant-runs/', method: 'POST' },
    { name: 'Government Tier', path: '/api/v3/government-orders/tier/' },
    { name: 'Government Orders List', path: '/api/v1/government-orders/' },
    { name: 'Government Realm Orders', path: '/api/v3/government-orders/realm/0/' },
    { name: 'Government Realm Bids', path: '/api/v3/government-orders/realm/0/bids/' },
    { name: 'Aerospace Rocket Launches All', path: '/api/v3/rocket-launches/0/all/' },
    { name: 'Aerospace Launches Summary', path: '/api/v1/aerospace-launches/' },
    { name: 'Aerospace Sales Orders GET', path: '/api/v2/companies/buildings/1/sales-orders/' }
  ];

  let allPassed = true;
  for (const t of tests) {
    const res = await testRoute(t.path, t.method || 'GET', t.body);
    const isOk = res.statusCode >= 200 && res.statusCode < 300 && res.body !== 'Not Handled';
    const hasData = Array.isArray(res.body) ? res.body.length > 0 : (res.body && typeof res.body === 'object' && Object.keys(res.body).length > 0);
    console.log(`[${isOk && hasData ? 'PASS' : 'FAIL'}] ${t.name} -> Status: ${res.statusCode}, Output:`, Array.isArray(res.body) ? `Array(${res.body.length})` : typeof res.body);
    if (!isOk || !hasData) {
      allPassed = false;
      console.error('FAILED RESPONSE:', res.body);
    }
  }

  console.log(`\nOverall Test Result: ${allPassed ? 'ALL PASSED!' : 'SOME FAILED!'}`);
  if (!allPassed) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
