import type { APIRequestContext } from '@playwright/test';
import { expectOk, type AuthHeaders } from './admin-api';

/**
 * Adds test participants to one sport league through the participants API, one save each,
 * returning their ids in order (#2096). A league's real participants come only from its feed
 * (#2074); a journey's field is made of test participants, which join only a test slot's event,
 * are on no roster, and go with the run's test slots.
 */
export async function addTestParticipants(
  api: APIRequestContext,
  headers: AuthHeaders,
  sportLeagueId: string,
  participantType: 'INDIVIDUAL' | 'TEAM',
  names: readonly string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const response = await expectOk(
      api.post('/api/v1/participants', { headers, data: { sportLeagueId, name, participantType, isTestData: true } }),
      `add test participant ${name}`,
    );
    const created = (await response.json()) as { participant: { id: string } };
    ids.push(created.participant.id);
  }
  return ids;
}
