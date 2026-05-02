import { expect, test } from './fixtures';
import { generateInviteLink } from './poolmaster-e2e-helpers';

test('pool-master-xw5.2: commissioner can use the reusable QA league and invite surface', async ({
  commissionerPage,
  qaLeague,
}) => {
  await commissionerPage.goto(`/league/${qaLeague.code}`);
  await expect(commissionerPage.getByTestId('league-home')).toBeVisible();
  await expect(commissionerPage.getByTestId('league-lifecycle-status')).toContainText('Active');

  const inviteLink = await generateInviteLink(commissionerPage);

  expect(inviteLink).toContain('/invite/');
  expect(commissionerPage.url()).toContain(`/league/${qaLeague.code}`);
  await expect(commissionerPage.getByTestId('league-join-url')).toHaveValue(inviteLink);
});
