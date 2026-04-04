/**
 * Minimal browser smoke tests for CI.
 *
 * These intentionally keep the deployed browser lane small and reliable:
 * - the public landing page loads
 * - auth entry points render and basic navigation works
 *
 * Richer end-to-end product journeys are deferred to a future rebuild plan.
 */

import { test, expect, assertNoErrors, assertNoErrorBoundary } from './fixtures';

test.describe('Browser CI sanity checks', () => {
  test('landing page loads and links to registration', async ({ page, pageErrors }) => {
    await page.goto('/');

    await expect(page.getByTestId('hero-heading')).toBeVisible();
    await expect(page.getByTestId('hero-cta')).toBeVisible();

    await page.getByTestId('hero-cta').click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByTestId('auth-register-title')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.getByTestId('auth-register-next')).toBeVisible();

    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('login page renders the real auth form', async ({ page, pageErrors }) => {
    await page.goto('/login');

    await expect(page.getByTestId('auth-login-title')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByTestId('auth-login-submit')).toBeVisible();

    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });
});
