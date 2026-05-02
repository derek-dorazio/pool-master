import { expect, test } from './fixtures';

test('pool-master-xw5.2: member fixture has repaired access to the QA league and team area', async ({
  memberPage,
  qaLeague,
}) => {
  await memberPage.goto(`/league/${qaLeague.code}`);
  await expect(memberPage.getByTestId('league-home')).toBeVisible();

  await memberPage.getByTestId('app-menu-my-team-trigger').click();
  await expect(memberPage.getByTestId('app-menu-my-team-details')).toBeVisible();
  await memberPage.getByTestId('app-menu-my-team-details').click();
  await expect(memberPage.getByTestId('my-team-page')).toBeVisible();
});
