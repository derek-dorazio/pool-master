/**
 * Minimal browser smoke tests for CI.
 *
 * These intentionally keep the deployed browser lane small and reliable:
 * - seeded commissioner login works against the deployed auth service
 * - an authenticated league-management route loads live data from the service
 */

import { test, expect, assertNoErrors, assertNoErrorBoundary } from './fixtures';

const SEEDED_WEB_EMAIL = process.env.PLAYWRIGHT_WEB_EMAIL ?? 'commish.one@poolmaster.dev';
const SEEDED_WEB_PASSWORD = process.env.PLAYWRIGHT_WEB_PASSWORD ?? 'poolmaster123';
const SEEDED_LEAGUE_ID = process.env.PLAYWRIGHT_WEB_LEAGUE_ID ?? '00000000-0000-0000-0000-000000000001';

async function loginAsSeededCommissioner(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill(SEEDED_WEB_EMAIL);
  await page.locator('#password').fill(SEEDED_WEB_PASSWORD);
  await page.getByTestId('auth-login-submit').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('Browser CI sanity checks', () => {
  test('seeded commissioner can log into the deployed web app', async ({ page, pageErrors }) => {
    await loginAsSeededCommissioner(page);

    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('seeded commissioner can open the league members management route', async ({ page, pageErrors }) => {
    await loginAsSeededCommissioner(page);
    await page.goto(`/leagues/${SEEDED_LEAGUE_ID}/members`);

    await expect(page.getByTestId('league-members-page')).toBeVisible();
    await expect(page.getByTestId('league-members-invite-button')).toBeVisible();
    await page.getByTestId('league-members-invite-button').click();
    await expect(page.getByTestId('league-members-copy-invite-link')).toBeVisible();

    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });

  test('seeded commissioner can open the league detail route', async ({ page, pageErrors }) => {
    await loginAsSeededCommissioner(page);
    await page.goto(`/leagues/${SEEDED_LEAGUE_ID}`);

    await expect(page.getByTestId('league-detail-create-contest')).toBeVisible();
    await expect(page.getByTestId('league-detail-invite-members')).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('league-detail-history-link')).toBeVisible();

    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });
});
