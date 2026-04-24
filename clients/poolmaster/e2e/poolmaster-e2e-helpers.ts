import { expect, type Page } from '@playwright/test';

export type E2EUser = {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
};

export function buildE2EUser(roleLabel: string): E2EUser {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalizedRole = roleLabel.toLowerCase();

  return {
    firstName: roleLabel,
    lastName: 'E2E',
    email: `playwright-${normalizedRole}-${stamp}@example.test`,
    username: `pw-${normalizedRole}-${stamp}`.slice(0, 40),
    password: 'Playwright123!',
  };
}

export function buildLeagueSeed(prefix: string) {
  const suffix = Date.now().toString(36).toUpperCase();
  const leagueCode = `${prefix}${suffix}`.replace(/[^A-Z0-9]/g, '').slice(0, 16);

  return {
    name: `${prefix} ${suffix}`,
    code: leagueCode,
    description: `Browser e2e league for ${prefix.toLowerCase()} flow coverage.`,
  };
}

export async function registerUser(page: Page, user: E2EUser) {
  await page.goto('/');
  await expect(page.getByTestId('auth-register-tab')).toBeVisible();
  await page.getByTestId('auth-register-tab').click();
  await page.getByTestId('auth-register-first-name').fill(user.firstName);
  await page.getByTestId('auth-register-last-name').fill(user.lastName);
  await page.getByTestId('auth-register-email').fill(user.email);
  await page.getByTestId('auth-register-username').fill(user.username);
  await page.getByTestId('auth-register-password').fill(user.password);
  await page.getByTestId('auth-register-confirm-password').fill(user.password);
  await page.getByTestId('auth-register-submit').click();
}

export async function createLeague(
  page: Page,
  league: { name: string; code: string; description?: string },
) {
  await expect(page.getByTestId('authenticated-landing')).toBeVisible();
  await page.getByTestId('welcome-create-league').click();
  await expect(page.getByTestId('create-league-modal')).toBeVisible();
  await page.getByTestId('create-league-name').fill(league.name);
  await page.getByTestId('create-league-code').fill(league.code);

  if (league.description) {
    await page.getByTestId('create-league-description').fill(league.description);
  }

  const leagueCodeInput = page.getByTestId('create-league-code');
  await expect(leagueCodeInput).toHaveValue(/^[A-Z0-9]{3,16}$/);
  const actualLeagueCode = await leagueCodeInput.inputValue();

  await page.getByTestId('create-league-next').click();
  await expect(page.getByTestId('create-league-submit')).toBeVisible();
  await page.getByTestId('create-league-submit').click();
  await expect(page).toHaveURL(new RegExp(`/league/${actualLeagueCode}$`));
  await expect(page.getByTestId('league-home')).toBeVisible();
  return actualLeagueCode;
}

export async function generateInviteLink(page: Page) {
  await expect(page.getByTestId('league-generate-invite-link')).toBeVisible();
  await page.getByTestId('league-generate-invite-link').click();

  const inviteInput = page.getByTestId('league-invite-link');
  await expect(inviteInput).toHaveValue(/\/invite\//);

  return inviteInput.inputValue();
}

export async function openCreateContestFlow(page: Page) {
  await expect(page.getByTestId('app-nav-create-contest')).toBeVisible();
  await page.getByTestId('app-nav-create-contest').click();
  await expect(page.getByTestId('create-contest-page')).toBeVisible();
}
