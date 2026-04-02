/**
 * E2E smoke tests — verifies core user flows in the browser.
 * Uses data-testid selectors for stability (decoupled from copy/styling).
 *
 * All tests use shared fixtures that automatically detect:
 * - console.error messages
 * - uncaught page exceptions
 * - HTTP 5xx responses
 * - React error boundary fallbacks
 *
 * Local:  npm run dev:start, then: npx playwright test
 * CI/QA:  PLAYWRIGHT_BASE_URL=https://qa.ultimateofficepoolmanager.com npx playwright test
 */

import { test, expect, assertNoErrors, assertNoErrorBoundary } from './fixtures';

test.describe('Landing & Navigation', () => {
  test('landing page loads with hero and CTA', async ({ page, pageErrors }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('hero-heading')).toBeVisible();
    await expect(page.getByTestId('hero-cta')).toBeVisible();
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('header has brand and nav links', async ({ page, pageErrors }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('brand-link')).toBeVisible();
    await expect(page.getByTestId('login-link')).toBeVisible();
    await expect(page.getByTestId('register-link')).toBeVisible();
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('footer is visible', async ({ page, pageErrors }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('public-footer')).toBeVisible();
    await assertNoErrors(pageErrors);
  });
});

test.describe('Legal Pages', () => {
  test('privacy policy loads', async ({ page, pageErrors }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('legal-title')).toContainText('Privacy Policy');
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('terms of service loads', async ({ page, pageErrors }) => {
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('legal-title')).toContainText('Terms of Service');
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('cookie policy loads', async ({ page, pageErrors }) => {
    await page.goto('/cookie-policy');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('legal-title')).toContainText('Cookie Policy');
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('responsible gaming loads', async ({ page, pageErrors }) => {
    await page.goto('/responsible-gaming');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('legal-title')).toContainText('Responsible Gaming');
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });
});

test.describe('Auth Pages', () => {
  test('login page loads with email input', async ({ page, pageErrors }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('register page loads', async ({ page, pageErrors }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('register-link')).toBeVisible();
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('login link navigates from landing', async ({ page, pageErrors }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('login-link').click();
    await expect(page).toHaveURL(/\/login/);
    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });
});

test.describe('Cookie Banner', () => {
  test('cookie banner appears on first visit', async ({ page, pageErrors }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('cookie-banner')).toBeVisible();
    await expect(page.getByTestId('cookie-accept-all')).toBeVisible();
    await expect(page.getByTestId('cookie-necessary')).toBeVisible();
    await assertNoErrors(pageErrors);
  });

  test('cookie banner disappears after accepting', async ({ page, pageErrors }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByTestId('cookie-accept-all').click();
    await expect(page.getByTestId('cookie-banner')).not.toBeVisible();
    await assertNoErrors(pageErrors);
  });
});
