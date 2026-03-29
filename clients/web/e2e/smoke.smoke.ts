/**
 * E2E smoke tests — verifies core user flows in the browser.
 *
 * Local:  npm run dev:start, then: npx playwright test
 * CI/QA:  PLAYWRIGHT_BASE_URL=https://qa.ultimateofficepoolmanager.com npx playwright test
 */

import { test, expect } from '@playwright/test';

test.describe('Landing & Navigation', () => {
  test('landing page loads with hero and CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Run Your Pool')).toBeVisible();
    await expect(page.locator('text=Get Started Free')).toBeVisible();
  });

  test('header has brand name', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Ultimate Pool Manager')).toBeVisible();
  });

  test('footer has legal links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.locator('footer >> text=Terms')).toBeVisible();
    await expect(page.locator('footer >> text=Privacy')).toBeVisible();
  });
});

test.describe('Legal Pages', () => {
  test('privacy policy loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('text=Privacy Policy')).toBeVisible();
  });

  test('terms of service loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('text=Terms of Service')).toBeVisible();
  });

  test('cookie policy loads', async ({ page }) => {
    await page.goto('/cookie-policy');
    await expect(page.locator('text=Cookie Policy')).toBeVisible();
  });

  test('responsible gaming loads', async ({ page }) => {
    await page.goto('/responsible-gaming');
    await expect(page.locator('text=Responsible Gaming')).toBeVisible();
  });
});

test.describe('Auth Pages', () => {
  test('login page loads with form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  });

  test('register page loads', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('text=Get Started')).toBeVisible();
  });

  test('login link navigates from landing', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Log In');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Cookie Banner', () => {
  test('cookie banner appears on first visit', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('text=Accept All')).toBeVisible();
  });

  test('cookie banner disappears after accepting', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('text=Accept All');
    await expect(page.locator('text=Accept All')).not.toBeVisible();
  });
});
