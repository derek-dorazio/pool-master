/**
 * Playwright config for E2E smoke tests.
 * Requires: npm run dev:start (full stack must be running)
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.smoke.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Ensure the webapp is running before tests start */
  webServer: {
    command: 'echo "Webapp must already be running at http://localhost:5173"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 5_000,
  },
});
