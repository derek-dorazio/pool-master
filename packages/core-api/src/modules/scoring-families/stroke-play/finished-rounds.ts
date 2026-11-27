/**
 * When a stroke-play round is finished (#877, `plans/email-notifications.md` Q3.11): there is no
 * round-level record, so it is read off each golfer's own round. A round is finished once every
 * golfer still in the event (cut, withdrawn and removed golfers left out) has played it to the
 * end, and it finished when the last of them did. A weather delay that carries a round into the
 * next morning simply finishes it then.
 */
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';
import { scoredRoundsOf, type ScoredRound } from './scored-rounds';
import { isOutOfEvent, isRoundFinished } from './unplayed-rounds';

export interface FinishedRound {
  roundNumber: number;
  finishedAt: Date;
}

/**
 * The highest round the whole field still in the event has finished, or null before any is. A
 * round finished when its Game was completed, else when the last score was written: an admin
 * entering a final score need not stamp a time. `holes` is the event's `holesPerRound`.
 */
export function lastFinishedRound(field: readonly SportEventParticipantView[], holes: number | null): FinishedRound | null {
  const playing = field.filter((row) => !isOutOfEvent(row));
  const roundsByRow = new Map(playing.map((row) => [row.entry.id, scoredRoundsOf(row)]));
  const roundNumbers = [...new Set([...roundsByRow.values()].flatMap((rounds) => rounds.map((round) => round.roundNumber)))]
    .sort((left, right) => right - left);
  for (const roundNumber of roundNumbers) {
    const finished = playing
      .map((row) => roundsByRow.get(row.entry.id)?.find((round) => round.roundNumber === roundNumber))
      .filter((round): round is ScoredRound => round !== undefined && isRoundFinished(round, holes));
    if (finished.length === playing.length) {
      const finishedAt = Math.max(...finished.map((round) => (round.gameCompletedAt ?? round.updatedAt).getTime()));
      return { roundNumber, finishedAt: new Date(finishedAt) };
    }
  }
  return null;
}
