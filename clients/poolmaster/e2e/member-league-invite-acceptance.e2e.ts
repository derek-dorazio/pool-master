import { expect, test } from '@playwright/test';
import {
  buildE2EUser,
  buildLeagueSeed,
  createLeague,
  generateInviteLink,
  registerUser,
} from './poolmaster-e2e-helpers';

test('member can register from an invite and join the league', async ({ browser, page }) => {
  const commissioner = buildE2EUser('Commissioner');
  const member = buildE2EUser('Member');
  const league = buildLeagueSeed('EAGLES');

  await test.step('commissioner creates a league and invite link', async () => {
    await registerUser(page, commissioner);
    await expect(page).toHaveURL(/\/welcome$/);
    await createLeague(page, league);
  });

  const inviteLink = await test.step('commissioner generates a shareable invite link', async () => {
    return generateInviteLink(page);
  });

  await test.step('member creates an account from the invite flow', async () => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    await memberPage.goto(inviteLink);
    await expect(memberPage.getByTestId('invite-create-account')).toBeVisible();
    await memberPage.getByTestId('invite-create-account').click();

    await registerUser(memberPage, member);
    await expect(memberPage).toHaveURL(/\/invite\//);
    await expect(memberPage.getByTestId('join-league-page')).toBeVisible();
    await expect(memberPage.getByTestId('join-league-team-name')).not.toHaveValue('');

    await memberPage.getByTestId('invite-accept').click();
    await expect(memberPage).toHaveURL(new RegExp(`/league/${league.code}$`));
    await expect(memberPage.getByTestId('league-home')).toBeVisible();

    await memberContext.close();
  });
});
