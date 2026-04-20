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
    await expect(page.getByRole('heading', { name: entryName })).toBeVisible();
    expect(page.url()).toContain('/entries/');
    expect(page.url()).not.toContain(`/league/${actualLeagueCode}`);
    await expect(page.getByText('Build your lineup')).toBeVisible();
    await expect(page.getByText('Winning score 271')).toBeVisible();
    await expect(page.locator('[data-testid^="contest-entry-selected-"]').first()).toBeVisible();
  });
});
