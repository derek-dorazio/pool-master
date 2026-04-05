import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174';
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

  ...(isRemote
    ? {}
    : {
        webServer: {
          command: 'echo "Admin app must already be running at http://localhost:5174"',
          url: 'http://localhost:5174',
          reuseExistingServer: true,
          timeout: 5_000,
        },
      }),
});
