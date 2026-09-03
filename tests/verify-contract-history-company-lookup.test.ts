import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/database.ts';
import { handleAuthRoutes } from '../server/routes/auth-routes.ts';
import { globalRouteRegistry } from '../server/http/route-registry.ts';
import { handleContractRoutes } from '../server/routes/contract-routes.ts';
import { handleSocialRoutes } from '../server/routes/social-routes.ts';

type MockResult = {
  handled: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
};

type CompanyRow = {
  company_id: number;
  realm_id: number;
  name: string;
};

function mockRequest(method: string, url: string): IncomingMessage {
  const request = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(request, {
    method,
    url,
    headers: { host: 'localhost' }
  });
  return request;
}

async function invoke(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>,
  method: string,
  url: string
): Promise<MockResult> {
  const request = mockRequest(method, url);
  let statusCode = 200;
  let responseText = '';
  const headers: Record<string, string> = {};
  const response = {
    writeHead(code: number, values?: Record<string, string>) {
      statusCode = code;
      if (values) Object.assign(headers, values);
      return this;
    },
    setHeader(name: string, value: string | number) {
      headers[name] = String(value);
      return this;
    },
    getHeader(name: string) {
      return headers[name];
    },
    end(value?: string) {
      responseText += value ?? '';
    }
  } as unknown as ServerResponse;
  const handled = await handler(request, response);
  let body: unknown = null;
  if (responseText) body = JSON.parse(responseText) as unknown;
  return { handled, statusCode, headers, body };
}

function slugForCompany(name: string): string {
  return name.replace(/[\\/\\s]/g, '-');
}

async function runContractHistoryAndLookupTests(): Promise<void> {
  const companies = db.prepare(
    'SELECT company_id, realm_id, name FROM companies ORDER BY id ASC LIMIT 2'
  ).all() as unknown as CompanyRow[];
  assert.ok(companies.length >= 2, 'fixture requires two persisted companies');
  const owner = companies[0];
  const other = companies[1];
  const insertedIds: number[] = [];

  try {
    const outgoingInsert = db.prepare(`
      INSERT INTO contracts
        (sender_company_id, recipient_company_id, kind, quality, amount, price, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?)
    `).run(owner.company_id, other.company_id, 1, 0, 3, 12, '2026-01-01T00:00:00.000Z');
    insertedIds.push(Number(outgoingInsert.lastInsertRowid));
    const incomingInsert = db.prepare(`
      INSERT INTO contracts
        (sender_company_id, recipient_company_id, kind, quality, amount, price, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'cancelled', ?)
    `).run(other.company_id, owner.company_id, 1, 0, 2, 10, '2026-01-02T00:00:00.000Z');
    insertedIds.push(Number(incomingInsert.lastInsertRowid));

    const lookup = await invoke(
      (request, response) => handleAuthRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        null,
        null,
        null
      ),
      'GET',
      `/api/v2/company-lookup/${owner.company_id}/${owner.realm_id}/${slugForCompany(owner.name)}/`
    );
    assert.equal(lookup.handled, true);
    assert.equal(lookup.statusCode, 200);
    assert.deepEqual(lookup.body, { company: owner.name, realm_id: owner.realm_id });

    const wrongSlug = await invoke(
      (request, response) => handleAuthRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        null,
        null,
        null
      ),
      'GET',
      `/api/v2/company-lookup/${owner.company_id}/${owner.realm_id}/not-the-company/`
    );
    assert.equal(wrongSlug.statusCode, 404);

    const malformedLookup = await invoke(
      (request, response) => handleAuthRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        null,
        null,
        null
      ),
      'GET',
      `/api/v2/company-lookup/not-a-company/${owner.realm_id}/${slugForCompany(owner.name)}/`
    );
    assert.equal(malformedLookup.statusCode, 400);

    const history = await invoke(
      (request, response) => handleContractRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        owner.company_id
      ),
      'GET',
      `/api/v2/contracts-history/${insertedIds[1]}/`
    );
    assert.equal(history.handled, true);
    assert.equal(history.statusCode, 200);
    assert.deepEqual(history.body, {
      id: insertedIds[1],
      kind: 1,
      quality: 0,
      amount: 2,
      quantity: 2,
      price: 10,
      total: 20,
      created: '2026-01-02T00:00:00.000Z',
      status: 'cancelled',
      sender: {
        id: other.company_id,
        company: other.name,
        logo: ''
      },
      recipient: {
        id: owner.company_id,
        company: owner.name,
        logo: ''
      },
      resource: {
        name: 'Resource #1',
        image: 'images/resources/power.png'
      }
    });
    assert.equal(history.headers['x-timestamp'] !== undefined, true);

    const registryHistory = await invoke(
      (request, response) => globalRouteRegistry.dispatch(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        { playerId: 1, companyId: owner.company_id }
      ),
      'GET',
      `/api/v2/contracts-history/${insertedIds[0]}/`
    );
    assert.equal(registryHistory.handled, true);
    assert.equal(registryHistory.statusCode, 200);
    const registryBody = registryHistory.body as { id: number; status: string };
    assert.equal(registryBody.id, insertedIds[0]);
    assert.equal(registryBody.status, 'accepted');

    const unauthenticatedHistory = await invoke(
      (request, response) => handleContractRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        null
      ),
      'GET',
      `/api/v2/contracts-history/${insertedIds[0]}/`
    );
    assert.equal(unauthenticatedHistory.statusCode, 401);

    const foreignHistory = await invoke(
      (request, response) => handleContractRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        999999998
      ),
      'GET',
      `/api/v2/contracts-history/${insertedIds[0]}/`
    );
    assert.equal(foreignHistory.statusCode, 404);

    const missingHistory = await invoke(
      (request, response) => handleContractRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'GET',
        owner.company_id
      ),
      'GET',
      '/api/v2/contracts-history/999999999/'
    );
    assert.equal(missingHistory.statusCode, 404);
    const unsupportedSimboostAction = await invoke(
      (request, response) => handleSocialRoutes(
        request,
        response,
        new URL(request.url || '/', 'http://localhost').pathname,
        'POST',
        owner.company_id
      ),
      'POST',
      '/api/v2/players/simboosts-use/c/'
    );
    assert.equal(unsupportedSimboostAction.statusCode, 404);
  } finally {
    db.prepare('DELETE FROM contracts WHERE id IN (?, ?)').run(...insertedIds);
  }
}

runContractHistoryAndLookupTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
