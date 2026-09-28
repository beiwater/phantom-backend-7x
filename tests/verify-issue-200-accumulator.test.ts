import assert from 'node:assert/strict';
import { withTestServer, type TestServer } from './support/test-server.ts';

function insertForest(server: TestServer, companyId: number, position: string): number {
  const db = server.db;
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, 'v', 1, 'Forest Nursery', 6900, 'production', ?)
  `).run(companyId, position, now);
  server.setStock(companyId, 2, 1000, 1);
  return Number(result.lastInsertRowid);
}

async function runVerification(): Promise<void> {
  await withTestServer(async server => {
    const BASE_URL = server.baseUrl;
    const database = server.db;
    const first = await server.registerCompany('owner');
    const headers = { 'Content-Type': 'application/json', Cookie: first.cookie };
    const buildingId = insertForest(server, first.companyId, 'acc-1');

    const unauthenticated = await fetch(`${BASE_URL}/api/v1/buildings/${buildingId}/accumulator/collect/`, {
      method: 'POST'
    });
    assert.equal(unauthenticated.status, 401, 'collect requires company authentication');

    const started = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 150, amount: 10 })
    });
    const startedBody = await started.json() as { building?: { busy?: Record<string, unknown>; productionAccumulator?: Record<string, unknown> } };
    assert.equal(started.status, 200, `nurture start must succeed: ${JSON.stringify(startedBody)}`);
    assert.equal(startedBody.building?.busy?.category, 'n');
    assert.equal((startedBody.building?.busy?.accumulator as Record<string, unknown>)?.value, 10);
    assert.equal(startedBody.building?.productionAccumulator?.value, 0);
    const queue = database.prepare(
      'SELECT id, resolved FROM production_queues WHERE building_id = ? ORDER BY id DESC LIMIT 1'
    ).get(buildingId) as { id: number; resolved: number };
    assert.equal(queue.resolved, 0);

    // The original n-category panel has nurturing/cut controls but no ordinary
    // production rush. A crafted rush cannot turn growth into ten Tree units.
    const boostsBeforeRush = Number((database.prepare('SELECT simboosts FROM companies WHERE company_id = ?')
      .get(first.companyId) as { simboosts: number }).simboosts);
    for (const rushPath of [`/api/v1/rush/${buildingId}/`, `/api/v2/companies/buildings/${buildingId}/rush/`]) {
      const rushed = await server.request('POST', rushPath, { cookie: first.cookie });
      assert.equal(rushed.status, 400, rushed.text);
    }
    assert.equal(Number((database.prepare('SELECT simboosts FROM companies WHERE company_id = ?')
      .get(first.companyId) as { simboosts: number }).simboosts), boostsBeforeRush);
    assert.equal(database.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 150')
      .get(first.companyId), undefined);
    assert.equal((database.prepare('SELECT resolved FROM production_queues WHERE id = ?')
      .get(queue.id) as { resolved: number }).resolved, 0);
    assert.equal(Number((database.prepare('SELECT value FROM accumulator_states WHERE building_id = ?')
      .get(buildingId) as { value: number }).value), 0);

    const notFinished = await fetch(`${BASE_URL}/api/v1/buildings/${buildingId}/accumulator/collect/`, {
      method: 'POST',
      headers
    });
    assert.equal(notFinished.status, 400, 'unfinished accumulator growth must be rejected');
    assert.equal((database.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(queue.id) as { resolved: number }).resolved, 0);

    database.prepare('UPDATE production_queues SET finishes_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), queue.id);
    const grown = await server.request<{ busy: unknown; productionAccumulator: { value: number; quality: number } }>(
      'GET', `/api/v2/companies/me/buildings/${buildingId}/`, { cookie: first.cookie });
    assert.equal(grown.status, 200);
    assert.equal(grown.json.busy, null, 'completed nurturing frees the building');
    assert.equal(grown.json.productionAccumulator.value, 10);
    assert.equal(grown.json.productionAccumulator.quality, 0);
    assert.equal(database.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 150')
      .get(first.companyId), undefined, 'growth alone must not issue trees');
    const xpBefore = Number((database.prepare('SELECT experience FROM companies WHERE company_id = ?')
      .get(first.companyId) as { experience: number }).experience);
    await server.request('GET', `/api/v2/companies/me/buildings/${buildingId}/`, { cookie: first.cookie });
    assert.equal(Number((database.prepare('SELECT value FROM accumulator_states WHERE building_id = ?')
      .get(buildingId) as { value: number }).value), 10, 'refresh must not apply growth twice');
    database.exec(`CREATE TRIGGER fail_tree BEFORE INSERT ON warehouse WHEN NEW.kind = 150
      BEGIN SELECT RAISE(ABORT, 'test harvest rollback'); END`);
    const failedHarvest = await server.request('POST', `/api/v1/buildings/${buildingId}/accumulator/collect/`, { cookie: first.cookie });
    assert.equal(failedHarvest.status, 400, failedHarvest.text);
    assert.match(failedHarvest.text, /test harvest rollback/);
    assert.equal(Number((database.prepare('SELECT value FROM accumulator_states WHERE building_id = ?')
      .get(buildingId) as { value: number }).value), 10, 'failed inventory credit restores all growth');
    assert.equal(Number((database.prepare('SELECT experience FROM companies WHERE company_id = ?')
      .get(first.companyId) as { experience: number }).experience), xpBefore);
    database.exec('DROP TRIGGER fail_tree');
    const collected = await fetch(`${BASE_URL}/api/v1/buildings/${buildingId}/accumulator/collect/`, {
      method: 'POST',
      headers
    });
    const collectedBody = await collected.json() as {
      resource?: { kind: number; quality: number; amount: number };
      building?: { productionAccumulator?: { value: number; quality: number | null } };
    };
    assert.equal(collected.status, 200, `finished collect must succeed: ${JSON.stringify(collectedBody)}`);
    assert.deepEqual(collectedBody.resource, { kind: 150, quality: 0, amount: 1 });
    assert.equal(collectedBody.building?.productionAccumulator?.value, 0);
    assert.equal(collectedBody.building?.productionAccumulator?.quality, null);
    assert.equal(
      Number((database.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 150 AND quality = 0').get(first.companyId) as { amount: number }).amount),
      1
    );
    assert.equal((database.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(queue.id) as { resolved: number }).resolved, 1);

    const repeated = await fetch(`${BASE_URL}/api/v1/buildings/${buildingId}/accumulator/collect/`, {
      method: 'POST',
      headers
    });
    assert.equal(repeated.status, 409, 'repeated collect must be rejected idempotently');
    assert.equal(
      Number((database.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 150 AND quality = 0').get(first.companyId) as { amount: number }).amount),
      1,
      'repeated collect must not mint another tree'
    );
    database.prepare('UPDATE accumulator_states SET value = 23, cost_total = 230 WHERE building_id = ?').run(buildingId);
    const higherQuality = await server.request<{ resource: unknown; building: { productionAccumulator: { value: number } } }>(
      'POST', `/api/v1/buildings/${buildingId}/accumulator/collect/`, { cookie: first.cookie });
    assert.equal(higherQuality.status, 200);
    assert.deepEqual(higherQuality.json.resource, { kind: 150, quality: 1, amount: 1 });
    assert.equal(higherQuality.json.building.productionAccumulator.value, 0, 'cut-down starts the next tree from zero');
    assert.equal(Number((database.prepare('SELECT cost_market FROM warehouse WHERE company_id = ? AND kind = 150 AND quality = 1')
      .get(first.companyId) as { cost_market: number }).cost_market), 230, 'all source cost belongs to the cut tree');
    database.prepare('UPDATE accumulator_states SET value = 5, cost_total = 50 WHERE building_id = ?').run(buildingId);
    const xpBeforeEarlyCut = Number((database.prepare('SELECT experience FROM companies WHERE company_id = ?')
      .get(first.companyId) as { experience: number }).experience);
    const earlyCut = await server.request<{ resource: unknown; building: { productionAccumulator: { value: number } } }>(
      'POST', `/api/v1/buildings/${buildingId}/accumulator/collect/`, { cookie: first.cookie });
    assert.equal(earlyCut.status, 200);
    assert.deepEqual(earlyCut.json.resource, { kind: 150, quality: 0, amount: 0 });
    assert.equal(earlyCut.json.building.productionAccumulator.value, 0, 'cutting below Q0 loses current progress');
    assert.equal((await server.request('POST', `/api/v1/buildings/${buildingId}/accumulator/collect/`, { cookie: first.cookie })).status, 409);
    assert.equal(Number((database.prepare('SELECT experience FROM companies WHERE company_id = ?')
      .get(first.companyId) as { experience: number }).experience), xpBeforeEarlyCut, 'empty cuts cannot mint experience');
    database.prepare('UPDATE buildings SET size = 2 WHERE id = ?').run(buildingId);
    const stockBeforeL2 = Number((database.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 2')
      .get(first.companyId) as { amount: number }).amount);
    const levelTwoStart = await server.request('POST', `/api/v1/busy/${buildingId}/`, {
      cookie: first.cookie, body: { kind: 150, amount: 10 }
    });
    assert.equal(levelTwoStart.status, 200, levelTwoStart.text);
    assert.equal(Number((database.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 2')
      .get(first.companyId) as { amount: number }).amount), stockBeforeL2 - 240, 'L2 grows two trees and needs 2x the water');
    database.prepare('UPDATE production_queues SET finishes_at = ? WHERE building_id = ? AND resolved = 0')
      .run(new Date(Date.now() - 1000).toISOString(), buildingId);
    const levelTwoCut = await server.request<{ resource: unknown }>('POST', `/api/v1/buildings/${buildingId}/accumulator/collect/`, { cookie: first.cookie });
    assert.equal(levelTwoCut.status, 200);
    assert.deepEqual(levelTwoCut.json.resource, { kind: 150, quality: 0, amount: 2 });

    const second = await server.registerCompany('other');
    const foreignBuildingId = insertForest(server, second.companyId, 'acc-2');
    const forbidden = await fetch(`${BASE_URL}/api/v1/buildings/${foreignBuildingId}/accumulator/collect/`, {
      method: 'POST',
      headers
    });
    assert.equal(forbidden.status, 403, 'cross-company collect must be forbidden');

    database.prepare('UPDATE accumulator_states SET value = 81910 WHERE building_id = ?').run(buildingId);
    const overflow = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 150, amount: 1 })
    });
    assert.equal(overflow.status, 400, 'maximum accumulator value must be enforced');
    assert.equal(
      Number((database.prepare('SELECT value FROM accumulator_states WHERE building_id = ?').get(buildingId) as { value: number }).value),
      81910
    );

    console.log('PASS accumulator collect contract, ownership, completion, max bound, and idempotency (#200)');
  }, { env: { SPEED_MULTIPLIER: '100' } });
}

runVerification().catch(error => {
  console.error('Accumulator verification failed:', error);
  process.exit(1);
});
