/**
 * Issue #170: Launch Pad L1 launch via the original client contract.
 *
 * The original frontend models a rocket launch as a production order of
 * Aerospace Research (kind 100) submitted to the generic busy/queue
 * endpoints — 400 units = Sub-Orbital Rocket (91), 2800 units = BFR (94).
 * It never calls the auxiliary /api/v1/launch-pad/ endpoints.
 *
 * Verifies:
 *  1. POST /api/v1/busy/:id/ {kind:100, amount:400} on a level-1 pad is
 *     accepted (no QUEUE_DURATION_LIMIT rejection) and consumes 1 rocket
 *     + 400 research.
 *  2. The launch appears in the building queue GET as a kind-100 item.
 *  3. Cancelling a pending launch refunds rocket + research.
 *  4. Collecting a finished launch (POST /api/v2/order/take/:buildingId/)
 *     resolves it exactly once — logs rocket_launches, produces no
 *     research resource, and clears the pad.
 *  5. BFR (amount 2800) is rejected on a level-1 pad (min level 3).
 */
import assert from 'node:assert/strict';
import { withTestServer } from './support/test-server.ts';

interface QueueItemDTO {
  id: number;
  kind: number;
  quality: number;
  amount: number;
  duration: number;
  started: string;
  finishes: string;
}

interface LaunchQueueDTO {
  id: number;
  rocketKind: number;
  finishes: string;
}

async function runVerification() {
  console.log('================================================================');
  console.log(' Issue #170: Launch Pad busy-contract verification');
  console.log('================================================================');
  await withTestServer(async server => {
    const BASE_URL = server.baseUrl;
    const db = server.db;

    const { cookie, companyId } = await server.registerCompany('launchpad-issue-170');
    console.log(`✔ Registered test company (ID: ${companyId})`);

    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    const now = new Date().toISOString();
    const insertBuilding = db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
      VALUES (?, 'r1', 'l', 1, 'Launch Pad', 124200, 'research', ?)
    `).run(companyId, now);
    const buildingId = Number(insertBuilding.lastInsertRowid);

    db.prepare(`
      INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
      VALUES (?, 91, 0, 10, 0, 0, 0, 0, 1000.0, ?)
    `).run(companyId, now);
    server.setStock(companyId, 100, 50000, 10);
    const researchCost = { workers: 1, admin: 2, material1: 3, material2: 4, market: 10 };
    const rocketCost = { workers: 2, admin: 3, material1: 4, material2: 5, market: 1000 };
    db.prepare(`
      UPDATE warehouse SET cost_workers = ?, cost_admin = ?, cost_material1 = ?, cost_material2 = ?
      WHERE company_id = ? AND kind = 100 AND quality = 0
    `).run(researchCost.workers, researchCost.admin, researchCost.material1, researchCost.material2, companyId);
    db.prepare(`
      UPDATE warehouse SET cost_workers = ?, cost_admin = ?, cost_material1 = ?, cost_material2 = ?
      WHERE company_id = ? AND kind = 91 AND quality = 0
    `).run(rocketCost.workers, rocketCost.admin, rocketCost.material1, rocketCost.material2, companyId);
    const otherCompany = await server.registerCompany('launchpad-issue-170-other');
    server.setStock(companyId, 94, 10, 2000);
    console.log(`✔ Created L1 Launch Pad #${buildingId} + stocked rockets/research`);

    // Ordinary Aerospace Research production is distinct from a launch. A
    // non-launch amount must use the normal recipe, collect as resource 100,
    // and stay out of the rocket launch queue.
    db.prepare('UPDATE companies SET level = 5 WHERE company_id = ?').run(companyId);
    const researchStart = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 100, amount: 3 })
    });
    assert.equal(researchStart.status, 200, `ordinary research production should start: ${await researchStart.text()}`);
    const researchQueue = (await (await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers })).json()) as QueueItemDTO[];
    assert.equal(researchQueue.length, 1);
    assert.equal(researchQueue[0].kind, 100);
    assert.ok(researchQueue[0].amount > 0);
    const launchQueueBeforeLaunch = await fetch(`${BASE_URL}/api/v2/launch-queue/${buildingId}/`, { headers });
    assert.equal(launchQueueBeforeLaunch.status, 200);
    assert.deepEqual(await launchQueueBeforeLaunch.json(), [], 'ordinary research production is not a rocket launch');
    db.prepare('UPDATE production_queues SET finishes_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), researchQueue[0].id);
    const researchTake = await fetch(`${BASE_URL}/api/v2/order/take/${buildingId}/`, { method: 'POST', headers });
    const researchTakeBody = await researchTake.json() as { resource?: { kind: number; amount: number } };
    assert.equal(researchTake.status, 200, `ordinary research collect should succeed: ${JSON.stringify(researchTakeBody)}`);
    assert.equal(researchTakeBody.resource?.kind, 100, 'ordinary research collects as resource 100');
    assert.equal(researchTakeBody.resource?.amount, researchQueue[0].amount, 'ordinary research collects the queued output');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM rocket_launches WHERE company_id = ?').get(companyId) as { n: number }).n, 0);

    // ---- 1. busy POST with the original launch contract (amount 400) ----
    const busyRes = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 100, amount: 400, limitQuality: null })
    });
    const busyBody = (await busyRes.json()) as { error?: string; message?: string; building?: { busy?: unknown } };
    assert.equal(busyRes.status, 200, `busy launch must be accepted, got ${busyRes.status}: ${JSON.stringify(busyBody)}`);
    assert.ok(busyBody.building?.busy, 'busy response must carry the launch busy object');
    console.log('  ✔ POST /api/v1/busy/:id/ {kind:100, amount:400} accepted — no queue-duration rejection');

    const rocketAfter = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 91').get(companyId) as { amount: number };
    const researchAfter = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100').get(companyId) as { amount: number };
    assert.equal(rocketAfter.amount, 6, 'ordinary research recipe plus launch consume four rockets');
    const ordinaryResearchOutput = researchTakeBody.resource?.amount ?? 0;
    assert.equal(researchAfter.amount, 49600 + ordinaryResearchOutput, 'launch consumes 400 research after ordinary output is collected');
    console.log('  ✔ Inventory: 1 rocket + 400 research consumed');

    // ---- 2. launch visible in queue GET ----
    const queueRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers });
    assert.equal(queueRes.status, 200);
    const queue = (await queueRes.json()) as QueueItemDTO[];
    assert.equal(queue.length, 1, 'queue must list the launch order');
    assert.equal(queue[0].kind, 100);
    assert.equal(queue[0].amount, 400);
    const launchId = queue[0].id;
    console.log(`  ✔ Queue GET lists launch order #${launchId} (kind 100, amount 400)`);

    const simboostsBeforeRush = db.prepare('SELECT simboosts FROM companies WHERE company_id = ?').get(companyId) as { simboosts: number };
    const launchRush = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/${launchId}/rush/`, {
      method: 'POST',
      headers
    });
    assert.equal(launchRush.status, 400, 'generic production rush must not resolve a rocket launch as research');
    assert.equal(
      (db.prepare('SELECT simboosts FROM companies WHERE company_id = ?').get(companyId) as { simboosts: number }).simboosts,
      simboostsBeforeRush.simboosts,
      'rejected launch rush must not debit SimBoosts'
    );

    // A launch that has started cannot be cancelled through either generic
    // DELETE contract; reject it without deleting or refunding partial work.
    const runningRocket = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 91').get(companyId) as { amount: number };
    const runningResearch = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100').get(companyId) as { amount: number };
    const runningCancel = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/${launchId}/`, {
      method: 'DELETE',
      headers
    });
    assert.equal(runningCancel.status, 400, 'running launch cancellation must be rejected');
    assert.deepEqual(
      db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind IN (91, 100) ORDER BY kind').all(companyId),
      [runningRocket, runningResearch],
      'running launch rejection must not change inventory'
    );
    assert.equal((await (await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers })).json() as QueueItemDTO[]).length, 1);

    // Queue two later launches. Cancelling the middle pending order through
    // the generic queue route refunds it, leaves the running row unchanged,
    // and shifts only the order chained after it.
    const addLaunch = async () => {
      const response = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 100, amount: 400, limitQuality: null })
      });
      assert.equal(response.status, 200, `queued launch should be accepted: ${await response.text()}`);
    };
    await addLaunch();
    await addLaunch();
    const threeLaunches = (await (await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers })).json()) as QueueItemDTO[];
    assert.equal(threeLaunches.length, 3);
    const [running, middle, later] = threeLaunches;
    assert.ok(Date.parse(middle.started) > Date.now() && Date.parse(later.started) > Date.now(), 'later launches must be pending');
    const readRefundBasis = (kind: number) => db.prepare(`
      SELECT amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market
      FROM warehouse WHERE company_id = ? AND kind = ? AND quality = 0
    `).get(companyId, kind) as {
      amount: number;
      cost_workers: number;
      cost_admin: number;
      cost_material1: number;
      cost_material2: number;
      cost_market: number;
    };
    const middleResearchBefore = readRefundBasis(100);
    const middleRocketBefore = readRefundBasis(91);
    const foreignCancel = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/${middle.id}/`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: otherCompany.cookie }
    });
    assert.ok(foreignCancel.status >= 400, 'another company cannot cancel a launch');
    assert.equal(readRefundBasis(100).amount, middleResearchBefore.amount);
    assert.equal((await (await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers })).json() as QueueItemDTO[]).length, 3);

    db.exec(`
      CREATE TRIGGER issue_227_abort_launch_refund
      BEFORE UPDATE OF amount ON warehouse
      WHEN NEW.company_id = ${companyId} AND NEW.kind = 100 AND NEW.quality = 0
      BEGIN SELECT RAISE(ABORT, 'issue 227 launch rollback probe'); END;
    `);
    try {
      const failedRefund = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/${middle.id}/`, {
        method: 'DELETE', headers
      });
      assert.ok(failedRefund.status >= 400, 'failed warehouse credit aborts launch cancellation');
    } finally {
      db.exec('DROP TRIGGER issue_227_abort_launch_refund');
    }
    assert.deepEqual(readRefundBasis(100), middleResearchBefore, 'failed launch cancellation rolls back research amount and all cost buckets');
    assert.deepEqual(readRefundBasis(91), middleRocketBefore, 'failed launch cancellation rolls back rocket amount and all cost buckets');

    const cancelRes = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/${middle.id}/`, {
      method: 'DELETE',
      headers
    });
    assert.equal(cancelRes.status, 200, 'pending middle launch cancel must return 200');
    const remainingTwo = (await (await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers })).json()) as QueueItemDTO[];
    const runningAfterRechain = remainingTwo.find(item => item.id === running.id)!;
    const laterAfterRechain = remainingTwo.find(item => item.id === later.id)!;
    assert.equal(runningAfterRechain.started, running.started, 'running launch start time must be unchanged');
    assert.equal(runningAfterRechain.finishes, running.finishes, 'running launch finish time must be unchanged');
    assert.equal(Date.parse(laterAfterRechain.started), Date.parse(later.started) - middle.duration * 1000);
    assert.equal(Date.parse(laterAfterRechain.finishes), Date.parse(later.finishes) - middle.duration * 1000);
    const busyAfterRechain = db.prepare('SELECT busy_until FROM buildings WHERE id = ?').get(buildingId) as { busy_until: string };
    assert.equal(busyAfterRechain.busy_until, laterAfterRechain.finishes, 'busy_until uses post-rechain finish times');
    const middleResearchRefund = readRefundBasis(100);
    const middleRocketRefund = readRefundBasis(91);
    assert.equal(middleResearchRefund.amount, middleResearchBefore.amount + 400, 'cancelled launch refunds its research');
    assert.equal(middleRocketRefund.amount, middleRocketBefore.amount + 1, 'cancelled launch refunds its rocket');
    for (const [before, after] of [
      [middleResearchBefore, middleResearchRefund],
      [middleRocketBefore, middleRocketRefund]
    ]) {
      for (const bucket of ['cost_workers', 'cost_admin', 'cost_material1', 'cost_material2', 'cost_market'] as const) {
        assert.ok(Math.abs(after[bucket] - before[bucket]) < 1e-9, `${bucket} basis survives launch refund`);
      }
    }
    assert.ok(Math.abs(
      middleResearchRefund.amount * middleResearchRefund.cost_market
        - middleResearchBefore.amount * middleResearchBefore.cost_market
    - 400 * middleResearchBefore.cost_market) < 1e-7,
    `research valuation increases by exactly the refunded consumed basis (before=${middleResearchBefore.amount} @ ${middleResearchBefore.cost_market}, after=${middleResearchRefund.amount} @ ${middleResearchRefund.cost_market})`);
    const repeatedCancel = await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/${middle.id}/`, {
      method: 'DELETE', headers
    });
    assert.ok(repeatedCancel.status >= 400, 'cancelled launch cannot refund twice');
    assert.equal(readRefundBasis(100).amount, middleResearchRefund.amount);
    assert.equal(readRefundBasis(91).amount, middleRocketRefund.amount);

    // The legacy v1 busy DELETE has no queue id, so it cancels the latest
    // pending launch using the same aerospace helper and re-chain rules.
    const v1Cancel = await fetch(`${BASE_URL}/api/v1/buildings/${buildingId}/busy/`, { method: 'DELETE', headers });
    assert.equal(v1Cancel.status, 200, 'v1 pending busy cancellation delegates to aerospace rules');
    const remainingOne = (await (await fetch(`${BASE_URL}/api/v2/companies/buildings/${buildingId}/queue/`, { headers })).json()) as QueueItemDTO[];
    assert.equal(remainingOne.length, 1);
    assert.equal(remainingOne[0].id, running.id);

    // ---- 4. finished launch resolves via order/take exactly once ----
    const queue2 = remainingOne;
    db.prepare("UPDATE production_queues SET finishes_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), queue2[0].id);

    const takeRes = await fetch(`${BASE_URL}/api/v2/order/take/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    const takeBody = (await takeRes.json()) as { message?: string; resourceTransactions?: Array<{ amount: number }> };
    assert.equal(takeRes.status, 200, `collect must succeed, got ${takeRes.status}: ${JSON.stringify(takeBody)}`);
    assert.ok(takeBody.message, 'collect response must carry the launch outcome message');
    assert.equal(takeBody.resourceTransactions?.length, 0, 'launch collect must produce no resource');
    const launches = db.prepare('SELECT COUNT(*) AS n FROM rocket_launches WHERE company_id = ?').get(companyId) as { n: number };
    assert.equal(launches.n, 1, 'launch must be logged in rocket_launches');
    const researchFinal = db.prepare('SELECT amount FROM warehouse WHERE company_id = ? AND kind = 100').get(companyId) as { amount: number };
    assert.equal(researchFinal.amount, middleResearchRefund.amount + 400, 'launch collect produces no research resource after both pending refunds');

    // Idempotency: second take must fail.
    const take2Res = await fetch(`${BASE_URL}/api/v2/order/take/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    assert.notEqual(take2Res.status, 200, 'double collect of the same launch must be rejected');
    const launchesAfter = db.prepare('SELECT COUNT(*) AS n FROM rocket_launches WHERE company_id = ?').get(companyId) as { n: number };
    assert.equal(launchesAfter.n, 1, 'no duplicate launch log entry');
    console.log(`  ✔ Collect resolves the launch once ("${takeBody.message}"), no research output, idempotent`);

    // ---- 5. BFR on level-1 pad rejected ----
    const busyBfr = await fetch(`${BASE_URL}/api/v1/busy/${buildingId}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 100, amount: 2800, limitQuality: null })
    });
    assert.equal(busyBfr.status, 400, 'BFR (2800) on L1 pad must be rejected');
    console.log('  ✔ BFR launch (amount 2800) rejected on level-1 pad');

    console.log('================================================================');
    console.log(' All Issue #170 / #222 / #223 assertions PASSED');
    console.log('================================================================');
  });
}

runVerification().catch((err) => {
  console.error('❌ Verification FAILED with error:', err);
  process.exit(1);
});
