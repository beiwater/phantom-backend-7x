import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/database.ts';
import { FixtureService } from '../server/services/fixture-service.ts';
import { handleAchievementRoutes } from '../server/routes/achievement-routes.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';

interface CapturedResponse {
  status: number;
  body: unknown;
}

async function invoke(
  pathname: string,
  method: string,
  companyId: number | null,
  body?: Record<string, unknown>
): Promise<CapturedResponse> {
  const request = { headers: {}, method } as unknown as IncomingMessage;
  if (body !== undefined) setPreparsedBody(request, body);

  let status = 0;
  let payload = '';
  const response = {
    setHeader() {},
    getHeader() { return '*'; },
    writeHead(nextStatus: number) { status = nextStatus; },
    end(value?: string) { payload = value || ''; }
  } as unknown as ServerResponse;

  const handled = await handleAchievementRoutes(request, response, pathname, method, companyId);
  assert.equal(handled, true);
  return { status, body: JSON.parse(payload) as unknown };
}

const year = 2047;
const sender = await FixtureService.applyScenario({
  email: 'issue201-gift-sender@test.local',
  companyName: 'Issue 201 Gift Sender',
  money: 100_000,
  simboosts: 250,
  level: 20
});
const recipient = await FixtureService.applyScenario({
  email: 'issue201-gift-recipient@test.local',
  companyName: 'Issue 201 Gift Recipient',
  money: 100_000,
  simboosts: 250,
  level: 20
});

// A rerun must start with no records from an earlier interrupted execution.
db.prepare('DELETE FROM gift_baskets WHERE sender_company_id IN (?, ?) OR recipient_company_id IN (?, ?)')
  .run(sender.companyId, recipient.companyId, sender.companyId, recipient.companyId);

try {
  const outgoingPath = `/api/v2/gift-baskets/${sender.companyId}/outgoing/${year}/`;
  const sent = await invoke(outgoingPath, 'POST', sender.companyId, {
    kind: 'CARD',
    simboosts: 0,
    recipientId: recipient.companyId,
    message: 'Issue 201 deletion test'
  });
  assert.equal(sent.status, 200);
  const sentBody = sent.body as { lastTransactionId: number; money: number };
  assert.ok(sentBody.lastTransactionId > 0);
  assert.equal(sentBody.money, sender.money - 1000);

  const secondSent = await invoke(outgoingPath, 'POST', sender.companyId, {
    kind: 'CARD',
    simboosts: 0,
    recipientId: recipient.companyId,
    message: 'Issue 201 second basket'
  });
  assert.equal(secondSent.status, 200);
  const secondSentBody = secondSent.body as { lastTransactionId: number; money: number };
  assert.ok(secondSentBody.lastTransactionId > sentBody.lastTransactionId);
  assert.equal(secondSentBody.money, sender.money - 2000);

  const listBefore = await invoke(outgoingPath, 'GET', sender.companyId);
  assert.equal(listBefore.status, 200);
  const outgoing = (listBefore.body as { outgoingBaskets: Array<{ id: number }> }).outgoingBaskets;
  assert.equal(outgoing.length, 2);
  const basketId = sentBody.lastTransactionId;
  const otherBasketId = secondSentBody.lastTransactionId;

  const detailPath = `${outgoingPath}${basketId}/`;
  const detailBefore = await invoke(detailPath, 'GET', sender.companyId);
  assert.equal(detailBefore.status, 200);
  assert.equal((detailBefore.body as { id: number }).id, basketId);

  const pathForeign = await invoke(`/api/v2/gift-baskets/${sender.companyId}/outgoing/${year}/${basketId}/`, 'DELETE', recipient.companyId);
  assert.equal(pathForeign.status, 401);
  assert.deepEqual(pathForeign.body, { error: 'Unauthorized' });
  const unknown = await invoke(`/api/v2/gift-baskets/${sender.companyId}/outgoing/${year}/999999999/`, 'DELETE', sender.companyId);
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'Basket not found', code: 'NOT_FOUND' });
  // Ownership and year predicates must reject without touching the row.
  const foreign = await invoke(`/api/v2/gift-baskets/me/outgoing/${year}/${basketId}/`, 'DELETE', recipient.companyId);
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, { error: 'Basket not found', code: 'NOT_FOUND' });
  const wrongYear = await invoke(`/api/v2/gift-baskets/${sender.companyId}/outgoing/${year + 1}/${basketId}/`, 'DELETE', sender.companyId);
  assert.equal(wrongYear.status, 404);
  assert.deepEqual(wrongYear.body, { error: 'Basket not found', code: 'NOT_FOUND' });
  assert.equal(
    Number((db.prepare('SELECT COUNT(*) AS count FROM gift_baskets WHERE id = ?').get(basketId) as { count: number }).count),
    1
  );

  const deleted = await invoke(detailPath, 'DELETE', sender.companyId);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { success: true });
  assert.equal(
    Number((db.prepare('SELECT COUNT(*) AS count FROM gift_baskets WHERE id = ?').get(basketId) as { count: number }).count),
    0
  );
  assert.equal(
    Number((db.prepare('SELECT money FROM companies WHERE company_id = ?').get(sender.companyId) as { money: number }).money),
    sender.money - 2000
  );

  const listAfter = await invoke(outgoingPath, 'GET', sender.companyId);
  assert.equal(listAfter.status, 200);
  const remaining = (listAfter.body as { outgoingBaskets: Array<{ id: number }> }).outgoingBaskets;
  assert.deepEqual(remaining.map(basket => basket.id), [otherBasketId]);
  const detailAfter = await invoke(detailPath, 'GET', sender.companyId);
  assert.equal(detailAfter.status, 404);
  assert.deepEqual(detailAfter.body, { error: 'Basket not found' });

  // Repeating the command is a not-found operation, not a second success.
  const repeated = await invoke(detailPath, 'DELETE', sender.companyId);
  assert.equal(repeated.status, 404);
  assert.deepEqual(repeated.body, { error: 'Basket not found', code: 'NOT_FOUND' });

  const unauthorized = await invoke(detailPath, 'DELETE', null);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(unauthorized.body, { error: 'Unauthorized' });

  console.log('PASS gift-basket outgoing POST → GET → DELETE persistence, ownership, year, repeat, and auth checks (#201)');
} finally {
  db.prepare('DELETE FROM gift_baskets WHERE sender_company_id IN (?, ?) OR recipient_company_id IN (?, ?)')
    .run(sender.companyId, recipient.companyId, sender.companyId, recipient.companyId);
}
