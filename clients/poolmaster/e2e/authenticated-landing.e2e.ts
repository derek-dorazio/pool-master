import { expect, test } from './fixtures';

test('pool-master-xw5.2: fixture users can load their authenticated landing surfaces', async ({
  commissionerPage,
  memberPage,
  rootAdminPage,
  qaLeague,
}) => {
  await commissionerPage.goto(`/league/${qaLeague.code}`);
  await expect(commissionerPage.getByTestId('league-home')).toBeVisible();
  await expect(commissionerPage.getByTestId('app-menu-league-trigger')).toBeVisible();

  await memberPage.goto(`/league/${qaLeague.code}`);
  await expect(memberPage.getByTestId('league-home')).toBeVisible();
  await expect(memberPage.getByTestId('app-menu-my-team-trigger')).toBeVisible();

  await rootAdminPage.goto('/manage');
  await expect(rootAdminPage.getByTestId('root-admin-manage-layout')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-manage-hub-page')).toBeVisible();
});
