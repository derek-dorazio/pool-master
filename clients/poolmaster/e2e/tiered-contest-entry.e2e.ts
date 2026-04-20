import { expect, test } from '@playwright/test';
import {
  buildE2EUser,
  buildLeagueSeed,
  completeTieredEntry,
  createLeague,
  createTieredContest,
  openCreateContestFlow,
  registerUser,
} from './poolmaster-e2e-helpers';

test.skip(
  !process.env.POOLMASTER_ENABLE_CONTEST_E2E,
  'Draft contest browser journey requires stable contest-ready QA event data and is not part of the deploy-gate smoke by default.',
);

test('commissioner can create and complete a tiered golf entry', async ({ page }) => {
  const commissioner = buildE2EUser('EntryCommissioner');
  const league = buildLeagueSeed('TEEBOX');
  const contestName = `Tiered Entry ${Date.now().toString(36).toUpperCase()}`;
  const entryName = `Sunday Charge ${Date.now().toString(36).toUpperCase()}`;
  let actualLeagueCode = '';

  await test.step('register commissioner and create league + contest', async () => {
    await registerUser(page, commissioner);
    await expect(page).toHaveURL(/\/welcome$/);
    actualLeagueCode = await createLeague(page, league);
    await openCreateContestFlow(page);
    await createTieredContest(page, contestName);
  });

  await test.step('create and complete the tiered entry', async () => {
    await completeTieredEntry(page, {
      name: entryName,
      tiebreakerValue: '271',
    });
  });

  await test.step('show the saved entry detail after selections', async () => {
    await expect(page.getByTestId('contest-entry-heading')).toHaveText(entryName);
    expect(page.url()).toContain('/entries/');
    expect(page.url()).not.toContain(`/league/${actualLeagueCode}`);
    await expect(page.getByTestId('contest-entry-builder-heading')).toHaveText('Build your lineup');
    await expect(page.getByTestId('contest-entry-tiebreaker-summary')).toHaveText('Winning score 271');
    await expect(page.locator('[data-testid^="contest-entry-selected-"]').first()).toBeVisible();
  });
});
