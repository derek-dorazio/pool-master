import { expect, test } from '@playwright/test';

test('new commissioner registration lands on the authenticated landing page', async ({ page }) => {
  const timestamp = Date.now();
  const email = `playwright-commissioner-${timestamp}@example.test`;
  const password = 'Playwright123!';

  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: /ultimate office pool manager starts with one simple choice/i }),
  ).toBeVisible();

  await page.getByTestId('auth-register-tab').click();
  await page.getByTestId('auth-register-first-name').fill('Playwright');
  await page.getByTestId('auth-register-last-name').fill('Commissioner');
  await page.getByTestId('auth-register-email').fill(email);
  await page.getByTestId('auth-register-password').fill(password);
  await page.getByTestId('auth-register-confirm-password').fill(password);
  await page.getByTestId('auth-register-submit').click();

  await expect(page).toHaveURL(/\/leagues$/);
  await expect(page.getByTestId('authenticated-landing')).toBeVisible();
  await expect(page.getByRole('heading', { name: /welcome to ultimate office pool manager/i })).toBeVisible();
});
