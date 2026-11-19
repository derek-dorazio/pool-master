import { expect, type Page } from '@playwright/test';
import { submitAndRead } from './browser-writes';

/**
 * Adds participants to one sport league through Manage's Add page, reached from the League page's
 * Tools tab (#1853, #1866: a participant belongs to one league, and Add opens on the league it
 * names), one save each, returning their ids in order.
 */
export async function addLeagueParticipants(page: Page, sportPath: string, sportLeagueId: string, names: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    await page.goto(`/manage/sports/${sportPath}/participants/new?sportLeague=${sportLeagueId}`);
    await expect(page.getByTestId('root-admin-participant-list-new-league')).toHaveValue(sportLeagueId);
    await page.getByTestId('root-admin-participant-list-new-name').fill(name);
    const created = await submitAndRead<{ participant: { id: string } }>(
      page,
      'root-admin-participant-list-new-save',
      'POST',
      '/api/v1/participants',
    );
    ids.push(created.participant.id);
  }
  return ids;
}

/** Opens the League page's Participants tab (#1866) and finds each participant on it. */
export async function expectLeagueParticipants(page: Page, sportPath: string, sportLeagueId: string, ids: readonly string[]): Promise<void> {
  await page.goto(`/manage/sports/${sportPath}/leagues/${sportLeagueId}/participants`);
  for (const id of ids) {
    await expect(page.getByTestId(`root-admin-league-participant-${id}`)).toBeVisible();
  }
}
