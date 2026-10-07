/**
 * The contest leaderboard's client-side derivations (#110, #112).
 *
 * The response carries no view model: `entries` are standings whose `picks` are *pointers*
 * into `participants` (the event's own canonical field rows), and no score is preformatted.
 * Everything below is the join and the shaping that follows from that, kept out of the
 * component so each branch is unit-testable on its own.
 *
 * What is deliberately NOT here: how a score renders. `PARTICIPANT_SCORING_DEFINITIONS`
 * owns that — `format` for a total, `formatRound` for the strokes-once-complete /
 * to-par-while-in-progress round rule (#248 moved it there when the server stopped
 * preformatting it). This module calls those; it never reimplements them.
 */

import {
  isRoundComplete,
  PARTICIPANT_SCORING_DEFINITIONS,
} from '@poolmaster/shared/domain';
import type {
  ContestLeaderboardResponse,
  SportEventParticipantDto,
} from '@/lib/api';

/** The round status a live round carries; the written set is in `GolfRoundUpdate`. */
const IN_PROGRESS_ROUND_STATUS = 'IN_PROGRESS';

/** The round the field is currently on, and whether it has finished. */
export interface LeaderboardRound {
  roundNumber: number;
  isComplete: boolean;
}

/**
 * The leaderboard's current round: the highest round any golfer is still playing, else the
 * highest any golfer has finished. Null before a single round is scored — a contest whose
 * event has not teed off has no round to name, and the header says nothing rather than
 * guessing "Round 1".
 */
export function resolveCurrentRound(
  participants: readonly SportEventParticipantDto[],
): LeaderboardRound | null {
  let highestInProgress: number | null = null;
  let highestComplete: number | null = null;

  for (const participant of participants) {
    for (const round of participant.rounds) {
      if (round.status === IN_PROGRESS_ROUND_STATUS) {
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

/** The current-round header cue, or null when there is no round to name yet. */
export function formatCurrentRoundLabel(round: LeaderboardRound | null): string | null {
  if (round === null) {
    return null;
  }
  return `Round ${round.roundNumber} — ${round.isComplete ? 'Complete' : 'In Progress'}`;
}

/**
 * The round columns to render, read off the field rather than assumed to be four: an
 * admin-authored tournament sets its own rounds, and a field with no rounds yet gets none.
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

/**
 * The THR cell (#389): how far the golfer is through their current round. `CUT` and `WD`
 * outrank everything — a golfer out of the event has no round in progress — then `F` once the
 * current round is complete, then the last hole completed. Null (a dash) before they tee off.
 */
export function formatThru(participant: SportEventParticipantDto): string | null {
  const standing = participant.standing;
  if (!standing) {
    return null;
  }
  if (standing.status === 'ELIMINATED') {
    return 'CUT';
  }
  if (standing.status === 'WITHDRAWN') {
    return 'WD';
  }
  if (standing.status === 'COMPLETE') {
    return 'F';
  }
  const currentRound = participant.rounds.find(
    (round) => round.roundNumber === standing.currentRound,
  );
  if (currentRound && isRoundComplete(currentRound)) {
    return 'F';
  }
  const thru = standing.golf?.currentRoundThru ?? null;
  return thru === null || thru <= 0 ? null : String(thru);
}

/** One golfer row under an entry. Every score is already formatted; null renders as a dash. */
export interface LeaderboardPickRow {
  pickId: string;
  /** The golfer's own position in the event (T5 for ties), not the entry's. */
  position: string | null;
  participantName: string;
  /** The worst `M - N` scored picks: present on the page, struck through, out of the total. */
  isDropped: boolean;
  total: string | null;
  /** See `formatThru`. */
  thru: string | null;
  /** One cell per entry of `roundNumbers`, in that order. */
  rounds: Array<string | null>;
}

/** One entry's block: its own standing, then its golfers. */
export interface LeaderboardEntryRow {
  entryId: string;
  entryName: string;
  squadName: string;
  displayPosition: string | null;
  total: string | null;
  countingPickLimit: number;
  scoredPickCount: number;
  picks: LeaderboardPickRow[];
}

export interface LeaderboardView {
  roundNumbers: number[];
  currentRoundLabel: string | null;
  entries: LeaderboardEntryRow[];
}

/**
 * The whole view, in the order the server ranked it — `entries` arrives best-first and is
 * never re-sorted here, because position and its tie-aware `displayPosition` were decided
 * server-side against the scoring definition's direction.
 */
export function buildLeaderboardView(response: ContestLeaderboardResponse): LeaderboardView {
  const definition = PARTICIPANT_SCORING_DEFINITIONS[response.scoringDefinitionId];
  const roundNumbers = resolveRoundNumbers(response.participants);
  const participantsById = new Map(
    response.participants.map((participant) => [participant.id, participant]),
  );

  const entries = response.entries.map((entry) => {
    // Null until one of the entry's picks is scored; also null for a sport with no golf
    // extension, which this route does not serve (400 _SPORT_UNSUPPORTED).
    const entryTotal = entry.golf?.totalScoreToPar ?? null;
    return {
      entryId: entry.entryId,
      entryName: entry.entryName,
      squadName: entry.squadName,
      displayPosition: entry.displayPosition,
      total: entryTotal === null ? null : definition.format(entryTotal),
      countingPickLimit: entry.countingPickLimit,
      scoredPickCount: entry.scoredPickCount,
      picks: entry.picks.flatMap((pick) => {
        const participant = participantsById.get(pick.sportEventParticipantId);
        // A pick is a pointer into `participants`; one that does not resolve has no golfer to
        // name and no scores to show, so there is no row to render. The entry's own
        // `scoredPickCount` still reflects the server's count, so a dangling pointer shows up
        // as a count that outruns the rows rather than as a blank line.
        if (!participant) {
          return [];
        }
        const roundsByNumber = new Map(
          participant.rounds.map((round) => [round.roundNumber, round]),
        );
        const eventScoreToPar = participant.standing?.golf?.eventScoreToPar ?? null;
        return [{
          pickId: pick.pickId,
          position: participant.standing?.displayPosition ?? null,
          participantName: participant.participant.name,
          isDropped: pick.isDropped,
          total: eventScoreToPar === null ? null : definition.format(eventScoreToPar),
          thru: formatThru(participant),
          rounds: roundNumbers.map((roundNumber) => {
            const round = roundsByNumber.get(roundNumber);
            if (!round?.golf) {
              return null;
            }
            return definition.formatRound({
              status: round.status,
              strokes: round.golf.strokes,
              scoreToPar: round.golf.scoreToPar,
            });
          }),
        }];
      }),
    };
  });

  return {
    roundNumbers,
    currentRoundLabel: formatCurrentRoundLabel(resolveCurrentRound(response.participants)),
    entries,
  };
}
