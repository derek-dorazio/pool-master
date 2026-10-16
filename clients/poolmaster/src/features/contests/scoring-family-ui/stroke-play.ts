/**
 * Stroke play's leaderboard (golf): THR, then one column per round, with every score rendered
 * through stroke play's participant scoring definition. `PARTICIPANT_SCORING_DEFINITIONS` owns
 * how a score reads — `format` for a total, `formatRound` for the strokes-once-complete /
 * to-par-while-in-progress round rule (#248) — and this module calls those; it never
 * reimplements them. The 80-strokes rule for an unplayed round (#478) is stroke play's.
 */

import {
  isRoundComplete,
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantStandingStatus,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantDto } from '@/lib/api';
import { resolveRoundNumbers } from '../contest-leaderboard-rounds';
import type { LeaderboardDetailCell, ScoringFamilyUi } from './types';

/** What a round the golfer did not play counts as, shown in its cell (#478). */
export const UNPLAYED_ROUND_CELL = '80';

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
  if (standing.status === ParticipantStandingStatus.ELIMINATED) {
    return 'CUT';
  }
  if (standing.status === ParticipantStandingStatus.WITHDRAWN) {
    return 'WD';
  }
  if (standing.status === ParticipantStandingStatus.COMPLETE) {
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
  leaderboard(response, sport) {
    // Stroke play has one scoring definition: golf's total relative to par.
    const definition = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;
    // A withdrawn golfer's 80s can fall on rounds nobody has played yet, so those get columns too.
    const unplayedRoundNumbers = response.entries.flatMap((entry) =>
      entry.picks.flatMap((pick) => pick.golf?.unplayedRoundNumbers ?? []),
    );
    const fieldRoundNumbers = resolveRoundNumbers(response.participants);
    const roundNumbers = [...new Set([
      ...fieldRoundNumbers,
      ...unplayedRoundNumbers,
    ])].sort((left, right) => left - right);

    return {
      detailColumns: [
        { key: 'thru', label: 'Thr', width: 'minmax(40px,0.3fr)' },
        ...roundNumbers.map((roundNumber) => ({
          key: `round-${roundNumber}`,
          label: `R${roundNumber}`,
          testId: `contest-leaderboard-round-header-${roundNumber}`,
          width: 'minmax(44px,0.3fr)',
        })),
      ],
      footnote: unplayedRoundNumbers.length > 0
        ? {
          testId: 'contest-leaderboard-unplayed-note',
          text: 'Rounds in italics were not played (missed cut, withdrawal, or no score) and count as 80 strokes against that round\'s par.',
        }
        : null,
      pickDetail(entryId, pick, participant) {
        const roundsByNumber = new Map(
          participant.rounds.map((round) => [round.roundNumber, round]),
        );
        // The contest score, not the event's: a cut or withdrawn golfer's unplayed rounds count
        // as 80 strokes here (#478), while the event standing keeps their real to-par.
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
              text: UNPLAYED_ROUND_CELL,
              unplayed: {
                ariaLabel: `${sport.roundLabel(roundNumber, fieldRoundNumbers.length)} not played, counts as 80 strokes`,
                title: 'Not played: counts as 80 strokes',
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
