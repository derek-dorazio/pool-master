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

  await page.getByTestId('create-league-next').click();
  await expect(page.getByTestId('create-league-submit')).toBeVisible();
  await page.getByTestId('create-league-submit').click();
  await expect(page).toHaveURL(new RegExp(`/league/${league.code}$`));
  await expect(page.getByTestId('league-home')).toBeVisible();
}

export async function generateInviteLink(page: Page) {
  await expect(page.getByTestId('league-generate-invite-link')).toBeVisible();
  await page.getByTestId('league-generate-invite-link').click();

  const inviteInput = page.getByTestId('league-invite-link');
  await expect(inviteInput).toHaveValue(/\/invite\//);

  return inviteInput.inputValue();
}

export async function openCreateContestFlow(page: Page) {
  await expect(page.getByTestId('league-create-contest')).toBeVisible();
  await page.getByTestId('league-create-contest').click();
  await expect(page.getByTestId('create-contest-page')).toBeVisible();
}

export async function selectFirstAvailableGolfEvent(page: Page) {
  const eventSelect = page.getByTestId('contest-sport-event');
  await expect(eventSelect).toBeVisible();

  const eventOptions = await eventSelect.locator('option').evaluateAll((options) =>
    options
      .map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent?.trim() ?? '',
      }))
      .filter((option) => option.value),
  );

  expect(
    eventOptions.length,
    'QA must have at least one imported golf event available before this browser contest flow can run.',
  ).toBeGreaterThan(0);

  await eventSelect.selectOption(eventOptions[0].value);
  return eventOptions[0];
}

export async function createTieredContest(
  page: Page,
  contestName: string,
) {
  await expect(page.getByTestId('contest-mode-tiered')).toBeVisible();
  await page.getByTestId('contest-mode-tiered').click();
  const selectedEvent = await selectFirstAvailableGolfEvent(page);
  await page.getByTestId('contest-name').fill(contestName);
  await page.getByTestId('create-contest-submit').click();
  await expect(page.getByTestId('contest-back-to-league')).toBeVisible();
  await expect(page.getByTestId('contest-my-entry')).toBeVisible();
  return selectedEvent;
}

export async function completeTieredEntry(
  page: Page,
  entry: { name: string; tiebreakerValue: string },
) {
  await expect(page.getByTestId('contest-enter-entry')).toBeVisible();
  await page.getByTestId('contest-enter-entry').click();
  await expect(page.getByText('Build your lineup')).toBeVisible();

  await page.getByTestId('contest-entry-name-input').fill(entry.name);
  await page.getByTestId('contest-entry-tiebreaker-input').fill(entry.tiebreakerValue);
  await page.getByTestId('contest-entry-save-details').click();

  const groupCount = await page.locator('[data-testid^="contest-entry-group-"]').count();

  expect(groupCount, 'Tiered golf entry flow should expose at least one selection group.').toBeGreaterThan(0);

  for (let index = 0; index < groupCount; index += 1) {
    const group = page.locator('[data-testid^="contest-entry-group-"]').nth(index);
    const participantButtons = group.locator('[data-testid^="contest-entry-participant-"]:not([disabled])');

    if ((await participantButtons.count()) === 0) {
      await group.locator('[data-testid^="contest-entry-group-toggle-"]').click();
    }

    await expect(group.locator('[data-testid^="contest-entry-participant-"]:not([disabled])').first()).toBeVisible();
    await group.locator('[data-testid^="contest-entry-participant-"]:not([disabled])').first().click();
  }
}
