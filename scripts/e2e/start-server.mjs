import { startTestServer } from '../../tests/support/test-server.ts';

// Playwright and backend regressions share the same isolated service/database
// lifecycle. Returning cleanup makes it run after browser workers exit.
export default async function setup() {
  const port = Number.parseInt(process.env.E2E_PORT ?? '3100', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid E2E_PORT: ${process.env.E2E_PORT}`);
  }
  // Canonical UI duration checks use a stable economy; scheduler/cycle changes
  // have their own backend regressions and must not leak between browser tests.
  const server = await startTestServer({ port, env: { ECONOMY_RANDOM: 'false' } });
  return () => server.stop();
}
