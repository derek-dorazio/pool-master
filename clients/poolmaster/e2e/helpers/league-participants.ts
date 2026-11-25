import { expect, type Page } from '@playwright/test';
import { readCsrfToken } from './browser-writes';

/**
 * Adds participants to one sport league through the participants API, one save each, returning
 * their ids in order. A synced league's participants come from its feed, and the root admin has no
 * Add participant page (#2074); a journey's own league is a test league, so it writes them itself,
 * as the test-data loader does.
 */
export async function addLeagueParticipants(
  page: Page,
  sportLeagueId: string,
  participantType: 'INDIVIDUAL' | 'TEAM',
  names: readonly string[],
): Promise<string[]> {
  const headers = { 'x-csrf-token': await readCsrfToken(page) };
  const ids: string[] = [];
  for (const name of names) {
    const response = await page.request.post('/api/v1/participants', { headers, data: { sportLeagueId, name, participantType } });
    expect(response.ok(), `POST /api/v1/participants answered ${response.status()}`).toBe(true);
    const created = (await response.json()) as { participant: { id: string } };
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
