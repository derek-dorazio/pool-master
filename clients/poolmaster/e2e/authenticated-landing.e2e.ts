import { expect, test } from '@playwright/test';

test('member login lands on the authenticated landing page', async ({ page }) => {
  const email = process.env.POOLMASTER_E2E_EMAIL;
  const password = process.env.POOLMASTER_E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'POOLMASTER_E2E_EMAIL and POOLMASTER_E2E_PASSWORD are required for deployed browser E2E.',
    );
  }

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /one web app for members/i })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/leagues$/);
  await expect(page.getByTestId('authenticated-landing')).toBeVisible();
});
