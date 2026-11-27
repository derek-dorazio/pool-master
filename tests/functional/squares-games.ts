import { listEventSquaresGames } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { expectDefined } from '../support/expect-defined';

/**
 * The Game a squares contest on `matchId` is created on (#2050): its Game 1, as the event's
 * squares Game choices list it, the way Create contest finds it.
 */
export async function squaresGameIdOf(client: Client, eventId: string, matchId: string): Promise<string> {
  const choices = expectDefined((await listEventSquaresGames({ client, path: { eventId } })).data, 'squares game choices').games;
  return expectDefined(choices.find((choice) => choice.match.id === matchId && choice.gameNumber === 1), `squares Game 1 of match ${matchId}`).sportEventRoundMatchGameId;
}
