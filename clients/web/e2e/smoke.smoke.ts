/**
 * E2E smoke tests — verifies core user flows in the browser.
 *
 * Prerequisites: npm run dev:start (full stack must be running)
 */

import { test, expect } from '@playwright/test';

test.describe('Landing & Navigation', () => {
  test('landing page loads with title and CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=PoolMaster')).toBeVisible();
    await expect(page.locator('text=Get Started')).toBeVisible();
    await expect(page.locator('text=Log In')).toBeVisible();
  });

  test('footer has legal links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.locator('footer >> text=Terms')).toBeVisible();
    await expect(page.locator('footer >> text=Privacy')).toBeVisible();
    await expect(page.locator('footer >> text=Cookies')).toBeVisible();
    await expect(page.locator('footer >> text=Responsible Gaming')).toBeVisible();
  });
});

test.describe('Legal Pages', () => {
  test('privacy policy loads with TOC', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('h1')).toContainText('Privacy Policy');
    await expect(page.locator('text=Data We Collect')).toBeVisible();
    await expect(page.locator('text=Your Rights')).toBeVisible();
  });

  test('terms of service loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('h1')).toContainText('Terms of Service');
    await expect(page.locator('text=No Real-Money Transactions')).toBeVisible();
  });

  test('cookie policy loads with tables', async ({ page }) => {
    await page.goto('/cookie-policy');
    await expect(page.locator('h1')).toContainText('Cookie Policy');
    await expect(page.locator('table')).toBeVisible();
  });

  test('responsible gaming loads with resources', async ({ page }) => {
    await page.goto('/responsible-gaming');
    await expect(page.locator('h1')).toContainText('Responsible Gaming');
    await expect(page.locator('text=National Council on Problem Gambling')).toBeVisible();
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

test.describe('Discovery Pages', () => {
  test('discover page loads with search', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.locator('h1')).toContainText('Discover');
    await expect(page.locator('input[placeholder*="Find"]')).toBeVisible();
  });

  test('browse leagues page loads', async ({ page }) => {
    await page.goto('/discover/leagues');
    await expect(page.locator('h1')).toContainText('Browse Leagues');
  });

  test('browse contests page loads', async ({ page }) => {
    await page.goto('/discover/contests');
    await expect(page.locator('h1')).toContainText('Browse Contests');
  });
});

test.describe('Cookie Banner', () => {
  test('cookie banner appears on first visit', async ({ page, context }) => {
    await context.clearCookies();
    // Clear localStorage
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
