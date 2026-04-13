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

async function loginUser(
  page: Parameters<typeof test>[0]['page'],
  user: {
    email: string;
    password: string;
  },
) {
  await page.getByTestId('auth-login-email').fill(user.email);
  await page.getByTestId('auth-login-password').fill(user.password);
  await page.getByTestId('auth-login-submit').click();
}

function uniqueLeagueCode(prefix: string, timestamp: number) {
  const base = `${prefix}${timestamp.toString(36)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return base.slice(0, 16);
}

async function createLeagueFromWelcome(
  page: Parameters<typeof test>[0]['page'],
  leagueName: string,
  leagueCode: string,
) {
  await page.getByTestId('welcome-create-league').click();
  await expect(page.getByTestId('create-league-modal')).toBeVisible();
  await page.getByTestId('create-league-name').fill(leagueName);
  await page.getByTestId('create-league-code').fill(leagueCode);
  await page.getByTestId('create-league-next').click();
  await page.getByTestId('create-league-submit').click();
}

async function createLeagueFromSelector(
  page: Parameters<typeof test>[0]['page'],
  leagueName: string,
  leagueCode: string,
) {
  await page.getByTestId('league-selector-toggle').click();
  await page.getByTestId('league-selector-create').click();
  await expect(page.getByTestId('create-league-modal')).toBeVisible();
  await page.getByTestId('create-league-name').fill(leagueName);
  await page.getByTestId('create-league-code').fill(leagueCode);
  await page.getByTestId('create-league-next').click();
  await page.getByTestId('create-league-submit').click();
}

test('new commissioner registration creates a league and can log out', async ({ page }) => {
  const timestamp = Date.now();
  const email = `playwright-commissioner-${timestamp}@example.test`;
  const password = 'Playwright123!';
  const leagueName = `Playwright League ${timestamp}`;
  const leagueCode = uniqueLeagueCode('PLW', timestamp);

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

  await createLeagueFromWelcome(page, leagueName, leagueCode);

  await expect(page).toHaveURL(/\/league\/[A-Z0-9]+$/);
  await expect(page.getByTestId('league-home')).toBeVisible();
  await expect(page.getByRole('heading', { name: leagueName })).toBeVisible();

  await page.getByTestId('app-nav-my-leagues').click();
  await expect(page).toHaveURL(/\/my-leagues$/);
  await expect(page.getByTestId('my-leagues-page')).toBeVisible();
  await expect(page.getByTestId(/league-tile-/)).toContainText(leagueName);

  await page.getByTestId('app-logout').click();
  await expect(page).toHaveURL(/\/$/);
});

test('invited new user registers, joins the league, and can log out', async ({ page }) => {
  const timestamp = Date.now();
  const commissionerPassword = 'Playwright123!';
  const commissionerEmail = `playwright-invite-commissioner-${timestamp}@example.test`;
  const memberEmail = `playwright-invite-member-${timestamp}@example.test`;
  const leagueName = `Invite League ${timestamp}`;
  const leagueCode = uniqueLeagueCode('INV', timestamp);

  await page.goto('/');
  await registerUser(page, {
    firstName: 'Invite',
    lastName: 'Commissioner',
    email: commissionerEmail,
    password: commissionerPassword,
  });

  await expect(page).toHaveURL(/\/welcome$/);
  await createLeagueFromWelcome(page, leagueName, leagueCode);

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

test('existing multi-league user can deep link, switch leagues, and return to the recent league', async ({ page }) => {
  const timestamp = Date.now();
  const email = `playwright-multileague-${timestamp}@example.test`;
  const password = 'Playwright123!';
  const firstLeagueName = `Alpha League ${timestamp}`;
  const secondLeagueName = `Bravo League ${timestamp}`;
  const firstLeagueCode = uniqueLeagueCode('ALPHA', timestamp);
  const secondLeagueCode = uniqueLeagueCode('BRAVO', timestamp);

  await page.goto('/');
  await registerUser(page, {
    firstName: 'Multi',
    lastName: 'League',
    email,
    password,
  });

  await expect(page).toHaveURL(/\/welcome$/);
  await createLeagueFromWelcome(page, firstLeagueName, firstLeagueCode);

  await expect(page).toHaveURL(/\/league\/[A-Z0-9]+$/);
  const firstLeagueUrl = page.url();

  await createLeagueFromSelector(page, secondLeagueName, secondLeagueCode);
  await expect(page).toHaveURL(/\/league\/[A-Z0-9]+$/);
  const secondLeagueUrl = page.url();

  await page.goto(firstLeagueUrl);
  await expect(page).toHaveURL(firstLeagueUrl);
  await expect(page.getByRole('heading', { name: firstLeagueName })).toBeVisible();

  await page.getByTestId('league-selector-toggle').click();
  await page.getByTestId(`league-selector-option-${secondLeagueCode}`).click();

  await expect(page).toHaveURL(secondLeagueUrl);
  await expect(page.getByRole('heading', { name: secondLeagueName })).toBeVisible();

  await page.getByTestId('app-nav-my-leagues').click();
  await expect(page).toHaveURL(/\/my-leagues$/);
  await expect(page.getByTestId(`league-tile-${secondLeagueCode}`)).toContainText(secondLeagueName);

  await page.getByTestId('app-logout').click();
  await expect(page).toHaveURL(/\/$/);

  await loginUser(page, { email, password });
  await expect(page).toHaveURL(secondLeagueUrl);
  await expect(page.getByRole('heading', { name: secondLeagueName })).toBeVisible();

  await page.getByTestId('app-logout').click();
  await expect(page).toHaveURL(/\/$/);
});
