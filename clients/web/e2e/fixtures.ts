/**
 * Shared Playwright fixtures that detect runtime errors.
 *
 * Every E2E test should use `test` and `expect` from this module instead of
 * importing directly from '@playwright/test'. This ensures that:
 *
 * 1. Console errors are captured and fail the test
 * 2. Uncaught page errors (exceptions) fail the test
 * 3. HTTP 5xx responses fail the test
 * 4. React error boundaries are detected
 */

import { test as base, expect } from '@playwright/test';

/** Errors collected during a single test. */
interface PageErrors {
  consoleErrors: string[];
  uncaughtErrors: string[];
  serverErrors: string[];
}

export const test = base.extend<{ pageErrors: PageErrors }>({
  pageErrors: async ({ page }, use) => {
    const errors: PageErrors = {
      consoleErrors: [],
      uncaughtErrors: [],
      serverErrors: [],
    };

    // Capture console.error messages
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known noise (e.g., favicon 404, browser extensions)
        if (text.includes('favicon.ico') || text.includes('ERR_BLOCKED_BY_CLIENT')) return;
        errors.consoleErrors.push(text);
      }
    });

    // Capture uncaught exceptions (window.onerror / unhandledrejection)
    page.on('pageerror', (error) => {
      errors.uncaughtErrors.push(error.message);
    });

    // Capture HTTP 5xx responses
    page.on('response', (response) => {
      if (response.status() >= 500) {
        errors.serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    await use(errors);
  },
});

/**
 * Assert that no runtime errors were detected during the test.
 * Call this at the end of every test (or in afterEach).
 */
export async function assertNoErrors(pageErrors: PageErrors) {
  const allErrors = [
    ...pageErrors.consoleErrors.map((e) => `[console.error] ${e}`),
    ...pageErrors.uncaughtErrors.map((e) => `[uncaught] ${e}`),
    ...pageErrors.serverErrors.map((e) => `[HTTP 5xx] ${e}`),
  ];

  expect(allErrors, 'Runtime errors detected during test').toEqual([]);
}

/**
 * Assert that no React error boundary fallback is visible on the page.
 */
export async function assertNoErrorBoundary(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="error-boundary-fallback"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="route-error-fallback"]')).not.toBeVisible();
}

export { expect };
