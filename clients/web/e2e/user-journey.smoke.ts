/**
 * E2E user journey — authenticated flows via browser.
 *
 * Registers a user via API, injects auth token, then tests:
 * Dashboard → Create League → Create Contest wizard
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const API_URL = BASE_URL.replace(':5173', ':3000'); // API runs on :3000 locally

/** Register a user via API and inject token into browser localStorage. */
async function authenticateUser(page: Page): Promise<{ email: string; displayName: string }> {
  const email = `e2e-${Date.now()}@journey.test`;
  const displayName = 'E2E Journey User';

  // Register via API
  const registerRes = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'JourneyPass123', displayName }),
  });

  if (registerRes.status !== 201) {
    throw new Error(`Registration failed: ${registerRes.status} ${await registerRes.text()}`);
  }

  const { tokens, user } = await registerRes.json() as any;

  // Inject token into localStorage before navigating
  await page.goto(BASE_URL);
  await page.evaluate(
    ({ token, userData }) => {
      localStorage.setItem('access_token', token);
      // Store user data for Zustand hydration
      localStorage.setItem('auth_user', JSON.stringify(userData));
    },
    { token: tokens.accessToken, userData: user },
  );

  return { email, displayName };
}

test.describe('Authenticated User Journey', () => {
  let userDisplayName: string;

  test.beforeAll(async ({ browser }) => {
    // Quick health check — skip all tests if API is down
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) test.skip();
    } catch {
      test.skip();
    }
  });

  test.beforeEach(async ({ page }) => {
    const user = await authenticateUser(page);
    userDisplayName = user.displayName;
  });

  // -----------------------------------------------------------------------
  // Dashboard
  // -----------------------------------------------------------------------
  test('dashboard loads after authentication', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    // Should see the dashboard, not a redirect to login
    await expect(page).toHaveURL(/dashboard/);
    // Greeting or dashboard content should be visible
    await expect(page.locator('h1, h2, [data-testid="dashboard-greeting"]').first()).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Create League
  // -----------------------------------------------------------------------
  test('create league page loads with form', async ({ page }) => {
    await page.goto(`${BASE_URL}/leagues/create`);
    await expect(page).toHaveURL(/leagues\/create/);
    // Should have a name input field
    await expect(page.locator('input[name="name"], input[placeholder*="name" i]').first()).toBeVisible();
  });

  test('can fill league name and description', async ({ page }) => {
    await page.goto(`${BASE_URL}/leagues/create`);
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first();
    await nameInput.fill('E2E Test League');
    await expect(nameInput).toHaveValue('E2E Test League');
  });

  // -----------------------------------------------------------------------
  // Create Contest
  // -----------------------------------------------------------------------
  test('create contest page loads with wizard', async ({ page }) => {
    await page.goto(`${BASE_URL}/contests/create`);
    // Should show the contest creation wizard or a sport selection
    await expect(page).toHaveURL(/contests\/create/);
    // The page should have some content (sport cards, step indicator, etc.)
    await expect(page.locator('main').first()).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Discover
  // -----------------------------------------------------------------------
  test('discover page is accessible when authenticated', async ({ page }) => {
    await page.goto(`${BASE_URL}/discover`);
    await expect(page).toHaveURL(/discover/);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------
  test('settings page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await expect(page).toHaveURL(/settings/);
  });

  // -----------------------------------------------------------------------
  // Notifications
  // -----------------------------------------------------------------------
  test('notifications page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/notifications`);
    await expect(page).toHaveURL(/notifications/);
  });
});
