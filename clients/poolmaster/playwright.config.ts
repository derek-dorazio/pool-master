import { defineConfig, devices } from '@playwright/test';

const browserChannel = process.env.POOLMASTER_E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
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
      name: 'auth setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['auth setup'],
      testMatch: /.*\.e2e\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
});
