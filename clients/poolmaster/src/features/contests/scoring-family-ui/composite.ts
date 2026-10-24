/**
 * Composite's leaderboard (championship stat pools, #936): one column per game, each cell the
 * player's composite in that game, and the pick's total their games summed. A player's row opens
 * to the stats each game's composite was made from. The scores are the server's (`composite` on
 * the pick); the stats are the field's own stat lines, named by `SPORT_STAT_LABELS`.
 */

import { PARTICIPANT_SCORING_DEFINITIONS, type SportStat } from '@poolmaster/shared/domain';
import type { SportEventParticipantDto } from '@/lib/api';
import { resolveRoundNumbers } from '../contest-leaderboard-rounds';
import { SPORT_STAT_LABELS } from './stat-labels';
import type { LeaderboardPickBreakdown, ScoringFamilyUi } from './types';

/** "2 TB, 1 R, 1 RBI": a game's stats in the composite's order, each with its short label. */
function statSummary(participant: SportEventParticipantDto, roundNumber: number, stats: readonly SportStat[]): string | null {
  const lines = participant.rounds.find((round) => round.roundNumber === roundNumber)?.statLines ?? [];
  if (lines.length === 0) {
    return null;
  }
  const byStat = new Map(lines.map((line) => [line.stat, line.value]));
  return stats.flatMap((stat) => {
    const value = byStat.get(stat);
    return value === undefined ? [] : [`${value} ${SPORT_STAT_LABELS[stat].short}`];
  }).join(', ');
}

export const compositeUi: ScoringFamilyUi = {
  // A composite total breaks no ties with a prediction: entries submit without one.
  entryTiebreaker: null,
  leaderboard(response, sport) {
    const definition = PARTICIPANT_SCORING_DEFINITIONS.COMPOSITE_TOTAL;
    const stats = sport.composite?.stats ?? [];
    // A game has a column once any player in the field has a line in it.
    const gameNumbers = resolveRoundNumbers(response.participants);
    const gameCount = gameNumbers.at(-1) ?? 0;

    return {
      detailColumns: gameNumbers.map((roundNumber) => ({
        key: `game-${roundNumber}`,
        label: `G${roundNumber}`,
        testId: `contest-leaderboard-round-header-${roundNumber}`,
        width: 'minmax(40px,0.3fr)',
      })),
      footnote: null,
      pickDetail(entryId, pick, participant) {
        const scores = new Map((pick.composite?.games ?? []).map((game) => [game.roundNumber, game.score]));
        const breakdown: LeaderboardPickBreakdown = {
          testId: `contest-leaderboard-pick-breakdown-${entryId}-${pick.pickId}`,
          lines: gameNumbers.map((roundNumber) => {
            const summary = statSummary(participant, roundNumber, stats);
            const score = scores.get(roundNumber);
            return {
              key: `game-${roundNumber}`,
              label: sport.roundLabel(roundNumber, gameCount),
              text: summary === null || score === undefined ? 'Did not play' : `${definition.format(score)} (${summary})`,
            };
          }),
        };
        return {
          total: pick.composite?.points == null ? null : definition.format(pick.composite.points),
          detailCells: gameNumbers.map((roundNumber) => {
            const score = scores.get(roundNumber);
            return {
              key: `game-${roundNumber}`,
              testId: `contest-leaderboard-pick-round-${entryId}-${pick.pickId}-${roundNumber}`,
              text: score === undefined ? null : definition.format(score),
            };
          }),
          breakdown,
        };
      },
    };
  },
};
