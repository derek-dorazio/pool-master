/**
 * The leaderboard's round derivations, read off the event's field. Every sport's event has
 * rounds, so these are shared by the generic view and by a scoring family's own columns; how a
 * round is named comes from the sport definition, never from a word written here.
 */

import {
  isRoundComplete,
  ParticipantRoundStatus,
  type SportDefinition,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantDto } from '@/lib/api';

/** The round the field is currently on, and whether it has finished. */
export interface LeaderboardRound {
  roundNumber: number;
  isComplete: boolean;
}

/**
 * The leaderboard's current round: the highest round any participant is still playing, else
 * the highest any participant has finished. Null before a single round is scored — a contest
 * whose event has not started has no round to name, and the header says nothing rather than
 * guessing the first round.
 */
export function resolveCurrentRound(
  participants: readonly SportEventParticipantDto[],
): LeaderboardRound | null {
  let highestInProgress: number | null = null;
  let highestComplete: number | null = null;

  for (const participant of participants) {
    for (const round of participant.rounds) {
      if (round.status === ParticipantRoundStatus.IN_PROGRESS) {
        if (highestInProgress === null || round.roundNumber > highestInProgress) {
          highestInProgress = round.roundNumber;
        }
      } else if (isRoundComplete(round)) {
        if (highestComplete === null || round.roundNumber > highestComplete) {
          highestComplete = round.roundNumber;
        }
      }
    }
  }

  if (highestInProgress !== null) {
    return { roundNumber: highestInProgress, isComplete: false };
  }
  if (highestComplete !== null) {
    return { roundNumber: highestComplete, isComplete: true };
  }
  return null;
}

/**
 * The current-round header cue, or null when there is no round to name yet. The round's name
 * is the sport's own (`roundLabel`), given the number of rounds the field shows: every caller
 * passes `resolveRoundNumbers(participants).length`, so a round reads the same everywhere.
 */
export function formatCurrentRoundLabel(
  round: LeaderboardRound | null,
  sport: SportDefinition,
  roundCount: number,
): string | null {
  if (round === null) {
    return null;
  }
  return `${sport.roundLabel(round.roundNumber, roundCount)} — ${round.isComplete ? 'Complete' : 'In Progress'}`;
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
