/**
 * When a stroke-play round is finished (#877, `plans/email-notifications.md` Q3.11): there is no
 * round-level record, so it is read off each golfer's own round. A round is finished once every
 * golfer still in the event (cut, withdrawn and removed golfers left out) has played it to the
 * end, and it finished when the last of them did. A weather delay that carries a round into the
 * next morning simply finishes it then.
 */
import type { ParticipantRoundView, SportEventParticipantView } from '../../events/sport-event-participant-service';
import { isOutOfEvent, isRoundFinished } from './unplayed-rounds';

export interface FinishedRound {
  roundNumber: number;
  finishedAt: Date;
}

/**
 * The highest round the whole field still in the event has finished, or null before any is. A
 * golfer's round finished at its `completedAt`, else when its score was last written: an admin
 * entering a final score need not stamp a time.
 */
export function lastFinishedRound(field: readonly SportEventParticipantView[]): FinishedRound | null {
  const playing = field.filter((row) => !isOutOfEvent(row));
  const roundNumbers = [...new Set(playing.flatMap((row) => row.rounds.map((round) => round.round.roundNumber)))]
    .sort((left, right) => right - left);
  for (const roundNumber of roundNumbers) {
    const finished = playing
      .map((row) => row.rounds.find((round) => round.round.roundNumber === roundNumber))
      .filter((round): round is ParticipantRoundView => round !== undefined && isRoundFinished(round));
    if (finished.length === playing.length) {
      const finishedAt = Math.max(...finished.map((round) => (round.round.completedAt ?? round.round.updatedAt).getTime()));
      return { roundNumber, finishedAt: new Date(finishedAt) };
    }
  }
  return null;
}
