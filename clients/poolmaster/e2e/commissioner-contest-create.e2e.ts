import { expect, test } from '@playwright/test';
import {
  buildE2EUser,
  buildLeagueSeed,
  createLeague,
  createTieredContest,
  openCreateContestFlow,
  registerUser,
} from './poolmaster-e2e-helpers';

test.skip(
  !process.env.POOLMASTER_ENABLE_CONTEST_E2E,
  'Draft contest browser journey requires stable contest-ready QA event data and is not part of the deploy-gate smoke by default.',
);

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
    await expect(page.getByTestId('contest-detail-heading')).toHaveText(contestName);
    expect(page.url()).toContain(`/contests/`);
    expect(page.url()).not.toContain(`/league/${actualLeagueCode}`);
    await expect(page.getByTestId('contest-enter-entry')).toBeVisible();
    await expect(page.getByTestId('contest-detail-summary')).toHaveText(/TIERED · STROKE_PLAY · GOLF/);
    await expect(page.getByTestId('contest-leaderboard')).toBeVisible();
  });
});
