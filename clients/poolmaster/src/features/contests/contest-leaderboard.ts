/**
 * The contest leaderboard's client-side derivations (#110, #112).
 *
 * The response carries no view model: `entries` are standings whose `picks` are *pointers*
 * into `participants` (the event's own canonical field rows), and no score is preformatted.
 * Everything below is the join and the shaping that follows from that, kept out of the
 * component so each branch is unit-testable on its own.
 *
 * What is deliberately NOT here: anything a scoring family decides — its columns and its cells.
 * The response's sport names its definition, the definition names its scoring family, and
 * `SCORING_FAMILY_UI` answers for that family (#606). An entry's total is one number in every
 * family (#695), read through the response's scoring definition.
 */

import { getSportDefinition, PARTICIPANT_SCORING_DEFINITIONS } from '@poolmaster/shared/domain';
import type { ContestLeaderboardResponse } from '@/lib/api';
import type { ErrorCodeMessages } from '@/lib/errors';
import {
  formatCurrentRoundLabel,
  resolveCurrentRound,
  resolveRoundNumbers,
} from './contest-leaderboard-rounds';
import { getScoringFamilyUi } from './scoring-family-ui/registry';
import type {
  LeaderboardDetailCell,
  LeaderboardDetailColumn,
  LeaderboardFootnote,
} from './scoring-family-ui/types';

/** One participant row under an entry. Every score is already formatted; null renders as a dash. */
export interface LeaderboardPickRow {
  pickId: string;
  /** The participant's own position in the event (T5 for ties), not the entry's. */
  position: string | null;
  participantName: string;
  /** The worst `M - N` scored picks: present on the page, struck through, out of the total. */
  isDropped: boolean;
  /** The participant's score in this contest: what the entry's total sums. */
  total: string | null;
  /** One cell per entry of the view's `detailColumns`, in that order. */
  detailCells: LeaderboardDetailCell[];
}

/** One event's result for an entry in a contest of several events (#713). */
export interface LeaderboardEventResult {
  sportEventId: string;
  /** 1 is the event's best: its winner, once the event is final. */
  position: number | null;
  displayPosition: string | null;
  total: string | null;
}

/** One entry's block: its own standing, then its participants. */
export interface LeaderboardEntryRow {
  entryId: string;
  entryName: string;
  squadId: string;
  squadName: string;
  displayPosition: string | null;
  total: string | null;
  countingPickLimit: number;
  scoredPickCount: number;
  /** The entry's result in each event it submitted and that has been revealed, in contest order. */
  events: LeaderboardEventResult[];
  picks: LeaderboardPickRow[];
}

export interface LeaderboardView {
  /** The scoring family's columns after the total. */
  detailColumns: LeaderboardDetailColumn[];
  /** The scoring family's note under the board, or null when its cells need none. */
  footnote: LeaderboardFootnote | null;
  currentRoundLabel: string | null;
  entries: LeaderboardEntryRow[];
}

/**
 * The whole view, in the order the server ranked it — `entries` arrives best-first and is
 * never re-sorted here, because position and its tie-aware `displayPosition` were decided
 * server-side against the scoring definition's direction.
 */
export function buildLeaderboardView(response: ContestLeaderboardResponse): LeaderboardView {
  const sport = getSportDefinition(response.sport);
  const family = getScoringFamilyUi(sport).leaderboard(response, sport);
  const scoringDefinition = PARTICIPANT_SCORING_DEFINITIONS[response.scoringDefinitionId];
  const participantsById = new Map(
    response.participants.map((participant) => [participant.id, participant]),
  );

  const entries = response.entries.map((entry) => ({
    entryId: entry.entryId,
    entryName: entry.entryName,
    squadId: entry.squadId,
    squadName: entry.squadName,
    displayPosition: entry.displayPosition,
    total: entry.totalScore === null ? null : scoringDefinition.format(entry.totalScore),
    countingPickLimit: entry.countingPickLimit,
    scoredPickCount: entry.scoredPickCount,
    events: entry.events.map((event) => ({
      sportEventId: event.sportEventId,
      position: event.position,
      displayPosition: event.displayPosition,
      total: event.totalScore === null ? null : scoringDefinition.format(event.totalScore),
    })),
    picks: entry.picks.flatMap((pick) => {
      const participant = participantsById.get(pick.sportEventParticipantId);
      // A pick is a pointer into `participants`; one that does not resolve has no participant
      // to name and no scores to show, so there is no row to render. The entry's own
      // `scoredPickCount` still reflects the server's count, so a dangling pointer shows up
      // as a count that outruns the rows rather than as a blank line.
      if (!participant) {
        return [];
      }
      return [{
        pickId: pick.pickId,
        position: participant.standing?.displayPosition ?? null,
        participantName: participant.participant.name,
        isDropped: pick.isDropped,
        ...family.pickDetail(entry.entryId, pick, participant),
      }];
    }),
  }));

  return {
    detailColumns: family.detailColumns,
    footnote: family.footnote,
    currentRoundLabel: formatCurrentRoundLabel(
      resolveCurrentRound(response.participants),
      sport,
      resolveRoundNumbers(response.participants).length,
    ),
    entries,
  };
}

/** Copy for the refusals a contest leaderboard can meet, the roster and the bracket board alike. */
export const LEADERBOARD_ERROR_MESSAGES: ErrorCodeMessages = {
  CONTEST_LEADERBOARD_PICKS_HIDDEN:
    'Scores appear once picks are revealed. Until then, the contest board shows who has entered.',
  LEAGUE_MEMBERSHIP_REQUIRED: 'Only members of this league can see its contest leaderboards.',
  LEAGUE_MEMBERSHIP_INACTIVE:
    'Your league membership is inactive, so this contest leaderboard is not available to you.',
};
