import { defineConfig } from '@playwright/test';
import { findBrowserExecutable } from './scripts/e2e/find-browser.ts';

const port = Number.parseInt(process.env.E2E_PORT ?? '3100', 10);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    // Video recording needs a separate ffmpeg binary. Screenshots and traces
    // cover the required failure evidence without making browser startup
    // depend on that optional executable.
    video: 'off',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: findBrowserExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: 'node scripts/e2e/start-server.mjs',
    url: `${baseURL}/zh-cn/`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      E2E_PORT: String(port),
      E2E_DATA_DIR: '',
    },
  },
});
