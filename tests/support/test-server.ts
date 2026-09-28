import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  json: T;
  text: string;
}

export interface TestServer {
  baseUrl: string;
  dataDir: string;
  dbPath: string;
  db: DatabaseSync;
  request<T = unknown>(method: string, url: string, options?: { cookie?: string; body?: unknown }): Promise<ApiResponse<T>>;
  registerCompany(label: string): Promise<{ cookie: string; companyId: number; playerId: number }>;
  setStock(companyId: number, kind: number, amount: number, unitCost: number, quality?: number): void;
  stop(): Promise<void>;
}

async function availablePort(requestedPort = 0): Promise<number> {
  const probe = net.createServer();
  const listening = once(probe, 'listening');
  probe.listen(requestedPort, '127.0.0.1');
  await listening;
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const closed = once(probe, 'close');
  probe.close();
  await closed;
  return address.port;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<void>(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); })
    ]);
    await exited;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startTestServer(options: { port?: number; env?: Record<string, string> } = {}): Promise<TestServer> {
  const port = await availablePort(options.port);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'phantom-test-'));
  const dbPath = path.join(dataDir, 'simcompanies.sqlite');
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let startupError: Error | undefined;
  let stderr = '';
  child.on('error', error => { startupError = error; });
  child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
  let database: DatabaseSync | undefined;
  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    try {
      database?.close();
    } finally {
      try {
        await stopChild(child);
      } finally {
        // Created above, never supplied by a caller or shared with user data.
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    }
  }
  try {
    const deadline = Date.now() + 30_000;
    while (true) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Test server exited before readiness: ${stderr}`);
      try {
        if ((await fetch(`${baseUrl}/version/`, { signal: AbortSignal.timeout(500) })).ok) break;
      } catch { /* HTTP listener is still starting. */ }
      if (Date.now() >= deadline) throw new Error(`Test server readiness timed out: ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    database = new DatabaseSync(dbPath);
    database.exec('PRAGMA busy_timeout = 5000');
    const db = database;
    async function request<T = unknown>(method: string, url: string, input: { cookie?: string; body?: unknown } = {}): Promise<ApiResponse<T>> {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(input.cookie ? { Cookie: input.cookie } : {}) },
        body: input.body === undefined ? undefined : JSON.stringify(input.body)
      });
      const text = await response.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* HTML/text responses retain their raw body. */ }
      return { status: response.status, headers: response.headers, text, json: json as T };
    }
    return {
      baseUrl, dataDir, dbPath, db, request, stop,
      async registerCompany(label) {
        const registered = await request('POST', '/api/v2/auth/email/connect/', {
          body: { email: `${label}_${crypto.randomUUID()}@test.local`, password: 'Password123!', company: label }
        });
        assert.equal(registered.status, 200, registered.text);
        const cookie = registered.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        assert.ok(cookie, 'registration must set a session cookie');
        const auth = await request<{ authCompany: { companyId: number }; authUser: { id: number } }>('GET', '/api/v3/companies/auth-data/', { cookie });
        assert.equal(auth.status, 200, auth.text);
        assert.ok(auth.json.authCompany.companyId > 0);
        assert.ok(auth.json.authUser.id > 0);
        return { cookie, companyId: auth.json.authCompany.companyId, playerId: auth.json.authUser.id };
      },
      setStock(companyId, kind, amount, unitCost, quality = 0) {
        assert.ok(Number.isFinite(amount) && amount >= 0);
        assert.ok(Number.isFinite(unitCost) && unitCost >= 0);
        db.prepare(`
          INSERT INTO warehouse (company_id, kind, quality, amount, cost_workers, cost_admin, cost_material1, cost_material2, cost_market, updated_at)
          VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
          ON CONFLICT(company_id, kind, quality) DO UPDATE SET amount = excluded.amount,
            cost_workers = 0, cost_admin = 0, cost_material1 = 0, cost_material2 = 0,
            cost_market = excluded.cost_market, updated_at = excluded.updated_at
        `).run(companyId, kind, quality, amount, unitCost, new Date().toISOString());
      }
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function withTestServer<T>(run: (server: TestServer) => Promise<T>, options: Parameters<typeof startTestServer>[0] = {}): Promise<T> {
  const server = await startTestServer(options);
  try {
    return await run(server);
  } finally {
    await server.stop();
  }
}
