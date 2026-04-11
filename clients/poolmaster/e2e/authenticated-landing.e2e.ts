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

test('new commissioner registration creates a league and can log out', async ({ page }) => {
  const timestamp = Date.now();
  const email = `playwright-commissioner-${timestamp}@example.test`;
  const password = 'Playwright123!';
  const leagueName = `Playwright League ${timestamp}`;

  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: /ultimate office pool manager starts with one simple choice/i }),
  ).toBeVisible();

  await registerUser(page, {
    firstName: 'Playwright',
    lastName: 'Commissioner',
    email,
    password,
  });

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

test('invited new user registers, joins the league, and can log out', async ({ page }) => {
  const timestamp = Date.now();
  const commissionerPassword = 'Playwright123!';
  const commissionerEmail = `playwright-invite-commissioner-${timestamp}@example.test`;
  const memberEmail = `playwright-invite-member-${timestamp}@example.test`;
  const leagueName = `Invite League ${timestamp}`;

  await page.goto('/');
  await registerUser(page, {
    firstName: 'Invite',
    lastName: 'Commissioner',
    email: commissionerEmail,
    password: commissionerPassword,
  });

  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByTestId('welcome-create-league').click();
  await page.getByTestId('create-league-name').fill(leagueName);
  await page.getByTestId('create-league-submit').click();

  await expect(page).toHaveURL(/\/league\/[A-Z0-9]+$/);
  await expect(page.getByTestId('league-home')).toBeVisible();

  await page.getByTestId('league-generate-invite-link').click();
  await expect(page.getByTestId('league-invite-link')).toHaveValue(/\/invite\//);
  const inviteLink = await page.getByTestId('league-invite-link').inputValue();

  await page.getByTestId('app-logout').click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(inviteLink);

  await expect(page.getByTestId('invitation-context-card')).toBeVisible();
  await expect(page.getByRole('heading', { name: new RegExp(leagueName) })).toBeVisible();
  await page.getByTestId('invite-create-account').click();

  await expect(page.getByTestId('invitation-context-card')).toBeVisible();
  await registerUser(page, {
    firstName: 'Invited',
    lastName: 'Member',
    email: memberEmail,
    password: commissionerPassword,
  });

  await expect(page.getByTestId('invitation-context-card')).toBeVisible();
  await expect(page.getByTestId('invite-accept')).toBeVisible();
  await page.getByTestId('invite-accept').click();

  await expect(page).toHaveURL(/\/league\/[A-Z0-9]+$/);
  await expect(page.getByTestId('league-home')).toBeVisible();
  await expect(page.getByRole('heading', { name: leagueName })).toBeVisible();

  await page.getByTestId('app-logout').click();
  await expect(page).toHaveURL(/\/$/);
});
