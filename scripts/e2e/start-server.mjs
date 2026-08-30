import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const port = Number.parseInt(process.env.E2E_PORT ?? '3100', 10);
const requestedDataDirectory = process.env.E2E_DATA_DIR?.trim();
let runDirectory = process.env.E2E_RUN_DIR || '/opt/phantom-e2e-runs';
try {
  mkdirSync(runDirectory, { recursive: true });
} catch {
  runDirectory = resolve(tmpdir(), 'phantom-e2e-runs');
  mkdirSync(runDirectory, { recursive: true });
}
const dataDirectory = requestedDataDirectory || mkdtempSync(resolve(runDirectory, 'simcompanies-e2e-'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid E2E_PORT: ${process.env.E2E_PORT}`);
}

const server = spawn(
  process.execPath,
  ['--experimental-strip-types', 'server/index.ts'],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDirectory,
    },
    stdio: 'inherit',
  },
);

let shuttingDown = false;

function forwardSignal(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  server.kill(signal);
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

server.on('exit', (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
