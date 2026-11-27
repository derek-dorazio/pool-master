/**
 * A golfer's rounds (#2008): each is the golfer's side result in that round's FIELD Game, scored
 * with strokes and to-par. A side result with no score (a race's) is no golf round.
 */
import type { FieldGameResultView } from '@poolmaster/shared/db';
import { GameSideStatus, ParticipantRoundStatus } from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';

/** A round the golfer has a score in. */
export type ScoredRound = FieldGameResultView & { result: FieldGameResultView['result'] & { score: number; scoreToPar: number } };

/** The row's scored rounds, in round order. */
export function scoredRoundsOf(row: Pick<SportEventParticipantView, 'fieldResults'>): ScoredRound[] {
  return row.fieldResults.flatMap((round) => {
    const { score, scoreToPar } = round.result;
    return score !== null && scoreToPar !== null ? [{ ...round, result: { ...round.result, score, scoreToPar } }] : [];
  });
}

/** A round's progress as the API names it (#2008): its side status, null while the golfer is on the course. */
export function roundStatusOfSide(status: GameSideStatus | null): ParticipantRoundStatus {
  switch (status) {
    case null:
      return ParticipantRoundStatus.IN_PROGRESS;
    case GameSideStatus.FINISHED:
      return ParticipantRoundStatus.COMPLETED;
    case GameSideStatus.DID_NOT_FINISH:
    case GameSideStatus.DID_NOT_START:
      return ParticipantRoundStatus.DNF;
    case GameSideStatus.DISQUALIFIED:
      return ParticipantRoundStatus.DSQ;
  }
}

/** The round a field is on, and whether it has finished. */
export interface FieldCurrentRound {
  roundNumber: number;
  isComplete: boolean;
}

/**
 * The round a field is on: the highest round any golfer is still playing (on the course, no side
 * status yet), else the highest any golfer has finished. Null before a single round is scored,
 * and for a field scored by match or by finish, which has no rounds.
 */
export function currentRoundOfField(field: readonly Pick<SportEventParticipantView, 'fieldResults'>[]): FieldCurrentRound | null {
  let highestInProgress: number | null = null;
  let highestFinished: number | null = null;
  for (const row of field) {
    for (const round of scoredRoundsOf(row)) {
      if (round.result.status === null) {
        highestInProgress = Math.max(highestInProgress ?? 0, round.roundNumber);
      } else if (round.result.status === GameSideStatus.FINISHED) {
        highestFinished = Math.max(highestFinished ?? 0, round.roundNumber);
      }
    }
  }
  if (highestInProgress !== null) {
    return { roundNumber: highestInProgress, isComplete: false };
  }
  return highestFinished === null ? null : { roundNumber: highestFinished, isComplete: true };
}
