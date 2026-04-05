import { test, expect, assertNoErrors } from './fixtures';

const SEEDED_ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? 'derek.dorazio@gmail.com';
const SEEDED_ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? 'poolmaster123';
const SEEDED_PROVIDER_ID = process.env.PLAYWRIGHT_ADMIN_PROVIDER_ID ?? 'espn';

async function loginAsSeededAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('admin-login-email').fill(SEEDED_ADMIN_EMAIL);
  await page.getByTestId('admin-login-password').fill(SEEDED_ADMIN_PASSWORD);
  await page.getByTestId('admin-login-submit').click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe('Admin browser CI sanity checks', () => {
  test('seeded admin can log into the deployed admin app', async ({ page, pageErrors }) => {
    await loginAsSeededAdmin(page);

    await expect(page.getByTestId('admin-home-page')).toBeVisible();

    await assertNoErrors(pageErrors);
  });

  test('seeded admin can open the providers list route', async ({ page, pageErrors }) => {
    await loginAsSeededAdmin(page);
    await page.goto('/providers');

    await expect(page.getByTestId('admin-providers-page')).toBeVisible();
    await expect(page.getByTestId('admin-providers-title')).toBeVisible();
    await expect(page.locator('[data-testid^="admin-provider-row-"]').first()).toBeVisible();

    await assertNoErrors(pageErrors);
  });

  test('seeded admin can open the provider detail route', async ({ page, pageErrors }) => {
    await loginAsSeededAdmin(page);
    await page.goto(`/providers/${SEEDED_PROVIDER_ID}`);

    await expect(page.getByTestId('provider-detail-page')).toBeVisible();
    await expect(page.getByTestId('provider-detail-name')).toBeVisible();

    await assertNoErrors(pageErrors);
  });
});
