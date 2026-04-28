import { expect, test } from '@playwright/test';
import {
  buildE2EUser,
  buildLeagueSeed,
  createLeague,
  generateInviteLink,
  registerUser,
} from './poolmaster-e2e-helpers';

test('commissioner can create a league and generate an invite link', async ({ page }) => {
  const commissioner = buildE2EUser('Commissioner');
  const league = buildLeagueSeed('BIRDS');
  let actualLeagueCode = '';

  await test.step('register a commissioner account', async () => {
    await registerUser(page, commissioner);
    await expect(page).toHaveURL(/\/welcome$/);
  });

  await test.step('create a league from the welcome flow', async () => {
    actualLeagueCode = await createLeague(page, league);
    await expect(page.getByTestId('app-nav-create-contest')).toBeVisible();
  });

  await test.step('generate a member invite link', async () => {
    const inviteLink = await generateInviteLink(page);

    expect(inviteLink).toContain('/invite/');
    expect(page.url()).toContain(`/league/${actualLeagueCode}`);
    await expect(page.getByTestId('league-join-url')).toHaveValue(inviteLink);
  });
});
