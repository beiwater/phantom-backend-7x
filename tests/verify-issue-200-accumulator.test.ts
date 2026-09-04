import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const PORT = 3650;
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface ServerInstance {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      // Server is still booting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startServer(): Promise<ServerInstance> {
  const available = await new Promise<boolean>(resolve => {
    const probe = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(PORT, '127.0.0.1');
  });
  assert.ok(available, `Port ${PORT} must be available`);
  const dataDir = path.resolve('data', `test-run-issue-200-${Date.now()}`);
  const child = spawn(
    existsSync('/opt/magnate/.node22/bin/node') ? '/opt/magnate/.node22/bin/node' : process.execPath,
    ['--experimental-strip-types', 'server/index.ts'],
    {
      cwd: path.resolve(import.meta.dirname ?? '.', '..'),
      env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SPEED_MULTIPLIER: '100' },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );
  child.stderr?.on('data', chunk => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) process.stderr.write(`[server-${PORT}] ${text}`);
  });
  await waitForServer(`${BASE_URL}/version/`);
  return { child, dataDir, dbPath: path.join(dataDir, 'simcompanies.sqlite') };
}

async function registerCompany(label: string): Promise<{ cookie: string; companyId: number }> {
  const response = await fetch(`${BASE_URL}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `accumulator_${label}_${Date.now()}@test.local`,
      password: 'test-password-1'
    })
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  const auth = await fetch(`${BASE_URL}/api/v3/companies/auth-data/`, { headers: { Cookie: cookie } });
  assert.equal(auth.status, 200);
  const authBody = await auth.json() as {
    companyPublicInfo?: { id: number };
    authCompany?: { companyId?: number; id?: number };
  };
  const companyId = authBody.companyPublicInfo?.id || authBody.authCompany?.companyId || authBody.authCompany?.id || 0;
  assert.ok(companyId > 0);
  return { cookie, companyId };
}

function insertForest(db: DatabaseSync, companyId: number, position: string): number {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO buildings (company_id, position, kind, size, name, cost, category, created_at)
    VALUES (?, ?, 'v', 1, 'Forest Nursery', 6900, 'production', ?)
  `).run(companyId, position, now);
  db.prepare(`
    INSERT INTO warehouse
      (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
    VALUES (?, 2, 0, 1000, 0, 0, 0, 0, 1, ?)
  `).run(companyId, now);
  return Number(result.lastInsertRowid);
}

async function runVerification(): Promise<void> {
  let server: ServerInstance | null = null;
  try {
    server = await startServer();
    const database = new DatabaseSync(server.dbPath);
    const first = await registerCompany('owner');
    const headers = { 'Content-Type': 'application/json', Cookie: first.cookie };
    const buildingId = insertForest(database, first.companyId, 'acc-1');

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
    assert.equal(startedBody.building?.busy?.category, 'nurturing');
    assert.equal((startedBody.building?.busy?.accumulator as Record<string, unknown>)?.value, 10);
    assert.equal(startedBody.building?.productionAccumulator?.value, 0);
    const queue = database.prepare(
      'SELECT id, resolved FROM production_queues WHERE building_id = ? ORDER BY id DESC LIMIT 1'
    ).get(buildingId) as { id: number; resolved: number };
    assert.equal(queue.resolved, 0);

    const notFinished = await fetch(`${BASE_URL}/api/v1/buildings/${buildingId}/accumulator/collect/`, {
      method: 'POST',
      headers
    });
    assert.equal(notFinished.status, 400, 'unfinished accumulator growth must be rejected');
    assert.equal((database.prepare('SELECT resolved FROM production_queues WHERE id = ?').get(queue.id) as { resolved: number }).resolved, 0);

    database.prepare('UPDATE production_queues SET finishes_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), queue.id);
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

    const second = await registerCompany('other');
    const foreignBuildingId = insertForest(database, second.companyId, 'acc-2');
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
  } finally {
    server?.child.kill();
    await sleep(300);
    if (server) rmSync(server.dataDir, { recursive: true, force: true });
  }
}

runVerification().catch(error => {
  console.error('Accumulator verification failed:', error);
  process.exit(1);
});
