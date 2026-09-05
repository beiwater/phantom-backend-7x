import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG_PROBE = `
  import { CONFIG } from './server/config.ts';
  console.log('RESULT:' + JSON.stringify({ port: CONFIG.PORT, dataDir: CONFIG.DATA_DIR }));
`;

const REALM_PROBE = `
  import { DatabaseSync } from 'node:sqlite';
  import { CONFIG } from './server/config.ts';
  import { RealmPhaseService } from './server/services/realm-phase-service.ts';

  CONFIG.REALM_PHASE_PRESET = process.env.TEST_REALM_PRESET || undefined;
  CONFIG.REALM_PHASE = undefined;
  CONFIG.REALM_RESEARCH_LIMIT = undefined;
  CONFIG.REALM_BONDS_ENABLED = undefined;
  CONFIG.REALM_GOV_ORDERS_ENABLED = undefined;
  CONFIG.REALM_EXECUTIVES_ENABLED = undefined;
  CONFIG.REALM_REC_BUILDINGS_ENABLED = undefined;
  CONFIG.REALM_COLLECTIBLES_ENABLED = undefined;
  CONFIG.REALM_ROBOTS_ENABLED = undefined;

  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE realm_phase_settings (' +
    '  id INTEGER PRIMARY KEY CHECK (id = 1),' +
    '  preset TEXT NOT NULL,' +
    '  phase INTEGER NOT NULL,' +
    '  research_limit INTEGER NOT NULL,' +
    '  bonds_enabled INTEGER NOT NULL,' +
    '  gov_orders_enabled INTEGER NOT NULL,' +
    '  executives_enabled INTEGER NOT NULL,' +
    '  rec_buildings_enabled INTEGER NOT NULL,' +
    '  collectibles_enabled INTEGER NOT NULL,' +
    '  robots_enabled INTEGER NOT NULL,' +
    '  purchases_enabled INTEGER NOT NULL,' +
    '  simboosts_exchange_limit INTEGER NOT NULL,' +
    '  retail_modeling INTEGER NOT NULL,' +
    '  updated_at TEXT' +
    ');'
  );
  database.prepare(
    'INSERT INTO realm_phase_settings (' +
    '  id, preset, phase, research_limit, bonds_enabled, gov_orders_enabled,' +
    '  executives_enabled, rec_buildings_enabled, collectibles_enabled, robots_enabled,' +
    '  purchases_enabled, simboosts_exchange_limit, retail_modeling, updated_at' +
    ') VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('phase_3', 2, 4, 1, 1, 0, 0, 0, 0, 1, 6000, 0, new Date().toISOString());

  const startup = RealmPhaseService.getActiveRealmConfig(database);
  let runtime = null;
  if (process.env.TEST_RUNTIME_PRESET) {
    runtime = RealmPhaseService.setPreset(process.env.TEST_RUNTIME_PRESET, undefined, database);
  }
  const persisted = database.prepare('SELECT preset FROM realm_phase_settings WHERE id = 1').get();
  console.log('RESULT:' + JSON.stringify({
    startup: { preset: startup.preset, phase: startup.phase },
    runtime: runtime ? { preset: runtime.preset, phase: runtime.phase } : null,
    persisted: persisted?.preset ?? null
  }));
`;

function runProbe(source: string, env: Record<string, string>): Record<string, unknown> {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', source],
    { cwd: ROOT_DIR, env: { ...process.env, ...env }, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const marker = result.stdout.split('\n').find(line => line.startsWith('RESULT:'));
  assert.ok(marker, `Probe did not emit a result: ${result.stdout}`);
  return JSON.parse(marker.slice('RESULT:'.length)) as Record<string, unknown>;
}

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-config-precedence-'));
try {
  const config = runProbe(CONFIG_PROBE, {
    PORT: '43127',
    DATA_DIR: tempDataDir
  });
  assert.equal(config.port, 43127, 'External PORT must win over values loaded from .env');
  assert.equal(config.dataDir, path.resolve(tempDataDir), 'External DATA_DIR must win over values loaded from .env');

  const envPinned = runProbe(REALM_PROBE, {
    DATA_DIR: tempDataDir,
    TEST_REALM_PRESET: 'phase_1'
  });
  assert.deepEqual(envPinned.startup, { preset: 'phase_1', phase: 0 }, 'Explicit env preset must override persisted DB preset at startup');

  const persistedAfterRestart = runProbe(REALM_PROBE, {
    DATA_DIR: tempDataDir,
    TEST_REALM_PRESET: ''
  });
  assert.deepEqual(persistedAfterRestart.startup, { preset: 'phase_3', phase: 2 }, 'Persisted preset must be used when no env preset is configured');

  const runtimeUpdate = runProbe(REALM_PROBE, {
    DATA_DIR: tempDataDir,
    TEST_REALM_PRESET: 'phase_1',
    TEST_RUNTIME_PRESET: 'phase_2'
  });
  assert.deepEqual(runtimeUpdate.startup, { preset: 'phase_1', phase: 0 }, 'Runtime probe must start from explicit env preset');
  assert.deepEqual(runtimeUpdate.runtime, { preset: 'phase_2', phase: 1 }, 'Debug preset update must override env for the running process');
  assert.equal(runtimeUpdate.persisted, 'phase_2', 'Debug preset update must remain persisted for a later restart');
} finally {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

console.log('PASS config env precedence and realm phase startup/runtime precedence');
