/**
 * E2E smoke tests — verifies core user flows in the browser.
 * Uses data-testid selectors for stability (decoupled from copy/styling).
 *
 * Local:  npm run dev:start, then: npx playwright test
 * CI/QA:  PLAYWRIGHT_BASE_URL=https://qa.ultimateofficepoolmanager.com npx playwright test
 */

import { test, expect } from '@playwright/test';

test.describe('Landing & Navigation', () => {
  test('landing page loads with hero and CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hero-heading')).toBeVisible();
    await expect(page.getByTestId('hero-cta')).toBeVisible();
  });

  test('header has brand and nav links', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('brand-link')).toBeVisible();
    await expect(page.getByTestId('login-link')).toBeVisible();
    await expect(page.getByTestId('register-link')).toBeVisible();
  });

  test('footer is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('public-footer')).toBeVisible();
  });
});

test.describe('Legal Pages', () => {
  test('privacy policy loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByTestId('legal-title')).toContainText('Privacy Policy');
  });

  test('terms of service loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.getByTestId('legal-title')).toContainText('Terms of Service');
  });

  test('cookie policy loads', async ({ page }) => {
    await page.goto('/cookie-policy');
    await expect(page.getByTestId('legal-title')).toContainText('Cookie Policy');
  });

  test('responsible gaming loads', async ({ page }) => {
    await page.goto('/responsible-gaming');
    await expect(page.getByTestId('legal-title')).toContainText('Responsible Gaming');
  });
});

test.describe('Auth Pages', () => {
  test('login page loads with email input', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  });

  test('register page loads', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByTestId('register-link')).toBeVisible();
  });

  test('login link navigates from landing', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('login-link').click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Cookie Banner', () => {
  test('cookie banner appears on first visit', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('cookie-banner')).toBeVisible();
    await expect(page.getByTestId('cookie-accept-all')).toBeVisible();
    await expect(page.getByTestId('cookie-necessary')).toBeVisible();
  });

  test('cookie banner disappears after accepting', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByTestId('cookie-accept-all').click();
    await expect(page.getByTestId('cookie-banner')).not.toBeVisible();
  });
});
