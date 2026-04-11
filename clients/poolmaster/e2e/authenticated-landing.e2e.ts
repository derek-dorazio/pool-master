import { expect, test } from '@playwright/test';

test('new commissioner registration creates a league and can log out', async ({ page }) => {
  const timestamp = Date.now();
  const email = `playwright-commissioner-${timestamp}@example.test`;
  const password = 'Playwright123!';
  const leagueName = `Playwright League ${timestamp}`;

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

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByTestId('authenticated-landing')).toBeVisible();
  await expect(page.getByRole('heading', { name: /welcome to ultimate office pool manager/i })).toBeVisible();

  await page.getByTestId('welcome-create-league').click();
  await expect(page.getByTestId('create-league-modal')).toBeVisible();
  await page.getByTestId('create-league-name').fill(leagueName);
  await page.getByTestId('create-league-submit').click();

  await expect(page).toHaveURL(/\/league\/[A-Z0-9]+$/);
  await expect(page.getByTestId('league-home')).toBeVisible();
  await expect(page.getByRole('heading', { name: leagueName })).toBeVisible();

  await page.getByTestId('app-logout').click();
  await expect(page).toHaveURL(/\/$/);
});
