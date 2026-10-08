import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the built app, on a phone-sized screen, against the real server with the
// internet replaced by recorded answers (e2e/server/e2e-server.ts). They use the Chrome that is
// already installed, so nothing has to be downloaded.
//
//   npm run e2e -w web          (builds the web app first)
const PORT = 3200;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One server and one in-memory database for all tests: they only read.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    channel: 'chrome',
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx e2e/server/e2e-server.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(PORT) },
  },
});
