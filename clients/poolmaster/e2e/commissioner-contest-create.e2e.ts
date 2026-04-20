import { expect, test } from '@playwright/test';
import {
  buildE2EUser,
  buildLeagueSeed,
  createLeague,
  createTieredContest,
  openCreateContestFlow,
  registerUser,
} from './poolmaster-e2e-helpers';

test('commissioner can create a tiered golf contest from an imported event', async ({ page }) => {
  const commissioner = buildE2EUser('ContestCommissioner');
  const league = buildLeagueSeed('FAIRWAY');
  const contestName = `Masters Tiered ${Date.now().toString(36).toUpperCase()}`;
  let actualLeagueCode = '';

  await test.step('register and create the league shell', async () => {
    await registerUser(page, commissioner);
    await expect(page).toHaveURL(/\/welcome$/);
    actualLeagueCode = await createLeague(page, league);
  });

  await test.step('open contest creation and pick an imported golf event', async () => {
    await openCreateContestFlow(page);
    await createTieredContest(page, contestName);
  });

  await test.step('land on contest detail with the contest immediately live', async () => {
    await expect(page.getByRole('heading', { name: contestName })).toBeVisible();
    expect(page.url()).toContain(`/contests/`);
    expect(page.url()).not.toContain(`/league/${actualLeagueCode}`);
    await expect(page.getByTestId('contest-enter-entry')).toBeVisible();
    await expect(page.getByText('TIERED · STROKE_PLAY · GOLF')).toBeVisible();
    await expect(page.getByTestId('contest-leaderboard')).toBeVisible();
  });
});
