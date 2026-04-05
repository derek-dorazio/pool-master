import { test as base, expect, type Page } from '@playwright/test';

export interface PageErrors {
  consoleErrors: string[];
  uncaughtErrors: string[];
  serverErrors: string[];
}

export function createRuntimeErrorTracker(page: Page): PageErrors {
  const errors: PageErrors = {
    consoleErrors: [],
    uncaughtErrors: [],
    serverErrors: [],
  };

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('favicon.ico') || text.includes('ERR_BLOCKED_BY_CLIENT')) return;
      if (text.includes('Failed to load resource') && text.includes('404')) return;
      errors.consoleErrors.push(text);
    }
  });

  page.on('pageerror', (error) => {
    errors.uncaughtErrors.push(error.message);
  });

  page.on('response', (response) => {
    if (response.status() >= 500) {
      errors.serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  return errors;
}

export const test = base.extend<{ pageErrors: PageErrors }>({
  pageErrors: async ({ page }, use) => {
    const errors = createRuntimeErrorTracker(page);
    await use(errors);
  },
});

export async function assertNoErrors(pageErrors: PageErrors) {
  const allErrors = [
    ...pageErrors.consoleErrors.map((e) => `[console.error] ${e}`),
    ...pageErrors.uncaughtErrors.map((e) => `[uncaught] ${e}`),
    ...pageErrors.serverErrors.map((e) => `[HTTP 5xx] ${e}`),
  ];

  expect(allErrors, 'Runtime errors detected during test').toEqual([]);
}

export { expect };
