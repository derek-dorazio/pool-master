/**
 * Playwright config for browser E2E smoke tests.
 *
 * Local:  npm run dev:start, then: npx playwright test
 * CI/QA:  PLAYWRIGHT_BASE_URL=https://qa.ultimateofficepoolmanager.com npx playwright test
 */

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const isRemote = baseURL.startsWith('https://');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.smoke.ts',
  fullyParallel: false,
  retries: isRemote ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Only check local server when not targeting a remote URL */
  ...(isRemote
    ? {}
    : {
        webServer: {
          command: 'echo "Webapp must already be running at http://localhost:5173"',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 5_000,
        },
      }),
});
