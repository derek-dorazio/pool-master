import { defineConfig, devices } from '@playwright/test';

const browserChannel = process.env.POOLMASTER_E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  // pool-master-303: no shared mutable fixtures left to race over (phase 1
  // of plans/130 deleted them) — safe to parallelize.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Real-network/real-browser e2e gets one retry in CI, matching
  // Playwright's own guidance — a transient blip no longer fails the whole
  // job outright.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: process.env.POOLMASTER_E2E_BASE_URL ?? 'https://qa.ultimateofficepoolmanager.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /.*\.e2e\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
});
