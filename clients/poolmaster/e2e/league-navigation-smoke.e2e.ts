import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openMenuItem(page: Page, triggerTestId: string, itemTestId: string) {
  await page.getByTestId(triggerTestId).click();
  await expect(page.getByTestId(itemTestId)).toBeVisible();
  await page.getByTestId(itemTestId).click();
}

test('pool-master-dcv: commissioner can reach high-value league pages from the primary menu', async ({
  commissionerPage,
  qaLeague,
}) => {
  await commissionerPage.goto(`/league/${qaLeague.code}`);
  await expect(commissionerPage.getByTestId('league-home')).toBeVisible();

  await openMenuItem(commissionerPage, 'app-menu-league-trigger', 'app-menu-league-teams');
  await expect(commissionerPage.getByTestId('teams-page')).toBeVisible();

  await openMenuItem(commissionerPage, 'app-menu-league-trigger', 'app-menu-active-contests');
  await expect(commissionerPage.getByTestId('league-contests-page')).toBeVisible();
  await expect(commissionerPage.getByTestId('league-contests-active')).toBeVisible();

  await openMenuItem(commissionerPage, 'app-menu-league-trigger', 'app-menu-contest-history');
  await expect(commissionerPage.getByTestId('league-contest-history-page')).toBeVisible();
  await expect(commissionerPage.getByTestId('league-contests-history')).toBeVisible();

  await openMenuItem(commissionerPage, 'app-menu-league-trigger', 'app-menu-create-contest');
  await expect(commissionerPage.getByTestId('create-contest-page')).toBeVisible();
});

test('pool-master-dcv: member can reach high-value team pages from the primary menu', async ({
  memberPage,
  qaLeague,
}) => {
  await memberPage.goto(`/league/${qaLeague.code}`);
  await expect(memberPage.getByTestId('league-home')).toBeVisible();

  await openMenuItem(memberPage, 'app-menu-my-team-trigger', 'app-menu-my-team-details');
  await expect(memberPage.getByTestId('my-team-page')).toBeVisible();
  await expect(memberPage.getByTestId('my-team-details-tile')).toBeVisible();

  await openMenuItem(memberPage, 'app-menu-my-team-trigger', 'app-menu-my-contests');
  await expect(memberPage.getByTestId('league-contests-page')).toBeVisible();
  await expect(memberPage).toHaveURL(new RegExp(`/league/${qaLeague.code}/contests\\?filter=my-entries$`));

  await openMenuItem(memberPage, 'app-menu-my-team-trigger', 'app-menu-my-history');
  await expect(memberPage.getByTestId('my-team-history-page')).toBeVisible();
});
