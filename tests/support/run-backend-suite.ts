import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { withTestServer } from './test-server.ts';

const suite = process.argv[2];
if (!suite) throw new Error('A backend suite path is required');

const result = await withTestServer(async server => {
  const child = spawn(process.execPath, ['--experimental-strip-types', suite], {
    env: {
      ...process.env,
      DATA_DIR: server.dataDir,
      BASE_URL: server.baseUrl,
      PORT: new URL(server.baseUrl).port
    },
    stdio: 'inherit'
  });
  const [code, signal] = await once(child, 'exit');
  return typeof code === 'number' ? code : signal ? 1 : 0;
}, { port: Number(process.env.PORT ?? 3000) });

process.exitCode = result;
