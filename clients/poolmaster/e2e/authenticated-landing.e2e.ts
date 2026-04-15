import { expect, test } from '@playwright/test';

async function registerUser(
  page: Parameters<typeof test>[0]['page'],
  user: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  },
) {
  await page.getByTestId('auth-register-tab').click();
  await page.getByTestId('auth-register-first-name').fill(user.firstName);
  await page.getByTestId('auth-register-last-name').fill(user.lastName);
  await page.getByTestId('auth-register-email').fill(user.email);
  await page.getByTestId('auth-register-password').fill(user.password);
  await page.getByTestId('auth-register-confirm-password').fill(user.password);
  await page.getByTestId('auth-register-submit').click();
}

test('new user can sign up and land on the welcome page', async ({ page }) => {
  const timestamp = Date.now();
  const email = `playwright-commissioner-${timestamp}@example.test`;
  const password = 'Playwright123!';

  await page.goto('/');

  await expect(page.getByTestId('auth-register-tab')).toBeVisible();

  await registerUser(page, {
    firstName: 'Playwright',
    lastName: 'Commissioner',
    email,
    password,
  });

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByTestId('authenticated-landing')).toBeVisible();
  await expect(
    page.getByTestId('welcome-create-league'),
  ).toBeVisible();
});
