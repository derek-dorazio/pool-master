/**
 * The leaderboard's rounds. Every sport's event has rounds, so these are shared by the generic
 * view and by a scoring family's own columns; how a round is named comes from the sport
 * definition, never from a word written here.
 */

import type { RoundName } from '@poolmaster/shared/domain';
import type { ContestLeaderboardResponse, SportEventParticipantDto } from '@/lib/api';

/**
 * The current-round header cue, or null when there is no round to name yet. Which round the field
 * is on is the API's (`currentRound`); the round is named by the slot it is played in
 * (`useEventRoundNames`, #2006), so it reads the same everywhere.
 */
export function formatCurrentRoundLabel(
  round: ContestLeaderboardResponse['currentRound'],
  roundName: RoundName,
): string | null {
  if (round === null) {
    return null;
  }
  return `${roundName(round.roundNumber)} — ${round.isComplete ? 'Complete' : 'In Progress'}`;
}

/**
 * The rounds the field has, read off it rather than assumed: an admin-authored tournament sets
 * its own rounds, and a field with no rounds yet has none.
 */
export function resolveRoundNumbers(
  participants: readonly SportEventParticipantDto[],
): number[] {
  const roundNumbers = new Set<number>();
  for (const participant of participants) {
    for (const round of participant.rounds) {
      roundNumbers.add(round.roundNumber);
    }
  }
  return [...roundNumbers].sort((left, right) => left - right);
}
