import type { APIRequestContext } from '@playwright/test';
import { expectOk, type AuthHeaders } from './admin-api';

/**
 * The Game 1 of each match a squares contest can be played on, by match id (#2050): what the
 * squares game picker's options are valued by, read from the event's squares Game choices.
 */
export async function squaresGameIdsThroughApi(api: APIRequestContext, headers: AuthHeaders, eventId: string): Promise<Map<string, string>> {
  const path = `/api/v1/events/${eventId}/squares-games`;
  const response = await expectOk(api.get(path, { headers }), `GET ${path}`);
  const { games } = (await response.json()) as { games: { sportEventRoundMatchGameId: string; gameNumber: number; match: { id: string } }[] };
  return new Map(games.filter((choice) => choice.gameNumber === 1).map((choice) => [choice.match.id, choice.sportEventRoundMatchGameId]));
}
