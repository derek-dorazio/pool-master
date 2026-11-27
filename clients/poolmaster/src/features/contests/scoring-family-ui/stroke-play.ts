/**
 * Stroke play's leaderboard (golf): THR, then one column per round, with every score rendered
 * through stroke play's participant scoring definition. `PARTICIPANT_SCORING_DEFINITIONS` owns
 * how a score reads — `format` for a total, `formatRound` for the strokes-once-complete /
 * to-par-while-in-progress round rule (#248) — and this module calls those; it never
 * reimplements them. What an unplayed round scores (#478) is the contest's setting, read off the
 * leaderboard response.
 */

import {
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantStandingStatus,
} from '@poolmaster/shared/domain';
import { displayString, enumLabel } from '@poolmaster/shared/display-strings';
import type { SportEventParticipantDto } from '@/lib/api';
import { resolveRoundNumbers } from '../contest-leaderboard-rounds';
import type { LeaderboardDetailCell, ScoringFamilyUi } from './types';

/**
 * The THR cell (#389): how far the golfer is through their current round. A golfer whose event
 * is over for them reads their standing's short form (`CUT`, `WD`, or `F` once they have played
 * every round) — a golfer out of the event has no round in progress. Otherwise the current round
 * reads its side status's short form once it has ended (`F`), then the periods (holes) the feed
 * says they have completed. Null (a dash) before they tee off.
 */
export function formatThru(participant: SportEventParticipantDto): string | null {
  const standing = participant.standing;
  if (!standing) {
    return null;
  }
  if (OUT_OF_EVENT.has(standing.status)) {
    return enumLabel('ParticipantStandingStatus', standing.status, { form: 'short' });
  }
  const currentRound = participant.rounds.find(
    (round) => round.roundNumber === standing.currentRound,
  );
  if (!currentRound) {
    return null;
  }
  if (currentRound.status !== null) {
    return enumLabel('GameSideStatus', currentRound.status, { form: 'short' });
  }
  const thru = currentRound.periodsCompleted;
  return thru === null || thru <= 0 ? null : String(thru);
}

/** The standings that end a golfer's event: THR shows the standing, not a round. */
const OUT_OF_EVENT: ReadonlySet<ParticipantStandingStatus> = new Set([
  ParticipantStandingStatus.ELIMINATED,
  ParticipantStandingStatus.WITHDRAWN,
  ParticipantStandingStatus.COMPLETE,
]);

/** The winning scores an entry may predict, relative to par: +10 down to -30. */
const WINNING_SCORE_OPTIONS = Array.from({ length: 41 }, (_, index) => 10 - index);

export const strokePlayUi: ScoringFamilyUi = {
  // The tiebreaker is a predicted winning score relative to par, read like any golf total.
  entryTiebreaker: {
    label: 'Winning Score Relative to Par',
    placeholder: 'Select score',
    options: WINNING_SCORE_OPTIONS,
    format: PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format,
    describe: (value) => `Winning score relative to par: ${PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format(value)}`,
  },
  leaderboard(response) {
    // Stroke play has one scoring definition: golf's total relative to par.
    const definition = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;
    // A withdrawn golfer's unplayed rounds can fall on rounds nobody has played yet, so those get
    // columns too.
    const unplayedRoundNumbers = response.entries.flatMap((entry) =>
      entry.picks.flatMap((pick) => pick.golf?.unplayedRoundNumbers ?? []),
    );
    const fieldRoundNumbers = resolveRoundNumbers(response.participants);
    const roundNumbers = [...new Set([
      ...fieldRoundNumbers,
      ...unplayedRoundNumbers,
    ])].sort((left, right) => left - right);
    // What each unplayed round counts as, against par: the contest's setting (#478).
    const unplayedCell = response.unplayedRoundToPar === null ? null : definition.format(response.unplayedRoundToPar);

    return {
      detailColumns: [
        { key: 'thru', label: 'Thr', width: 'minmax(40px,0.3fr)' },
        ...roundNumbers.map((roundNumber) => ({
          key: `round-${roundNumber}`,
          label: displayString('word.roundNumber', { n: roundNumber }, undefined, { form: 'short' }),
          testId: `contest-leaderboard-round-header-${roundNumber}`,
          width: 'minmax(44px,0.3fr)',
        })),
      ],
      footnote: unplayedRoundNumbers.length > 0 && unplayedCell !== null
        ? {
          testId: 'contest-leaderboard-unplayed-note',
          text: `Rounds in italics were not played (missed cut, withdrawal, or no score) and count as ${unplayedCell} against par.`,
        }
        : null,
      pickDetail(entryId, pick, participant) {
        const roundsByNumber = new Map(
          participant.rounds.map((round) => [round.roundNumber, round]),
        );
        // The contest score, not the event's: a cut or withdrawn golfer's unplayed rounds count
        // as the contest's unplayed-round score here (#478), while the event standing keeps their
        // real to-par.
        const contestScore = pick.golf?.scoreToPar ?? null;
        const pickUnplayedRounds = pick.golf?.unplayedRoundNumbers ?? [];
        const roundCells = roundNumbers.map((roundNumber): LeaderboardDetailCell => {
          const cell = {
            key: `round-${roundNumber}`,
            testId: `contest-leaderboard-pick-round-${entryId}-${pick.pickId}-${roundNumber}`,
          };
          if (pickUnplayedRounds.includes(roundNumber)) {
            return {
              ...cell,
              text: unplayedCell,
              unplayed: {
                ariaLabel: `${displayString('word.roundNumber', { n: roundNumber })} not played, counts as ${unplayedCell ?? ''} against par`,
              },
            };
          }
          const round = roundsByNumber.get(roundNumber);
          return {
            ...cell,
            text: round?.golf
              ? definition.formatRound({
                status: round.status,
                strokes: round.golf.strokes,
                scoreToPar: round.golf.scoreToPar,
              })
              : null,
          };
        });
        return {
          total: contestScore === null ? null : definition.format(contestScore),
          detailCells: [
            {
              key: 'thru',
              testId: `contest-leaderboard-pick-thru-${entryId}-${pick.pickId}`,
              text: formatThru(participant),
            },
            ...roundCells,
          ],
        };
      },
    };
  },
};
